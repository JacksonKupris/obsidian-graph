#!/usr/bin/env node
// Acting on Vault Graph's suggestions really changes what the plugin shows. In a throwaway copy of the vault (the real one is never
// written), it builds the graph data with the plugin's own code, acts on EVERY current suggestion of each kind the way the plugin's
// buttons do, then checks each is gone at two moments:
//   live        the plugin's real liveMerge over the edited notes, before the data is rebuilt
//   refreshed   after the plugin writes the data again (what a refresh or a restart shows)
//   node tests/live_e2e.js [--vault [dir]] [--keep]        exit 0 = pass. The sample vault by default; part of npm test.
const fs = require("fs"), os = require("os"), path = require("path");
const { checks, finish, sleep } = require("./kit"), env = require("./env"), stub = require("./plugin_stub");
const { ok: check, fails } = checks(), R = env.rules, today = new Date().toLocaleDateString("en-CA"), name = id => path.posix.basename(id, ".md");

const SKIP = [".obsidian", ".trash", ".git", "node_modules", "snapshots", "trash-fallback", (R.folders.attachments || "Attachments")];
const SRC = env.dir(), TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vg-e2e-"));
fs.cpSync(SRC, TMP, { recursive: true, filter: s => s === SRC || !SKIP.includes(path.basename(s)) });
const { Plugin, TFile, VGRules, liveMerge } = stub.load(R), app = stub.liveVault(TMP, TFile, { skip: SKIP });
const DATA = R.files.data, SETTINGS = { dataPath: DATA, rulesPath: "_no_rules_file.json", sharedPath: R.files.shared || "_no_shared.json", dismissedPath: "_no_dismissed.json" };
// the plugin as Obsidian would hold it: nothing mocked but what talks to the screen
const plugin = (extra = {}) => { const p = Object.assign(Object.create(Plugin.prototype), { app, settings: SETTINGS, ...extra }); p.saveSettings = async () => {}; p.writeLiveDiag = () => {}; p.sceneBlocks = async () => []; p.updateStatus = () => {}; p.addStatusBarItem = () => ({}); return p; };
const analyse = async () => { app.flush(); const kept = await plugin().writeGraphFile(); if (kept) throw new Error(`kept data from ${kept}`); };
const load = () => { app.flush(); const data = JSON.parse(fs.readFileSync(path.join(TMP, DATA), "utf8")); liveMerge(app, data, fs.statSync(path.join(TMP, DATA)).mtimeMs); return data; };
const isNote = n => !n.person && !n.moc && !n.ghost, suggested = VGRules.isSuggestion;

