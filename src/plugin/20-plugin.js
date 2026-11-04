// local date, not UTC: in Central time the UTC date rolls over at 7 PM, which dated notes and quests a day early
const { today, localDay } = VGRules;   // the shared date rules (this device's calendar day)
// Every plugin method that writes to the vault. onload wraps each so it announces the change when done (every open
// surface redraws); viewActions hands the same methods to every graph surface. A new write action goes in this list.
const WRITE_ACTIONS = ["applyMapRows", "setParents", "dropLinkLines", "moveTasks", "planLine", "capture", "openDaily", "linkNotes", "writeNote", "appendSection", "moveNote", "renameMap", "setTaskStatus", "completeTask", "logWork", "setTasksStatus", "setTaskField", "setNoteStatus", "setProjectStatus", "setNoteTasks", "stampReviewed", "dismiss", "linkMentions",
  "addReference", "tickMocRow", "saveBinary", "stateSnapshots", "undo"];
// The only methods that touch the vault for a write action. Each notes what it's about to change in the open undo
// entry, so every action can be undone from the message that confirms it. tests/test_rules.js fails on a vault write
// anywhere else (outside STATE_WRITERS).
const WRITE_PRIMITIVES = ["ioProcess", "ioModify", "ioFrontMatter", "ioCreate", "ioCreateBinary", "ioRename", "ioFolder", "ioTrash", "ioData"];
const UNDO_KEEP = 20;   // actions that can still be undone
const UNDO_FILE_MAX = 5 * 1024 * 1024;
// The plugin's own state files (game/shared state, content log), written outside WRITE_ACTIONS: their file watcher
// redraws the sidebar. tests/test_rules.js fails if a vault write appears anywhere else.
const STATE_WRITERS = ["saveContentSoon", "writeShared", "recordLedger", "writeLiveDiag", "setRule"];
// "- [ ] text" -> [prefix "- [", mark, "] ", text]; the mark is " " open, "x" done, "-" cancelled (VGRules.TASK_LINE:
// numbered tasks too, as Obsidian counts them; VGRules.taskLine writes a new mark and stamps the day on a done one)
const { TASK_LINE } = VGRules;
const NOTE_STATUS = { x: "status/done", "-": "status/cancelled" };
// An action's result as a notice; with an Undo button (and longer on screen) when the action can be undone
function undoNotice(msg, undo) {
  if (!undo) { new Notice(msg); return; }
  const frag = document.createDocumentFragment(), b = document.createElement("button");
  frag.append(msg + " "); b.textContent = "Undo"; b.className = "vg-undo"; frag.append(b);
  const notice = new Notice(frag, 8000);
  b.onclick = e => { e.stopPropagation(); notice.hide(); undo(); };
}

