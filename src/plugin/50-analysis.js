  // Mark a note reviewed: `reviewed: <today>` in its frontmatter (which also updates its edit date).
  // Self-test: opens every view and lens in the main graph, watching for errors and timing each, and writes a
  // short report. A view that breaks shows up here instead of as a blank pane found by hand weeks later.
  // ---- the analysis engine on this vault's live index (ROADMAP phase 4): topics from Obsidian's own links and
  // and frontmatter. Topic ids carry on from the last run's topics.
  // what the engine reads from Obsidian: the notes it treats as topic notes, their links, tags and text
  async engineGather() {
    const ignored = [].concat((this.app.vault.getConfig && this.app.vault.getConfig("userIgnoreFilters")) || []).map(p => String(p).replace(/\/?$/, "/"));
    const files = this.app.vault.getMarkdownFiles().filter(f => ![...EXCLUDE_PREFIXES, ...ignored].some(p => f.path.startsWith(p)));
    const notes = files.map(f => ({ path: f.path, tags: VGEngine.frontmatterTags(this.fmOf(f)) }));
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const links = Object.fromEntries(files.map(f => [f.path, Object.keys(resolved[f.path] || {}).filter(t => t.endsWith(".md") && t !== f.path)]));
    const T = VGEngine.topicGraph(notes, links, { kind: VGRules.noteKind, isHub: VGRules.isHub, joinsWhenLinked: VGRules.joinsWhenLinked });
    const raw = {};   // every topic note's text: topic keywords and word counts
    for (const r of T.knowledge) { const f = this.fileAt(r); if (f instanceof TFile) raw[r] = await this.app.vault.cachedRead(f); }
    const tags = Object.fromEntries(notes.map(n => [n.path, n.tags]));
    return { T, raw, tags, files, links };
  }
  async engineTopics(prev) {
    const gathered = await this.engineGather(), { T, raw, tags, files } = gathered;
    const J = await VGEngine.run("topicsJob", { graph: T.graph, knowledge: T.knowledge, generated: VGRules.RULES.generated_link_sections, raw, tags, prev: prev || {}, stack: VGRules.RULES.stack });
    return { topics: J.topics, bc: J.bc, knowledge: T.knowledge.length, vectors: J.vectors, notes: T.knowledge, graph: T.graph, raw, tags, files, gathered };
  }
  // The graph data: the engine's topics and
  // influence over Obsidian's index, in the analysis's shape; liveMerge adds the live fields over it as it does over the
  // analysis's. Topic ids carry on from the last engine run (kept in the plugin's settings).
  async engineData(gathered, known) {
    const G = gathered || await this.engineGather(), N = await this.engineNotes(G, { topics: true, prev: this.settings.engineTopics, known }), E = { ...N.T, notes: G.T.knowledge, graph: G.T.graph, raw: G.raw, tags: G.tags };
    this.settings.engineTopics = Object.fromEntries(E.topics.map(t => [t.id, t.members])); await this.saveSettings();
    const at = new Map(), unresolved = this.app.metadataCache.unresolvedLinks || {};
    E.topics.forEach(t => t.members.forEach(r => at.set(r, t.id)));
    const words = r => (VGShared.stripFrontmatter(E.raw[r] || "").match(/[A-Za-z0-9]+/g) || []).length;
    const day = t => VGRules.localDay(new Date(t));
    const nodes = E.notes.map(r => { const f = this.fileAt(r), st = f instanceof TFile ? f.stat : { ctime: Date.now(), mtime: Date.now() };
      return { id: r, name: f instanceof TFile ? f.basename : VGShared.nameOf(r), cluster: at.has(r) ? at.get(r) : -1, bc: Math.round((E.bc[r] || 0) * 1e5) / 1e5,
        folder: r.includes("/") ? r.slice(0, r.lastIndexOf("/")) : "", mentions: 0, recent: 0, inlinks: 0, outlinks: 0,
        broken: Object.keys(unresolved[r] || {}).filter(t => !VGEngine.isAttachment(t)).length, tasks: 0, words: words(r), age: 0, refs: false, isolated: !E.graph[r], tags: VGEngine.nodeTags(E.tags[r] || []),
        born: VGRules.bornDate(f instanceof TFile ? f.basename : r, f instanceof TFile && this.app.metadataCache.getFileCache ? (this.fmOf(f) || {}).created : null, day(st.ctime)), edited: day(st.mtime) }; });
    const links = [];
    for (const [r, nb] of Object.entries(E.graph)) for (const [t, w] of Object.entries(nb)) if (VGEngine.pyCmp(r, t) < 0) links.push({ source: r, target: t, w, kind: "link" });
    const wanted = VGEngine.wantedNotes(unresolved, E.notes);
    wanted.forEach(w => w.refs.slice(0, 12).forEach(r => links.push({ source: r, target: w.id, w: 1, kind: "wanted" })));
    const out = { vault: this.app.vault.getName(), date: VGRules.today(), since: null, recent_days: 30, dailies_used: 0, engine: true,
      said_unlinked: [], wanted, series: [], nodes, links, mocs: [],
      clusters: E.topics.map(t => ({ id: t.id, name: t.name, keywords: t.keywords, stack: t.stack, label: null, size: t.size, folder: t.folder, core: t.core.slice(0, 3).map(VGRules.stem) })),
      gaps: [], quality: { stub_words: VGRules.RULES.stub_words, stale_days: VGRules.RULES.stale_days }, pairs: [], snapshots: [],
      timeline: { weeks: [], clusters: {}, notes: {} }, near_dupes: [] };
    VGRules.applyEngineNotes(out, N, VGRules.ENGINE_PARTS); out.since = null;
    out.nodes.forEach(n => { if (n.person || n.moc || CONTENT.log[n.id]) return; const f = this.fileAt(n.id), fm = (f instanceof TFile && this.fmOf(f)) || {};
      const dates = ["modified", "updated", "date modified", "reviewed"].map(k => String(fm[k] || "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
      n.edited = [n.born, ...dates, ...(N.mentionDays[n.id] || [])].filter(d => d && d <= out.date).sort().pop() || n.edited; n.age = daysSince(n.edited); });
    // links between graph notes, the count liveMerge makes; references; a note's last edit from the content log
    { const ids = new Set(out.nodes.filter(n => !n.person && !n.moc).map(n => n.id)), inl = new Map(), mc = this.app.metadataCache;
      for (const r of ids) for (const t of G.links[r] || []) if (ids.has(t)) inl.set(t, (inl.get(t) || 0) + 1);
      out.nodes.forEach(n => { if (n.person || n.moc) return; n.inlinks = inl.get(n.id) || 0; n.outlinks = (G.links[n.id] || []).filter(t => ids.has(t)).length;
        const f = this.fileAt(n.id), fm = (f instanceof TFile && this.fmOf(f)) || {}; n.refs = !!(fm.references && [].concat(fm.references).length);
        const e = CONTENT.log[n.id], rv = /^\d{4}-\d{2}-\d{2}/.test(String(fm.reviewed || "")) ? String(fm.reviewed).slice(0, 10) : ""; if (e) { n.edited = [e.since, rv].filter(Boolean).sort().pop(); n.age = daysSince(n.edited); } }); }
    out.since = VGEngine.dayShift(out.date, 365); out.dailies_used = N.used;
    return out;
  }
  // Notes changed while this device wasn't watching (another device, a script): the file's date is the best guess. New notes get
  // what the notes themselves say; bulk touches don't change the fingerprint, so they don't count.
  reconcileContent(G, data) {
    const seen = new Set(); let changed = false;
    for (const n of data.nodes) { if (n.person || n.moc || !(n.id in G.raw)) continue; seen.add(n.id); const h = fingerprint(G.raw[n.id]), e = CONTENT.log[n.id];
      if (e && e.h === h) continue;
      const f = this.fileAt(n.id); CONTENT.log[n.id] = { h, since: e ? [VGRules.localDay(new Date(f.stat.mtime)), data.date].sort()[0] : n.edited }; changed = true; }
    for (const p of Object.keys(CONTENT.log)) if (!seen.has(p) && !this.pathTaken(p)) { delete CONTENT.log[p]; changed = true; }
    if (changed) this.saveContentSoon();
  }
  // Which of the code roots' folders are git repositories, and what git says: desktop only, and nothing without git
  async engineCode(G, today) {
    const roots = [].concat(VGRules.RULES.code_roots || []); let fs, path, os, execFile;
    try { fs = require("fs"); path = require("path"); os = require("os"); ({ execFile } = require("child_process")); } catch (e) { return { repos: [], roots }; }
    const git = (cwd, args) => new Promise(ok => execFile("git", ["-C", cwd, ...args], { timeout: 120000, maxBuffer: 2e8 }, (err, out) => ok(err ? "" : out)));
    const dirs = []; for (const r of roots) { const dir = r.replace(/^~(?=$|[\\/])/, os.homedir()); let names = []; try { names = fs.readdirSync(dir); } catch (e) { continue; } names.forEach(n => { if (fs.existsSync(path.join(dir, n, ".git"))) dirs.push(path.join(dir, n)); }); }
    const A = VGEngine.gitArgs(today), repos = [];
    for (const d of dirs.sort()) repos.push({ name: path.basename(d), log: await git(d, A.log), files: await git(d, A.files) });
    if (!repos.some(r => r.log.includes("@@"))) return { repos: [], roots };
    const F = VGRules.folders, skip = [F.scripts, F.templates, F.daily].filter(Boolean).map(x => x + "/"), docs = [];
    for (const f of this.app.vault.getMarkdownFiles()) { if (skip.some(s => f.path.startsWith(s))) continue; docs.push({ rel: f.path, text: await this.app.vault.cachedRead(f), edit: VGRules.localDay(new Date(f.stat.mtime)) }); }
    return VGEngine.run("codeDocs", { repos, docs, today, roots });
  }
  // The graph data every device reads, written by this desktop. Not over what another PC built from newer notes: until its
  // edits sync here, this run would bring back suggestions already acted on. Returns that PC's name when it kept theirs.
  async writeGraphFile() {
    const A = this.app.vault.adapter, file = normalizePath(this.settings.dataPath), dir = file.slice(0, file.lastIndexOf("/")), snaps = `${dir}/snapshots`, mkdirs = async p => { const parts = p.split("/"); for (let i = 1; i <= parts.length; i++) { const d = parts.slice(0, i).join("/"); if (d && !await A.exists(d)) await A.mkdir(d); } }, readJson = p => this.readJson(p);
    const old = await readJson(file), G = await this.engineGather(), known = new Map(), names = {};
    ((old && old.nodes) || []).forEach(n => { const b = VGShared.baseOf(n.id); names[b] = (names[b] || 0) + 1; });
    ((old && old.nodes) || []).forEach(n => { if (n.born) { known.set(n.id, n.born); const b = VGShared.baseOf(n.id); if (names[b] === 1) known.set(b, n.born); } });
    const data = await this.engineData(G, known); delete data.engine;
    const host = require("os").hostname(), newest = Math.max(0, ...this.app.vault.getMarkdownFiles().map(f => f.stat.mtime)) / 1000;
    data.nodes.forEach(n => { if (n.person || n.moc) return; const was = [known.get(n.id), known.get(VGShared.baseOf(n.id))].filter(Boolean); if (n.born || was.length) n.born = [n.born, ...was].filter(Boolean).sort()[0]; });   // what an earlier run, on any PC, found
    this.reconcileContent(G, data);
    data.code = await this.engineCode(G, data.date);
    await mkdirs(snaps);
    const cur = VGEngine.snapshotOf(data), list = ((await A.list(snaps)).files || []).map(f => VGShared.baseOf(f)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort(), earlier = list.filter(d => d < data.date).pop();
    await A.write(`${snaps}/${data.date}.json`, JSON.stringify(cur));
    data.snapshots = [...new Set([...list, data.date])].sort(); data.changes = VGEngine.changesFrom(cur, earlier ? await readJson(`${snaps}/${earlier}.json`) : null, data.links);
    data.built = { host, newest: Math.round(newest * 1000) / 1000 };
    if (old && old.built && old.built.host && old.built.host !== host && (old.built.newest || 0) > data.built.newest) return old.built.host;
    const text = JSON.stringify(data); let before = null; try { before = await A.read(file); } catch (e) { /* first run */ }
    if (before !== text) await A.write(file, text);
    return null;
  }
  // What notes and daily notes say (VGEngine.notesJob and analyseJob), in the graph data's words. A desktop writes it all to
  // the file every device reads; a phone also works out what doesn't rest on meaning, so it needn't wait for a desktop.
  async engineNotes(gathered, o = {}) {
    const G = gathered || await this.engineGather(), mc = this.app.metadataCache, read = f => this.app.vault.cachedRead(f), day0 = VGRules.today();
    const shift = n => VGShared.shiftDay(day0, -n), since = shift(365), recentSince = shift(30);
    const knowledge = G.T.knowledge, K = new Set(knowledge), resolved = mc.resolvedLinks || {}, terms = {}, quiet = [], born = {}, personLinks = {};
    for (const r of knowledge) { const f = this.fileAt(r); if (!(f instanceof TFile)) continue; const fm = this.fmOf(f);
      VGRules.mentionNames(f.basename, fm && fm.aliases).forEach(k => { const key = k.toLowerCase(); (terms[key] = terms[key] || []).push(r); });
      if (VGRules.isPrivate(r, fm)) quiet.push(r);
      born[r] = VGRules.bornDate(f.basename, fm && fm.created, VGRules.localDay(new Date(f.stat.ctime)));
      if (o.known) { const was = [o.known.get(r), o.known.get(VGShared.baseOf(r))].filter(Boolean); if (was.length) born[r] = [born[r], ...was].filter(Boolean).sort()[0]; } }
    const people = G.files.filter(f => VGRules.noteKind(f.path, G.tags[f.path]) === "person").map(f => f.path);
    people.forEach(p => { personLinks[p] = new Set((G.links[p] || []).filter(t => K.has(t))); });
    for (const r of knowledge) for (const t of G.links[r] || []) if (personLinks[t]) personLinks[t].add(r);
    const dailies = [], dailyDays = [], standups = {};
    for (const f of G.files) { if (VGRules.noteKind(f.path, []) !== "daily") continue; const m = /(\d{4}-\d{2}-\d{2})/.exec(f.name) || null, day = m ? m[1] : VGRules.hqJournalDate(f.path); if (!day) continue;
      const text = await read(f); dailyDays.push({ day, text });
      if (day >= since) { const linkOf = {}; for (const l of (mc.getFileCache(f) || {}).links || []) { const target = l.link.split("#")[0].trim(), dest = target && mc.getFirstLinkpathDest && mc.getFirstLinkpathDest(target, f.path); if (dest) linkOf[target.toLowerCase()] = dest.path; }
        dailies.push({ day, path: f.path, text, links: G.links[f.path] || [], linkOf }); }
      if (VGRules.hqStandupDate(f.path)) standups[day] = text; }
    const H = VGRules.RULES.hq || {}, smart = Platform.isDesktopApp ? await this.smartFiles() : null, records = knowledge.filter(r => VGRules.isRecord({ id: r, name: VGShared.nameOf(r), tags: G.tags[r] || [] })), input = { dailies, dailyDays, knowledge, people, terms, recentSince, raw: G.raw, born, adj: G.T.graph, quiet, smart, records, generated: VGRules.RULES.generated_link_sections, standups, today: day0, planHead: H.plan_heading, doneHead: H.completed_heading };
    let J;
    if (o.topics) { const maps = [], bridgeNotes = {};
      for (const f of G.files) { const fm = this.fmOf(f); if (fm && String(fm.type || "").toLowerCase() === "bridge" && K.has(f.path)) bridgeNotes[f.path] = [].concat(fm.bridges || []).map(String);
        if (!VGRules.isMapCandidate(f.path, fm) || (G.T.hubs.includes(f.path) && !VGRules.isHub(f.path, G.tags[f.path]))) continue;
        maps.push({ path: f.path, text: await read(f), links: G.links[f.path] || [], mocFor: fm ? fm.moc_for : null }); }
      const hubDegree = Object.fromEntries(G.T.hubs.map(h => [h, (G.links[h] || []).length]));
      const R = VGRules.RULES, A = await VGEngine.run("analyseJob", { ...input, hubDegree, personLinks: Object.fromEntries(Object.entries(personLinks).map(([p, s]) => [p, [...s]])), tags: G.tags, prev: o.prev || {}, stack: R.stack, dismissed: [...DISMISSED], maps, bridgeNotes, mapRules: { min_claim: R.map_min_claim, min_cover: R.map_min_cover } });
      J = { ...A.N, T: A.T, parts: A.parts };
    } else J = await VGEngine.run("notesJob", input);
    return { ...J, knowledge, personLinks: Object.fromEntries(Object.entries(personLinks).map(([p, s]) => [p, [...s].sort()])), skip: (a, b) => DISMISSED.has(dismissKey(a, b)) };
  }
  // worked out once per analysis run: the next redraw takes it (a phone keeps the desktop's file)
  engineNotesSoon() {
    if (this.engineNotesRunning) return; this.engineNotesRunning = true;
    const owns = VGRules.engineOwns(!Platform.isDesktopApp), withTopics = owns.includes("topics");
    let prev = this.settings.engineTopics; if (withTopics && !prev && this.base) { prev = {}; (this.base.nodes || []).forEach(n => { if (!n.person && !n.moc && !n.ghost && n.cluster >= 0) (prev[n.cluster] = prev[n.cluster] || []).push(n.id); }); }   // the file's topic numbers and colours carry on
    this.engineNotes(null, { topics: withTopics, prev }).then(async N => { this.engineNotesDone = N; if (N.T) { this.settings.engineTopics = Object.fromEntries(N.T.topics.map(t => [t.id, t.members])); await this.saveSettings(); } this.cacheStale = true; this.reloadSoon(); }, e => { console.error("Vault Graph: the engine's notes didn't run; the analysis's stand", e); }).finally(() => { this.engineNotesRunning = false; });
  }
  // the Smart Connections index (.smart-env), if that plugin is installed: extra similar-note pairs on a desktop. Its logs, then each vector file they name
  async smartFiles() {
    const A = this.app.vault.adapter, base = ".smart-env", text = async p => { try { return await A.read(p); } catch (e) { return null; } };
    let files = []; try { files = (await A.list(`${base}/smart_sources`)).files.map(f => VGShared.baseOf(f)); } catch (e) { /* no index */ }
    const names = files.filter(f => /^smart_sources(_\d+)?\.ajson$/.test(f));
    const order = f => { const m = /_(\d+)\.ajson$/.exec(f); return m ? +m[1] : 0; }, parts = await Promise.all((names.length ? names : ["smart_sources.ajson"]).sort((a, b) => order(a) - order(b)).map(f => text(`${base}/smart_sources/${f}`)));
    const sources = parts.some(p => p != null) ? parts.filter(p => p != null).join("\n") : null, models = await text(`${base}/embedding_models/embedding_models.ajson`);
    if (sources == null || models == null) return null;
    const blobs = {};
    for (const f of files) if (!f.endsWith(".ajson")) { try { blobs[f] = new Uint8Array(await A.readBinary(`${base}/smart_sources/${f}`)); } catch (e) { blobs[f] = null; } }
    return { sources, models, blobs };
  }

  async selfTest(auto) {
    // Runs in a hidden, off-screen graph so it never takes over the one you're using. After each plugin update it runs
    // once by itself (desktop) and stays quiet unless something broke; the command always writes a report.
    const data = await this.graphData();
    if (!data) { if (!auto) new Notice("Vault Graph: no graph data to test"); return; }
    if (!auto) new Notice("Vault Graph self-test running in the background… (about a minute)");
    const host = document.body.createDiv({ cls: "vg-host" });
    host.style.cssText = "position:fixed;left:-12000px;top:0;width:1100px;height:720px;pointer-events:none;";
    const errors = []; let elsewhere = 0, oe = console.error;
    const note = (msg, stack) => { if (VGRules.errorIsElsewhere(stack, this.manifest.id)) elsewhere++; else errors.push(msg); };
    const onErr = e => { const x = e.error || e.reason; note(String(e.message || e.reason || e), x && x.stack); };
    console.error = (...a) => { const x = a.find(v => v && v.stack); note(a.map(String).join(" ").slice(0, 200), (x && x.stack) || new Error().stack); oe(...a); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
    const rows = [], lensRows = [];
    let handle = null;
    try {
      handle = mountVaultGraph(host.createDiv(), structuredClone(data), { mobile: Platform.isMobile, alwaysOn: true, layoutSeed: () => this.layoutSeed(),
        // what reads the real vault, so a view that needs it is really tested; nothing that writes
        taskHistory: () => this.taskHistory(), writtenLinks: () => this.writtenLinks(), linkHow: rows => this.linkHow(rows), wantedCounts: () => this.wantedCounts(), driftScan: () => this.driftScan(), guideScan: guide => this.guideScan(guide) });
      await sleep(1500);
      const D = handle._debug, q = s => host.querySelector(s);
      for (const w of D.views()) {
        const e0 = errors.length, t0 = performance.now(); D.setView(w); const sw = performance.now() - t0; await sleep(1500);
        const today = q(".vg-today");
        rows.push(`| ${w} | ${errors.length - e0 ? "❌ " + (errors.length - e0) + " error(s)" : "✅"} | ${Math.round(sw)} ms | ${document.hidden ? "not drawn: window hidden" : `${D.drawMs().toFixed(1)} ms`} | ${D.P.size} | ${today && !today.hidden ? q(".vg-today-text").textContent.replace(/\|/g, "/") : ""} |`);
      }
      const keys = D.lenses();
      for (const k of keys) {
        const e0 = errors.length; D.openLens(k); await sleep(400); for (let i = 0; i < 100 && /^Loading/.test(q(".vg-lens-body").textContent.trim()); i++) await sleep(200);   // a view that loads has to finish
        const body = q(".vg-lens-body"); lensRows.push(`| ${k} | ${errors.length - e0 ? "❌" : "✅"} | ${body.textContent.length} chars | ${(body.querySelector(".vg-empty") || {}).textContent || ""} |`);
      }
    } catch (e) { errors.push("self-test stopped: " + e.message); }
    finally {
      console.error = oe; window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr);
      if (handle) handle.destroy(); host.remove();
    }
    this.settings.lastSelfTest = { sig: await this.buildSig(), date: today(), errors: errors.length }; await this.saveSettings();
    if (auto && !errors.length) return;   // quiet when all is well
    const now0 = new Date(), stamp = `${today()} ${VGShared.pad2(now0.getHours())}${VGShared.pad2(now0.getMinutes())}`;
    // the engine's topics on the live index, against the last analysis's
    let engine;
    try { const D = await this.graphData(), prev = {}; ((D && D.nodes) || []).forEach(n => { if (!n.person && !n.moc && n.cluster >= 0) (prev[n.cluster] = prev[n.cluster] || []).push(n.id); });
      const E = await this.engineTopics(prev), at = new Map();
      E.topics.forEach(t => t.members.forEach(r => at.set(r, t.id)));
      const both = ((D && D.nodes) || []).filter(n => !n.ghost && !n.person && n.cluster >= 0 && at.has(n.id)), same = both.filter(n => at.get(n.id) === n.cluster).length;
      engine = `**Engine topics:** ${same} of ${both.length} notes in the same topic as the analysis · ${E.topics.length} topics from ${E.knowledge} notes.`;
    } catch (e) { engine = `**Engine topics:** didn't run: ${(e && e.message) || e}`; }
    const md = ["---", `created: ${today()}`, "type: report", "tags:", "  - meta/cleanup", "---", "",
      `# Vault Graph self-test ${stamp}`, "", auto ? "_Ran by itself after a plugin update._" : "", "",
      errors.length ? `**${errors.length} error(s)**: ${errors.slice(0, 5).map(e => "`" + e.slice(0, 160).replace(/`/g, "'") + "`").join(" · ")}` : "**No errors.**", "", elsewhere ? `${elsewhere} error(s) elsewhere in Obsidian while it ran, not from this plugin.` : "", "", engine, "",
      "| View | Result | Switch | Frame | Notes drawn | Today strip |", "|---|---|---|---|---|---|", ...rows, "", "| Lens | Result | Size | Empty message |", "|---|---|---|---|", ...lensRows, ""].join("\n");
    await this.writeNote(`${VGRules.folders.reports}/Vault Graph Self-test ${stamp}.md`, md, { mode: "create", open: !auto });
    new Notice(errors.length ? `Vault Graph self-test: ${errors.length} error(s), see ${VGRules.folders.reports}` : "Vault Graph self-test: all clear", errors.length ? 10000 : 4000);
  }
  async buildSig() {   // which build of the plugin this is: main.js size + modified time
    try { const s = await this.app.vault.adapter.stat(normalizePath(`${this.manifest.dir}/main.js`)); return `${s.size}|${s.mtime}`; } catch (e) { return ""; }
  }
  // The weekly State of the vault note (writeStateNote, run by the gardener) gets pictures:
  // Weather, Radar and Food web as they look now, saved to the attachments folder and embedded under "## Maps".
  async stateSnapshots() {
    const notes = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(`${VGRules.folders.reports}/State of the Vault `)).sort((a, b) => b.path.localeCompare(a.path));
    if (!notes.length) { new Notice("No State of the vault note yet: run the analysis with --state (the Friday gardener does)"); return; }
    const leaf = await this.open(), v = leaf.view; await sleep(1200); if (!v.handle) return;
    const was = v.handle._debug.st.view, day = today(), lines = [];
    for (const w of ["weather", "radar", "foodweb"]) {
      v.handle.setView(w); await sleep(3200);
      const name = `${VGRules.folders.attachments}/state-${day}-${w}.png`;
      await this.saveBinary(name, await v.handle.snapshot()); lines.push(`![[${VGShared.baseOf(name)}]]`);
    }
    v.handle.setView(was);
    await this.ioProcess(notes[0], t => t.replace(/^_Run \*\*Vault Graph: Add map snapshots[^\n]*\n?/m, ""));   // the placeholder has done its job
    await this.appendSection(notes[0].path, "## Maps", lines);
    new Notice(`Added 3 map snapshots to ${notes[0].basename}`);
  }
  async noteContent(file) {
    const h = fingerprint(await this.app.vault.cachedRead(file)), e = CONTENT.log[file.path];
    if (e && e.h === h) return;
    CONTENT.log[file.path] = { h, since: today() };
    this.saveContentSoon();
  }
  // The content log on disk (the analysis rewrites it each run; Sync brings another device's) merged into this one:
  // the later change date wins for each note
  async mergeContentFromDisk() {
    const disk = await this.readJson(CONTENT.path); if (!disk) return;
    for (const [k, v] of Object.entries(disk)) if (!CONTENT.log[k] || (v.since > CONTENT.log[k].since)) CONTENT.log[k] = v;
  }
  saveContentSoon() {
    clearTimeout(this.contentTimer);
    this.contentTimer = setTimeout(async () => {
      await this.mergeContentFromDisk();
      await this.app.vault.adapter.write(normalizePath(CONTENT.path), JSON.stringify(CONTENT.log, null, 0) + "\n");
    }, 4000);
  }
  async stampReviewed(notePath) {
    const file = this.fileAt(notePath);
    if (!(file instanceof TFile)) throw new Error("missing note");
    await this.ioFrontMatter(file, fm => { fm.reviewed = today(); });
  }

  // Cosmos bodies, today's picks, XP, saved views and review skips live in a vault file so every device shares them.
  // "Not for me" on a Today item: an open graph applies it (and refills today's three); otherwise it goes into the shared
  // game file, which the graph honours when it next opens. Either way it's hidden on every device.
  async hideGameItem(key) {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).find(v => v && v.handle && v.handle.hideGameItem);
    if (view) view.handle.hideGameItem(key);
    else await this.updateShared(sh => { sh.cosmos = sh.cosmos || {};
      sh.cosmos.hidden = [...new Set([...(sh.cosmos.hidden || []), key])].slice(-500);
      if (sh.cosmos.daily && sh.cosmos.daily.quests) sh.cosmos.daily.quests = sh.cosmos.daily.quests.filter(q => q.key !== key);
      return sh; });
  }
