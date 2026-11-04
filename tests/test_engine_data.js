#!/usr/bin/env node
// A vault with no analysis file: the plugin builds its graph itself (engineData over Obsidian's index; liveMerge on
// top). Drives the built plugin over the sample vault's notes with a stand-in Obsidian, and checks the engine's topics
// against the Python analysis's for the same notes (fixtures/sample-graph.json).
//   node tests/test_engine_data.js        exit 0 = pass
const env = require("./env"), stub = require("./plugin_stub");
const cdp = require("./cdp"), fs = require("fs"), path = require("path");
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
(async () => {
  const { Plugin, TFile, VGEngine } = stub.load(env.rules);
  const app = stub.fakeVault(env.dir(), TFile);
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { dataPath: "_scripts/out/vault-graph.json", script: "_scripts/vault_graph.py", rulesPath: "_scripts/vault_graph_rules.json" } });
  p.saveSettings = async () => {}; p.writeLiveDiag = () => {}; p.sceneBlocks = async () => [];
  const realRun = VGEngine.run; VGEngine.run = (name, input) => { (p.jobs = p.jobs || {})[name] = input; return realRun(name, input); };   // keeps what the plugin handed the job, for the worker check below
  const data = await p.graphData();
  VGEngine.run = realRun;
  check("no analysis file: the graph comes from the engine", !!(data && data.engine), true);
  if (data) {
    // the slow step really runs off the main thread in a browser, and gives the same answer as running it here
    if (p.jobs && p.jobs.analyseJob) { const source = fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8");
      const tab = await cdp.open({ html: `<!doctype html><script>${source.replace(/<\/script/gi, "<\\/script")}</script>`, port: 9372 });
      if (tab) { for (const name of ["analyseJob"]) { const r = await tab.ev(`(async () => { const input = ${env.inlineJson(p.jobs[name])}, here = VGEngine[${JSON.stringify(name)}](input), there = await VGEngine.run(${JSON.stringify(name)}, input); return JSON.stringify({ via: VGEngine.stats.via, same: JSON.stringify(here) === JSON.stringify(there), has: Object.keys(there).length }); })()`);
          const R = JSON.parse(r); check(`${name} ran in a worker`, R.via, "worker"); check(`${name}: the worker's answer is the same as running it here`, R.same, true); check(`${name} returned something`, R.has > 0, true); }
        await tab.close(); } }
    else fails.push("the plugin never asked for the analysis job");
    const py = env.data(), pyNotes = py.nodes.filter(n => !n.ghost && !n.person && !n.moc), notes = data.nodes.filter(n => !n.ghost && !n.person && !n.moc);
    check("the engine's notes are the analysis's", notes.map(n => n.id).sort(), pyNotes.map(n => n.id).sort());
    check("every note in a topic is in one the data lists", notes.filter(n => n.cluster >= 0 && !data.clusters.some(c => c.id === n.cluster)).map(n => n.id), []);
    check("topics found", data.clusters.length > 0, true);
    check("links between notes", data.links.filter(l => l.kind === "link").length > 0, true);
    // suggestions keyed by topics, against the analysis's on the same notes: co-mention pairs, the daily notes behind them, where they meet
    // (the sample's notes are written relative to today and the analysis's file on the day it was made, so dates are left out)
    { const undated = v => JSON.stringify(v || null).replace(/\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}-[A-Za-z]+/g, "D"), pair = l => [l.source, l.target].sort().join("|"), mine = new Map(data.links.filter(l => l.kind === "gap").map(l => [pair(l), l])), theirs = py0 => py0.links.filter(l => l.kind === "gap"), want = theirs(env.data());
      const found = want.filter(l => mine.has(pair(l))), ev = found.filter(l => l.ev && l.ev.length), same = ev.filter(l => { const m = mine.get(pair(l)); return undated(m.ev) === undated(l.ev); });
      check("the sample has co-mention suggestions to compare", want.length >= 5, true); const sameDay = env.data().date === data.date, at = n => (sameDay ? n : Math.ceil(n * 0.6));   // ranks shift a little as the sample's dates move on from its file
      check(`the co-mention suggestions the analysis makes (${found.length} of ${want.length})`, found.length >= at(want.length), true);
      check("with evidence to compare", ev.length >= 5, true); check(`the same daily notes and lines behind them (${same.length} of ${ev.length})`, same.length >= at(ev.length), true);
      check("where the pairs meet", found.filter(l => undated([l.pa, l.pb]) === undated([mine.get(pair(l)).pa, mine.get(pair(l)).pb])).length >= at(found.length), true);
      check("a gap between topics", data.gaps.length > 0, true); check("a map claims a topic", data.mocs.some(m => m.clusters.length), true); check("a timeline", data.timeline.weeks.length, 26); }
    // the topics split the notes as the analysis does: for each engine topic, the share of its notes in its commonest
    // analysis topic (Obsidian resolves links a little differently from the analysis, so a few notes may move)
    const pyOf = new Map(pyNotes.map(n => [n.id, n.cluster])), groups = new Map();
    notes.filter(n => n.cluster >= 0).forEach(n => { if (!groups.has(n.cluster)) groups.set(n.cluster, []); groups.get(n.cluster).push(pyOf.get(n.id)); });
    let agree = 0, total = 0;
    groups.forEach(cs => { const c = {}; cs.forEach(x => { c[x] = (c[x] || 0) + 1; }); agree += Math.max(...Object.values(c)); total += cs.length; });
    const share = total ? agree / total : 0;
    if (share < 0.9) fails.push(`topics agree with the analysis on ${Math.round(share * 100)}% of notes, want 90%+`);
    console.log(fails.length ? "FAIL - " + fails.join("\n  ") : `ok - no analysis file: the plugin's own graph (${notes.length} notes, ${data.clusters.length} topics, ${Math.round(share * 100)}% as the analysis)`);
  } else console.log("FAIL - " + fails.join("\n  "));
  // engine_owns: a desktop takes what the rules file lists over the analysis's file, the rest stays; a phone takes the same, except what rests on meaning
  { const rules = { ...env.rules, engine_owns: ["mentions", "series", "dupes"] }, py = env.data(), real = py.nodes.filter(x => !x.person && !x.moc && !x.ghost), n0 = real[0], n1 = real[1];
    const N = { mentions: { [n0.id]: 4321 }, recent: {}, said: {}, saidDays: {}, mentionDays: {}, used: 7, personMentions: {}, counts: {}, tasks: {}, series: [{ name: "from the engine", notes: [] }], follow: { items: ["never"] }, twins: [[n0.id, n1.id, 1, "text"]], similar: [], codey: [], personLinks: {} };
    const on = async platform => { const L = stub.load(rules, { Platform: platform }), a = stub.fakeVault(env.dir(), L.TFile), q = Object.assign(Object.create(L.Plugin.prototype), { app: a, settings: { dataPath: "_scripts/out/vault-graph.json", script: "_scripts/vault_graph.py", rulesPath: "_scripts/vault_graph_rules.json" } });
      q.saveSettings = async () => {}; q.writeLiveDiag = () => {}; q.sceneBlocks = async () => []; q.base = JSON.parse(JSON.stringify(py)); q.engineNotesDone = N; return q.graphData(); };
    const desk = await on({ isDesktopApp: true }), phone = await on({ isMobile: true }), of = d => d.nodes.find(x => x.id === n0.id);
    check("a desktop takes the mentions it owns", of(desk).mentions, 4321); check("a desktop takes the series it owns", desk.series[0].name, "from the engine");
    check("a part not listed stays the analysis's", JSON.stringify(desk.followthrough) === JSON.stringify(py.followthrough), true);
    check("a phone takes the mentions too", of(phone).mentions, 4321); check("a phone takes the series too", phone.series[0].name, "from the engine");
    const twin = d => d.near_dupes.some(x => x[0] === n0.id && x[1] === n1.id); check("a desktop takes duplicates", twin(desk), true); check("a phone keeps the desktop's duplicates, which rest on meaning", twin(phone), false);
    // the self-test only fails on this plugin's own errors; an error with no stack counts as ours
    const VR = stub.load(env.rules).VGRules; check("an error from elsewhere", VR.errorIsElsewhere("Error: Disconnected\n at app.js:1:1", "jk-vault-graph"), true); check("this plugin's error", VR.errorIsElsewhere("Error\n at x (plugin:jk-vault-graph:5:1)", "jk-vault-graph"), false); check("no stack", VR.errorIsElsewhere(undefined, "jk-vault-graph"), false);
    if (fails.length) console.log("FAIL - " + fails.join("\n  ")); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log("FAIL - " + (e && e.stack || e)); process.exit(1); });