module.exports = class VaultGraphPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    await this.loadRules();   // before anything reads a folder name or threshold
    // For notes and other plugins (the Hearth "Second Brain Brief"): read app.plugins.plugins["jk-vault-graph"].graphData()
    // and .rules, the same live state and rules the graph uses, never the data file or a rule of their own
    this.rules = VGRules;
    // Every change the plugin writes refreshes the open views, even ones the live signature can't see
    // (a task checked off, a note reviewed twice in a day): without this they kept the old state until the next analysis
    this.wrapWriteActions();
    this.registerDoneDates();
    await this.loadDismissed();   // dismissed pairs stop showing at once (the analysis drops them at its next run)
    CONTENT.log = {};
    for (const p of [CONTENT.path, VGRules.files.content_backup]) {   // the backup when a reinstall removed the plugin folder
      const log = await this.readJson(p); if (log) { CONTENT.log = log; break; }
    }
    // keep the content log current: a note's "since" moves only when its fingerprint changes
    this.registerEvent(this.app.vault.on("modify", file => { if (file instanceof TFile && file.extension === "md" && !this.ignoreEdit(file.path)) this.noteContent(file); }));
    this.registerEvent(this.app.vault.on("rename", (file, old) => { if (CONTENT.log[old]) { CONTENT.log[file.path] = CONTENT.log[old]; delete CONTENT.log[old]; this.saveContentSoon(); } if (file instanceof TFile) this.noteMoved(file.path, old); }));
    this.registerView(VIEW_TYPE, leaf => new VaultGraphView(leaf, this));
    this.registerView(LOCAL_TYPE, leaf => new VaultGraphLocalView(leaf, this));
    // after each plugin update, test every view and lens once in the background (desktop); a notice only if something broke
    this.app.workspace.onLayoutReady(() => { if (Platform.isDesktopApp) setTimeout(async () => { const sig = await this.buildSig(); if (sig && (this.settings.lastSelfTest || {}).sig !== sig) this.selfTest(true); }, 45000); });
    this.addCommand({ id: "gaps-report", name: "Write the Gaps & Bridges report", callback: () => this.writeGapsReport() });
    this.addCommand({ id: "map-report", name: "Write the MOC Alignment report", callback: () => this.writeMapReport() });
    this.addCommand({ id: "state-note", name: "Write the State of the vault note", callback: () => this.writeStateNote() });
    this.addCommand({ id: "self-test", name: "Run self-test (every view, in the background; writes a report to the reports folder)", callback: () => this.selfTest(false) });
    this.addCommand({ id: "state-snapshots", name: "Add map snapshots to the latest State of the vault note", callback: () => this.stateSnapshots() });
    this.registerView(SUGGEST_TYPE, leaf => new VaultGraphSuggestView(leaf, this));
    this.registerView(HQ_TYPE, leaf => new VaultHQView(leaf, this));
    this.addCommand({ id: "open-hq", name: "Open Vault HQ", callback: () => this.openHQ() });
    this.addCommand({ id: "recent-changes", name: "Recent changes", callback: async () => { const leaf = await this.openHQ(); if (leaf.view.handle) leaf.view.handle.setScreen("changes"); } });
    // from anywhere in Obsidian, without leaving the note you're in; give them a hotkey
    const captureFrom = kind => async () => { const text = await inputModal(this.app, kind === "note" ? "Capture a note" : "Capture a task", kind === "note" ? "It goes in the capture folder." : "It goes in today's journal.", kind === "note" ? "An idea…" : "Something to do…"); if (!text || !text.trim()) return; try { await this.capture(text, kind); new Notice(kind === "note" ? "Note saved" : "Added to today"); } catch (e) { new Notice(`Couldn't save that: ${e.message}`, 8000); } };
    this.addCommand({ id: "capture-task", name: "Capture a task", callback: captureFrom("task") });
    this.addCommand({ id: "capture-note", name: "Capture a note", callback: captureFrom("note") });
    this.addCommand({ id: "hq-palette", name: "Find or do anything (HQ)", callback: async () => { const leaf = await this.openHQ(); if (leaf.view.handle) leaf.view.handle.palette(); } });
    this.addRibbonIcon("layout-dashboard", "Open Vault HQ", () => this.openHQ());
    this.app.workspace.onLayoutReady(() => { if (this.settings.hqAtStart !== false) this.openHQ().then(() => setTimeout(() => { this.oneHQ(); [HQ_TYPE, VIEW_TYPE].flatMap(t => this.app.workspace.getLeavesOfType(t)).forEach(l => l.updateHeader && l.updateHeader()); }, 1500)).catch(e => console.error("Vault Graph: HQ didn't open", e));   // HQ is the home screen. After a plugin update the old tab reconnects a moment after this opens a new one, so look again
      setTimeout(() => this.recall("warm", 1).catch(() => {}), 8000); });   // read the notes and build search's index once things are quiet, so the first real search is instant
    // a note HQ reads changed (a task ticked in the journal, a draft's status set by hand): HQ and the sidebar redraw.
    // The live signature can't see these (no file or link count changes).
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      const fc = this.app.metadataCache.getFileCache(file) || {};
      if (!VGRules.hqKind(file.path, fc.frontmatter, today(), hasOpenTask(fc)) && !(this.hqTexts && this.hqTexts.has(file.path))) return;   // or it just lost its last open task
      this.cacheStale = true; clearTimeout(this.hqTimer);
      this.hqTimer = setTimeout(() => this.refreshHQViews(), 800);
    }));
    this.addCommand({ id: "open-suggestions", name: "Open suggestions sidebar", callback: () => this.openSuggestions() });
    this.app.workspace.onLayoutReady(() => { if (!this.settings.suggestShown) { this.settings.suggestShown = true; this.saveSettings(); this.openSuggestions(); } });
    this.registerHoverLinkSource(VIEW_TYPE, { display: "Vault Graph", defaultMod: true });   // Ctrl+hover = preview
    this.addRibbonIcon("git-fork", "Open Vault Graph", () => this.open());
    this.addCommand({ id: "open", name: "Open graph", callback: () => this.open() });
    this.addCommand({
      id: "show-current-note", name: "Show current note in graph",
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.open().then(leaf => leaf.view.focusNote && leaf.view.focusNote(file.path));
        return true;
      },
    });
    this.addCommand({ id: "open-local", name: "Open local graph (follows the active note)", callback: () => this.openLocal() });
    this.addCommand({
      id: "refresh", name: "Re-analyse now (normally automatic)",
      checkCallback: checking => { if (!Platform.isDesktopApp) return false; if (!checking) this.refresh(); return true; },
    });
    // the gardener (or Obsidian Sync) rewriting the data file updates open views
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file.path === normalizePath(this.settings.rulesPath)) this.rulesChanged();
      else if (file.path === normalizePath(this.settings.dataPath)) { this.base = null; this.cache = null; this.dataStamp = Date.now(); this.mergeContentFromDisk().then(() => this.reloadSoon()); }
      // the game file (today's picks, XP) and dismissals are written by the graph or another device: the sidebar shows them
      else if (file.path === normalizePath(this.settings.sharedPath) || file.path === normalizePath(this.settings.dismissedPath)) this.sharedChanged(file);
    }));
    // another device's ledger arriving by Sync (a new device's first one is a create)
    this.registerEvent(this.app.vault.on("create", file => { if (file.path.startsWith(normalizePath(VGRules.files.device_ledgers) + "/")) this.sharedChanged(file); }));
    this.registerEvent(this.app.vault.on("modify", file => { if (file.path.startsWith(normalizePath(VGRules.files.device_ledgers) + "/")) this.sharedChanged(file); }));
    // links edited since the analysis are merged in live (see liveMerge); re-merge when you come back to the graph
    this.registerEvent(this.app.metadataCache.on("resolved", () => { this.dirty = true; this.cacheStale = true; this.liveSoon(); }));
    this.registerEvent(this.app.metadataCache.on("resolve", () => { this.dirty = true; this.cacheStale = true; this.liveSoon(); }));
    ["create", "delete", "rename"].forEach(ev => this.registerEvent(this.app.vault.on(ev, () => this.liveSoon())));
    // no starting signature on purpose: graphs open at startup drew from a half-built link index, so the first
    // "resolved" after launch must always refresh them (a signature taken at layout-ready made it look unchanged)
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      const graph = leaf && (leaf.view instanceof VaultGraphView || leaf.view instanceof VaultGraphLocalView);
      if (graph) this.scheduleAutoRefresh(5);   // coming back to the graph: catch up soon if the data is behind
      if (this.dirty && graph) { this.dirty = false; leaf.view.refreshLive ? leaf.view.refreshLive(true) : leaf.view.render(); }
    }));
    // Keep the analysis current (desktop): after a pause in editing it re-runs quietly, open graph or not. The status
    // bar only says so while it runs; between runs the live merge already shows every edit.
    if (Platform.isDesktopApp) {
      // the next step, on every note: the same one HQ marks
      this.nextEl = this.addStatusBarItem(); this.nextEl.addClass("vg-nextstatus"); this.nextEl.onClickEvent(() => this.goNextStep());
      this.app.workspace.onLayoutReady(() => this.nextStepSoon(3000));
      this.registerInterval(window.setInterval(() => this.updateNextStep(), 5 * 60 * 1000));   // the day moves on by itself: the evening's standup
      this.statusEl = this.addStatusBarItem();
      this.statusEl.addClass("vg-status");
      this.statusEl.setAttr("aria-label", "Vault Graph is updating its topics and suggestions");
      const edited = file => { if (file instanceof TFile && file.extension === "md" && !this.ignoreEdit(file.path)) this.scheduleAutoRefresh(); };
      ["modify", "create", "delete", "rename"].forEach(ev => this.registerEvent(this.app.vault.on(ev, edited)));
      this.app.workspace.onLayoutReady(() => { this.updateStatus(); this.scheduleAutoRefresh(10); });   // catch up on edits made while closed (Sync, the other PC)
    }
    // ```vault-graph``` blocks: a live local graph (or a MOC's whole topic) inside a note
    this.registerMarkdownCodeBlockProcessor("vault-graph", (src, el, ctx) => this.embed(src, el, ctx));
    // ```vault-graph-scene``` blocks: a scene written in a note. The block shows what it makes, what wasn't understood,
    // and opens the graph on it
    this.registerMarkdownCodeBlockProcessor(SCENE_LANG, (src, el, ctx) => this.sceneCard(src, el, ctx));
    this.addSettingTab(new VaultGraphSettings(this.app, this));
  }

  // Recall: the places you dealt with something before, inside notes, from whatever you half-remember (words, when,
  // who, what kind of thing, where): VGRules.recallSearch, the same engine as _System/vault_recall.py and the MCP's
  // recall tool. Each note's chunks and date are cached and re-read only when it changed; people come from the people folder.
  // every journal's tasks, for Task survival: read when that lens opens, and re-read only for a note that changed
  async taskHistory() {
    const cache = this.journalCache = this.journalCache || new Map(), out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!VGRules.inDaily(f.path)) continue;
      let c = cache.get(f.path);
      if (!c || c.mtime !== f.stat.mtime) { cache.set(f.path, c = { mtime: f.stat.mtime, j: VGRules.journalOf(f.path, await this.app.vault.cachedRead(f)) }); }
      if (c.j) out.push(c.j);
    }
    return out;
  }
  async recall(query, n = 8) {
    const cache = this.recallCache = this.recallCache || new Map(), notes = [], skip = [VGRules.folders.reports + "/", VGRules.folders.templates + "/", ...EXCLUDE_PREFIXES];
    const people = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(VGRules.folders.people + "/") && f.basename !== "People").map(f => f.basename.split(" ")[0].toLowerCase());
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (skip.some(x => f.path.startsWith(x))) continue;
      let c = cache.get(f.path);
      if (!c || c.mtime !== f.stat.mtime) { const text = await this.app.vault.cachedRead(f);
        cache.set(f.path, c = { mtime: f.stat.mtime, date: VGRules.recallNoteDate(f.path, text), chunks: VGRules.recallChunks(text) }); }
      notes.push({ path: f.path, date: c.date, chunks: c.chunks });
    }
    // the live graph: links with similar-meaning pairs, and how much each note is relied on (links in + opens)
    const data = await this.graphData(), graph = { links: [], use: {} };
    if (data) { graph.links = (data.links || []).filter(l => l.kind === "link" || l.kind === "similar").map(l => [l.source, l.target, l.kind]);
      graph.use = Object.fromEntries((data.nodes || []).map(nd => [nd.id, nd.inlinks || 0])); }
    return VGRules.recallSearch(notes, query, { n, people, graph });
  }

  // Every ```vault-graph-scene``` block in the vault as [{ path, i, raw }] (raw = the parsed YAML), for DATA.scenes.
  // A note is read again only when it changed; notes without a code block are never read.
  async sceneBlocks() {
    const seen = this.sceneSeen = this.sceneSeen || new Map(), out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (EXCLUDE_PREFIXES.some(x => f.path.startsWith(x))) continue;
      const secs = (this.app.metadataCache.getFileCache(f) || {}).sections || [];
      if (!secs.some(x => x.type === "code")) { seen.delete(f.path); continue; }
      let hit = seen.get(f.path);
      if (!hit || hit.mtime !== f.stat.mtime) {
        const text = await this.app.vault.cachedRead(f), blocks = [];
        for (const m of text.matchAll(SCENE_BLOCK)) { try { blocks.push(parseYaml(m[1]) || {}); } catch (e) { blocks.push({ name: "", _yaml: String(e.message || e) }); } }
        seen.set(f.path, hit = { mtime: f.stat.mtime, blocks });
      }
      hit.blocks.forEach((raw, i) => out.push({ path: f.path, i, raw }));
    }
    return out;
  }
  sceneCard(src, el, ctx) {
    const card = el.createDiv({ cls: "vg-scene-card" });
    let raw = null, yamlError = null;
    try { raw = parseYaml(src) || {}; } catch (e) { yamlError = String(e.message || e); }
    const { spec, errors } = VGRules.sceneSpec(raw || {});
    if (yamlError) errors.unshift(`The YAML doesn't parse: ${yamlError}`);
    card.createEl("strong", { text: spec.name });
    card.createEl("div", { cls: "vg-scene-parts", text: spec.entity.map(r => `${r.as} = ${r.label || r.when}`).join(" · ") + ` · ${spec.place} · ${spec.angle}` });
    if (errors.length) { const ul = card.createEl("ul", { cls: "vg-scene-errors" }); errors.forEach(e => ul.createEl("li", { text: e })); }
    const sec = ctx.getSectionInfo(el), i = sec ? (sec.text.split("\n").slice(0, sec.lineStart).join("\n").match(SCENE_BLOCK_START) || []).length : 0;
    const btn = card.createEl("button", { text: "Open in Vault Graph" });
    btn.onclick = async () => { const leaf = await this.open(), key = VGRules.sceneKey(ctx.sourcePath, i);
      for (let t = 0; t < 40 && !(leaf.view.handle && leaf.view.handle.hasView && leaf.view.handle.hasView(key)); t++) await sleep(150);   // a just-edited block remounts first
      if (leaf.view.handle) leaf.view.handle.setView(key); };
  }

  // The main graph's saved node positions, lent to the small views so they don't lay themselves out from scratch
  layoutSeed() { const v = this.settings.view; return v && v.v === 1 ? v.layouts : null; }

  // Every write action: wait for Obsidian to re-index what it wrote, merge once, and push the new state to every
  // surface before returning, so the caller (a button) and everything else see the same, current state
  // The outermost action opens an undo entry; actions it calls (addToMap -> appendSection) add to it. Two actions
  // running at the same moment share one entry, so undoing it undoes both.


  wrapWriteActions() {
    this.undoLog = []; this.undoSeq = 0;
    this.loadUndoLog();
    // every vault write counts, so an action that wrote nothing (a preview, a check) neither waits for the index nor redraws
    WRITE_PRIMITIVES.forEach(k => { const g = this[k].bind(this); this[k] = (...a) => { this.writes = (this.writes || 0) + 1; return g(...a); }; });
    WRITE_ACTIONS.forEach(k => {
      const f = this[k].bind(this); this[k] = async (...a) => { const settled = this.indexSettled(), before = this.writes || 0;
        const own = k !== "undo" && !this.undoCur ? (this.undoCur = { ops: [] }) : null;
        try { return await f(...a); }
        finally { if (own) { this.undoCur = null; await this.closeUndo(own); } if ((this.writes || 0) !== before) { await settled; await this.publish(); } } }; });
  }