(async () => {
  await analyse();
  const inbox = R.folders.inbox;
  const actor = plugin({ waitIndexed: async () => {} });

  // ---- 1. each action updates the shared state by itself: the real write-action wrapping, an index that catches up and says so
  { const live = plugin({ waitIndexed: async () => {} }); live.wrapWriteActions();
    const st = await live.graphData(), settled = async () => { await sleep(40); await live.graphData(); }, node = id => (live.cache.nodes || []).find(n => n.id === id);
    const plain = st.nodes.filter(isNote), used = new Set(), free = test => { const n = plain.find(x => !used.has(x.id) && test(x)); if (n) used.add(n.id); return n; };
    const t = free(n => n.tasks > 0); if (t) { await live.setNoteTasks(t.id, "x"); await settled(); const n = node(t.id); check(!!n && n.tasks === 0 && VGRules.isRecord(n), `Complete all (${t.name}): tasks ${n && n.tasks}, record ${n && VGRules.isRecord(n)}`); }
    const w = (st.wanted || []).find(x => x.creatable); if (w) { await live.writeNote(`${inbox}/${VGRules.safeName(w.name)}.md`, `# ${w.name}\n`, { mode: "create" }); await settled(); check(!live.cache.wanted.some(x => x.id === w.id) && live.cache.nodes.some(n => n.name === w.name && !n.ghost), `Create (${w.name})`); }
    const a = free(() => true), b = free(n => !a || n.id !== a.id); if (a && b) { await live.linkNotes(a.id, b.id, "e2e"); await settled(); check(live.cache.links.some(l => l.kind === "link" && VGRules.pairKey(l.source, l.target) === VGRules.pairKey(a.id, b.id)), `Link (${a.name}, ${b.name})`); }
    const z = free(n => !n.tasks); if (z) { await live.moveNote(z.id, `${R.folders.archive}/e2e`); await settled(); check(!node(z.id), `Archive (${z.name})`); }
    const s = free(n => VGRules.isStale(n)); if (s) { await live.stampReviewed(s.id); await settled(); check(!VGRules.isStale(node(s.id)), `Reviewed (${s.name})`); }
    check(!!(t && a && b && z), "the vault has notes to try Complete, Link and Archive on");
  }

  // ---- 2. every suggestion, through the plugin's own action methods
  const fresh = load(), P = rel => path.join(TMP, rel), read = rel => fs.readFileSync(P(rel), "utf8");
  const write = (rel, text) => { fs.mkdirSync(path.dirname(P(rel)), { recursive: true }); fs.writeFileSync(P(rel), text); };
  const cases = { link: [], addToMap: [], createMap: [], write: [], mentions: [], reviewed: [], completeNote: [], cancelNote: [], cancelTask: [], today: [] };
  { const g0 = VGRules.graph(fresh); cases.today = VGRules.todayList(fresh, { today }).filter(it => ["link", "map", "write", "chart"].includes(it.kind) && !VGRules.questDone(it, g0)).map(it => [it]); }
  app.flush();
  for (const l of fresh.links.filter(suggested)) { if (!fs.existsSync(P(l.source)) || !fs.existsSync(P(l.target))) continue; write(l.source, read(l.source).replace(/\s*$/, "\n") + `- ${actor.linkText(l.target, l.source)} — e2e\n`); cases.link.push([l.source, l.target]); }
  for (const m of fresh.mocs.filter(x => !x.nav)) for (const id of Object.values(m.missing || {}).flat()) { if (!fs.existsSync(P(m.id)) || !fs.existsSync(P(id))) continue; await actor.appendSection(m.id, `## Also in this topic (added ${today})`, [`- ${actor.linkText(id, m.id)}`]); cases.addToMap.push([m.id, id]); }
  const mapped = new Set(fresh.mocs.filter(m => !m.nav).flatMap(m => m.clusters)), chartMap = {};
  fresh.clusters.filter(c => c.size >= 6 && !mapped.has(c.id)).forEach(c => { const members = fresh.nodes.filter(n => n.cluster === c.id && isNote(n) && fs.existsSync(P(n.id)));
    const rel = `${inbox}/E2E ${String(c.label || c.name).replace(/[\\/:*?"<>|#^[\]]/g, "").slice(0, 40)} Hub.md`;
    write(rel, `---\ncreated: ${today}\ntags:\n  - meta/hub\n---\n# ${c.label || c.name} Hub\n\n## All notes\n${members.map(n => `- ${actor.linkText(n.id, `${inbox}/new.md`)}`).join("\n")}\n`);
    cases.createMap.push([rel, members.map(n => n.id)]); chartMap[c.id] = [rel, members.map(n => n.id)]; });
  (fresh.wanted || []).filter(w => w.creatable).forEach(w => { write(`${inbox}/${VGRules.safeName(w.name)}.md`, `# ${w.name}\n\nCreated by the end-to-end check.\n`); cases.write.push([w.id]); });
  app.flush();
  for (const [id] of fresh.said_unlinked || []) { if (!fs.existsSync(P(id))) continue; await actor.linkMentions(id, false); cases.mentions.push([id]); }
  const withTasks = fresh.nodes.filter(n => isNote(n) && n.tasks > 0 && fs.existsSync(P(n.id)));
  for (const [i, n] of withTasks.entries()) {
    if (i % 3 === 0) { await actor.setNoteTasks(n.id, "x"); cases.completeNote.push([n.id]); }
    else if (i % 3 === 1) { await actor.setNoteTasks(n.id, "-"); cases.cancelNote.push([n.id]); }
    else { const [tk] = await actor.readTasks(n.id); if (tk) { await actor.setTaskStatus(n.id, tk.line, tk.text, "-"); cases.cancelTask.push([n.id, n.tasks]); } } }
  const closed = new Set(withTasks.map(n => n.id));
  for (const n of fresh.nodes.filter(n => isNote(n) && !closed.has(n.id) && VGRules.isStale(n, (fresh.quality || {}).stale_days) && fs.existsSync(P(n.id)))) { await actor.stampReviewed(n.id); cases.reviewed.push([n.id]); }

  // ---- 3. is each one gone?
  const node = (d, id) => d.nodes.find(x => x.id === id);
  const pending = {
    link: (d, [a, b]) => d.links.some(l => suggested(l) && VGRules.pairKey(l.source, l.target) === VGRules.pairKey(a, b)),
    addToMap: (d, [m, id]) => { const mm = d.mocs.find(x => x.id === m); return !!mm && Object.values(mm.missing || {}).flat().includes(id); },
    createMap: (d, [rel, ids]) => { if (d.mocs.some(m => m.id === rel && !m.nav && m.clusters.length)) return false;
      // not a map: fine only if no topic it covers is left unclaimed (a topic may have split when they were worked out again)
      const at = new Map(d.nodes.map(n => [n.id, n.cluster])), claimed = new Set(d.mocs.filter(m => !m.nav).flatMap(m => m.clusters));
      return d.clusters.some(c => !claimed.has(c.id) && VGRules.claims(ids.filter(id => at.get(id) === c.id).length, c.size)); },
    write: (d, [id]) => (d.wanted || []).some(w => w.id === id),
    mentions: (d, [id]) => (d.said_unlinked || []).some(([x]) => x === id),
    reviewed: (d, [id]) => { const n = node(d, id); return !!n && VGRules.isStale(n, (d.quality || {}).stale_days); },
    completeNote: (d, [id]) => { const n = node(d, id); return !!n && (n.tasks > 0 || !VGRules.isRecord(n)); },
    cancelNote: (d, [id]) => { const n = node(d, id); return !!n && (n.tasks > 0 || !VGRules.isRecord(n)); },
    cancelTask: (d, [id, was]) => { const n = node(d, id); return !!n && n.tasks !== was - 1; },
    today: (d, [it]) => (it.kind === "chart" ? (chartMap[it.c] ? pending.createMap(d, chartMap[it.c]) : true) : !VGRules.questDone(it, VGRules.graph(d))),
  };
  const report = (label, d) => { const rows = Object.entries(cases).map(([k, list]) => [k, list.length, list.filter(c => pending[k](d, c))]);
    if (process.argv.includes("--list")) console.log(`  ${label}: ${rows.map(([k, n, left]) => `${k} ${n - left.length}/${n}`).join(", ")}`);
    rows.forEach(([k, n, left]) => check(!left.length, `${label}: ${k} left ${left.length} of ${n} showing, e.g. ${String(JSON.stringify(left[0])).slice(0, 220)}`)); };
  const total = Object.values(cases).reduce((s, l) => s + l.length, 0);
  check(total > 0, "there were no suggestions to act on, so this proved nothing");
  check(cases.link.length && cases.completeNote.length, `the vault needs a suggested link (${cases.link.length}) and a note with tasks (${cases.completeNote.length}), or this proves little`);
  report("live", load());
  await analyse();
  report("refreshed", load());

  // ---- 4. the one live state: read once, merged again on a change, read again only when the file is rewritten
  { let reads = 0; const adapter = app.vault.adapter, realRead = adapter.read; adapter.read = async p => { if (p === DATA) reads++; return realRead(p); };
    const store = plugin(), a = await store.graphData(), b = await store.graphData(); store.cacheStale = true; const c = await store.graphData(); store.base = null; store.cacheStale = true; await store.graphData(); adapter.read = realRead;
    check(a === b && c !== a && reads === 2 && store.version === 3, `shared state: ${reads} file reads, ${store.version} merges, same object while unchanged: ${a === b}`); }
  // ---- 5. an empty link index (Obsidian starting up) doesn't read as "every link deleted"
  { const raw = JSON.parse(fs.readFileSync(P(DATA), "utf8")), linked = raw.nodes.filter(n => isNote(n) && !n.isolated).length;
    liveMerge({ ...app, metadataCache: new Proxy(app.metadataCache, { get: (t, k) => (k === "resolvedLinks" ? {} : t[k]) }) }, raw, Date.now());
    check(!!(raw.live && raw.live.indexNotReady) && raw.nodes.filter(n => isNote(n) && !n.isolated).length === linked && linked > 0, `empty link index: kept ${linked} linked notes`); }
  // ---- 6. linkText gets a path or nothing; Array.map would hand it an index
  { const some = fresh.nodes.filter(isNote).map(n => n.id).find(id => fs.existsSync(P(id))); check([0, 1, 7, undefined, null].every(x => { try { return /^\[\[.+\]\]$/.test(actor.linkText(some, x)); } catch (e) { return false; } }), 'linkText ignores a "from" that isn\'t a path'); }

  if (!process.argv.includes("--keep")) fs.rmSync(TMP, { recursive: true, force: true });
  finish(fails, `end to end: acted on ${total} suggestions in a copy, all gone live and after a refresh`, "end to end");
})().catch(e => { console.log(`FAIL - end to end: ${e.stack || e.message}`); process.exit(1); });
