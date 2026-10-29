// vault_graph_plugin.js - Obsidian plugin shell for the Vault Graph.
// Bundled with the force-graph library and vault_graph_view.js into .obsidian/plugins/jk-vault-graph/main.js
// by `python _scripts/vault_graph.py --build-plugin`. Edit here, never the generated main.js.
const { Plugin, ItemView, Notice, PluginSettingTab, Setting, Platform, TFile, normalizePath, MarkdownRenderChild, parseYaml, moment } = require("obsidian");

const VIEW_TYPE = "vault-graph";
const LOCAL_TYPE = "vault-graph-local";
const HOME_TYPE = "vault-graph-home";   // for home-screen hosts such as Hearth's "Plugin view" card
// home cards that always show one map: Hearth cards pick a view type, not a state, so each gets its own type
const FIXED_HOME = { radar: "Radar", clock: "Heat clock", foodweb: "Food web", weather: "Weather", city: "City" };
const fixedType = v => `vault-graph-${v}`;
const HQ_TYPE = "vault-graph-hq";   // Vault HQ: the vault's home screen (src/hq.js)
// every view that draws the one live state: each redraws when it changes (publish) and when the rules change
const STATE_VIEWS = () => [VIEW_TYPE, LOCAL_TYPE, HOME_TYPE, ...Object.keys(FIXED_HOME).map(fixedType), HQ_TYPE];
const HOME_FAVOURITES = ["foodweb", "clock", "weather", "sky"];   // what ‹ › cycles in the home card: the maps that read well small
const MARKER = "%% vault-graph:generated";   // regenerated notes keep everything above this line
const DEFAULTS = {
  dataPath: VGRules.files.data,               // written by the analysis (files in vault_graph_rules.json)
  script: VGRules.files.analysis,
  python: "",                                  // empty = "python" on Windows, "python3" elsewhere
  dismissedPath: VGRules.files.dismissed,
  sharedPath: VGRules.files.shared,           // cosmos + saved views + review state, synced with the vault
  rulesPath: `${VGRules.folders.scripts}/vault_graph_rules.json`,   // this vault's rules (the analysis reads it too)
};
const BUILT_RULES = VGRules.RULES;   // the defaults this build carries; loadRules layers the vault's over them
// The rules the settings tab shows and edits: [path in the rules file, name, what it is]. Everything else stays in the file.
const RULE_FIELDS = [
  [["folders", "inbox"], "Inbox folder", "Where new notes and maps go"],
  [["folders", "daily"], "Daily notes folder", "Journals and standups (the top folder)"],
  [["folders", "people"], "People folder", "One note per person"],
  [["folders", "archive"], "Archive folder", "Where Archive moves a note (it keeps its folder inside)"],
  [["folders", "reports"], "Reports folder", "Self-tests and other reports"],
  [["stale_days"], "Days until stale", "A note not edited for this long asks whether it's still current"],
];
// Always live: links, tasks, tags, maps, new and deleted notes merge in at once (liveMerge); the slower parts
// (topics, gaps, influence) are re-analysed in the background after this many seconds without an edit (desktop).
// Not a setting any more: there is no "refresh" step for you to remember.
const ANALYSE_AFTER_IDLE = 30;

// Obsidian mobile's floating navigation bar sits over the bottom of the view: tell the renderer how much
// to lift its bottom controls (dock, toasts, sheets) so nothing hides behind it.
function watchMobileNavbar(view) {
  if (!Platform.isMobile) return;
  const update = () => {
    const nav = document.querySelector(".mobile-navbar"), r = nav && nav.getClientRects().length ? nav.getBoundingClientRect() : null;
    // never more than the bar is tall: pulling the pane down for Obsidian's actions moves it below the bar for a
    // moment, which measured as a huge overlap and left the dock stuck halfway up the screen
    const overlap = r ? Math.min(r.height, Math.max(0, view.contentEl.getBoundingClientRect().bottom - r.top)) : 0;
    // on the pane, not the graph's root: a remount (live refresh, re-render) makes a new root, which inherits it.
    // Set on the root, it was lost until the next resize and the bottom controls sat under Obsidian's bar.
    view.contentEl.style.setProperty("--vg-bottom", Math.round(overlap + (overlap ? 8 : 0)) + "px");
  };
  const ro = new ResizeObserver(update);
  ro.observe(view.contentEl);
  view.register(() => ro.disconnect());
  // measured again once a swipe settles (the pull-down gesture moves the pane without resizing it)
  const settle = () => { setTimeout(update, 50); setTimeout(update, 450); };
  ["touchend", "touchcancel"].forEach(ev => view.registerDomEvent(document, ev, settle, { passive: true }));
  setTimeout(update, 300); setTimeout(update, 1500);
}

// Right after Obsidian starts its link index is still being built. Merging then saw no links at all, so every
// note looked unlinked and was hidden (2D showed only people; replay found no dated notes). Merge once it's built.
function linksReady(app) {
  const mc = app.metadataCache;
  if (mc.initialized && !mc.inProgressTaskCount && Object.keys(mc.resolvedLinks || {}).length) return Promise.resolve();
  return new Promise(done => { const ref = mc.on("resolved", () => { mc.offref(ref); done(); }); setTimeout(done, 20000); });
}

// Bring an open graph up to date with the vault, keeping the camera and selection.
async function refreshLive(view, force) {
  if (!view.handle) return view.render();
  // Link changes (a link added here, in the sidebar or in a note) patch the open graph in place: layout, orbits,
  // selection and camera stay put, so every view updates as you work. Only notes arriving or leaving remount it.
  if (view.handle.applyLive) {
    const data = await view.plugin.graphData();
    if (data && view.handle && view.handle.applyLive(structuredClone(data))) { view.plugin.dirty = false; return; }
  }
  const busy = view.app.workspace.activeLeaf === view.leaf && Date.now() - (view.lastInput || 0) < 5000;
  if (busy && !force) { clearTimeout(view.liveRetry); view.liveRetry = setTimeout(() => refreshLive(view), 5000); return; }
  const vp = view.handle.viewport ? view.handle.viewport() : null;
  await view.render();
  if (vp && view.handle && view.handle.restoreViewport) view.handle.restoreViewport(vp);
}
function trackInput(view) {   // pointer, wheel and keys in the pane count as "using it"
  const mark = () => { view.lastInput = Date.now(); };
  ["pointerdown", "wheel", "keydown"].forEach(ev => view.registerDomEvent(view.contentEl, ev, mark, { passive: true }));
}

class VaultGraphView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.handle = null; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Vault Graph"; }
  getIcon() { return "git-fork"; }
  async onOpen() { trackInput(this); await this.render(); }
  refreshLive(force) { return refreshLive(this, force); }
  async onClose() { this.renderToken = (this.renderToken || 0) + 1; this.unmount(); }   // a render still loading won't draw
  unmount() { if (this.handle) { this.handle.destroy(); this.handle = null; } }


  async render() {
    // Renders can overlap (open + live refresh): load first, then only the newest one tears down and draws.
    // Tearing down before the await let two finish and stack two live graphs in the pane.
    const token = this.renderToken = (this.renderToken || 0) + 1;
    const el = this.contentEl;
    const data = await this.plugin.graphData();   // the one live state (analysis + live merge), shared by every surface
    if (token !== this.renderToken) return;
    this.unmount();
    el.empty(); el.addClass("vg-host");
    if (!data) { el.createEl("p", { text: "No graph data yet." }); return; }
    this.plugin.dirty = false;
    const root = el.createDiv();
    this.handle = mountVaultGraph(root, structuredClone(data), {   // the view keeps positions on its nodes: its own copy
      ...this.plugin.viewActions(this),   // the same actions every graph surface gets
      store: {   // layout + view settings live in the plugin's data.json (Obsidian Sync carries it)
        load: () => this.plugin.settings.view || null,
        save: view => { this.plugin.settings.view = view; this.plugin.saveSettings(); },
      },
      onHoverNote: (notePath, event) => this.app.workspace.trigger("hover-link", {
        event, source: VIEW_TYPE, hoverParent: this, targetEl: this.contentEl, linktext: notePath,
      }),
      sharedStore: this.plugin.sharedStore(),
      mocReport: { load: () => this.plugin.loadMocReport(), tick: (line, on) => this.plugin.tickMocRow(line, on),
                   apply: Platform.isDesktopApp ? () => this.plugin.applyMocReport() : undefined },
      saveBinary: (notePath, buf) => this.plugin.saveBinary(notePath, buf),
      mobile: Platform.isMobile,
    });
  }

  focusNote(notePath) { if (this.handle) this.handle.focusNote(notePath); }
  onload() { watchMobileNavbar(this); }
}

// Local graph: a compact side-pane view of the active note's neighbourhood that follows you around.
class VaultGraphLocalView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.handle = null; }
  getViewType() { return LOCAL_TYPE; }
  getDisplayText() { return "Vault Graph (local)"; }
  getIcon() { return "git-fork"; }
  refreshLive(force) { return refreshLive(this, force); }
  async onOpen() {
    trackInput(this);
    await this.render();
    this.registerEvent(this.app.workspace.on("file-open", file => this.follow(file)));
  }
  async onClose() { this.renderToken = (this.renderToken || 0) + 1; if (this.handle) { this.handle.destroy(); this.handle = null; } }
  async render() {
    const token = this.renderToken = (this.renderToken || 0) + 1;   // only the newest overlapping render draws
    const el = this.contentEl;
    const shared = await this.plugin.graphData();   // the one live state; injectNote adds to a copy
    if (token !== this.renderToken) return;
    if (this.handle) { this.handle.destroy(); this.handle = null; }
    el.empty(); el.addClass("vg-host");
    if (!shared) { el.createEl("p", { text: "No graph data yet." }); return; }
    const data = structuredClone(shared);
    this.file = this.file || this.app.workspace.getActiveFile();
    this.injectNote(data, this.file);
    this.note = el.createDiv({ cls: "vg-local-note" });
    this.note.style.cssText = "font-size:var(--font-ui-smaller);color:var(--text-muted);padding:4px 8px;";
    this.note.hide();
    const root = el.createDiv();
    this.handle = mountVaultGraph(root, data, {
      compact: true, mobile: Platform.isMobile, layoutSeed: () => this.plugin.layoutSeed(),
      // the pane redraws whenever it follows you to a note or the data refreshes: reopen in the view you picked
      initialView: this.plugin.settings.localView || undefined,
      onViewChange: view => { if (this.plugin.settings.localView !== view) { this.plugin.settings.localView = view; this.plugin.saveSettings(); } },
      ...this.plugin.viewActions(this),
      openNote: (notePath, newPane) => {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (file instanceof TFile) this.app.workspace.getLeaf(newPane ? "tab" : false).openFile(file);
      },
      onHoverNote: (notePath, event) => this.app.workspace.trigger("hover-link", {
        event, source: VIEW_TYPE, hoverParent: this, targetEl: this.contentEl, linktext: notePath,
      }),
    });
    if (this.plugin.settings.localView) this.handle.setView(this.plugin.settings.localView);   // views the start-up can't open directly (cosmos)
    this.follow(this.file, true);
  }

  // Notes the analysis leaves out (daily notes, standups, 00-Inbox, people…) aren't in the graph data, and
  // neither are most of the notes they link to (other dailies and standups). Add the note and every note it
  // links to or is linked from as temporary nodes, plus those neighbours' links into the topic graph, so the
  // local graph shows the real neighbourhood. Only the note itself counts as "not linked to anything".
  injectNote(data, file) {
    if (!file || file.extension !== "md" || data.nodes.some(n => n.id === file.path)) return false;   // topic notes: graph neighbours only
    const resolved = this.app.metadataCache.resolvedLinks || {}, byId = new Map(data.nodes.map(n => [n.id, n]));
    const linkable = id => id !== file.path && id.endsWith(".md") && ![".trash", VGRules.folders.templates, VGRules.folders.system].some(f => id.startsWith(f + "/"))
      && this.app.vault.getAbstractFileByPath(id) instanceof TFile;
    const neighbours = id => [...new Set([
      ...Object.keys(resolved[id] || {}),
      ...Object.entries(resolved).filter(([src, t]) => t[id]).map(([src]) => src),
    ])];
    const inGraph = byId.has(file.path);
    const nbrs = neighbours(file.path).filter(linkable);
    if (!nbrs.length) return false;
    const MAX = 60;   // a busy hub or rollup can link hundreds of dailies: keep the pane readable
    const ranked = nbrs.sort((x, y) => (byId.has(y) - byId.has(x)) || x.localeCompare(y)).slice(0, MAX);
    const temp = id => {
      if (byId.has(id)) return byId.get(id);
      const f = this.app.vault.getAbstractFileByPath(id);
      const n = { id, name: f.basename, cluster: -1, bc: 0, folder: f.parent ? f.parent.path : "", mentions: 0, recent: 0,
        opens: 0, opens90: 0, inlinks: 0, outlinks: 0, broken: 0, tasks: 0, words: 0,
        age: Math.max(0, Math.round((Date.now() - f.stat.mtime) / 864e5)), refs: true, isolated: false, live: true };
      data.nodes.push(n); byId.set(id, n);
      return n;
    };
    const seen = new Set(data.links.filter(l => l.kind === "link").map(l => [l.source, l.target].sort().join("|")));
    const link = (x, y) => { const k = [x, y].sort().join("|"); if (!seen.has(k)) { seen.add(k); data.links.push({ source: x, target: y, w: 1, kind: "link" }); } };
    const self = inGraph ? byId.get(file.path) : temp(file.path);
    ranked.forEach(id => { temp(id); link(file.path, id); });
    // one more hop for the temporary neighbours: where they meet the topic graph (so depth 2 means something)
    ranked.filter(id => !data.nodes.find(n => n.id === id && n.cluster >= 0)).forEach(id =>
      neighbours(id).filter(m => byId.has(m) && byId.get(m).cluster >= 0).slice(0, 8).forEach(m => link(id, m)));
    // colour: the topic most of its graph neighbours belong to
    const votes = {};
    ranked.forEach(id => { const c = byId.get(id).cluster; if (c >= 0) votes[c] = (votes[c] || 0) + 1; });
    const best = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
    if (!inGraph) self.cluster = best ? +best[0] : -1;
    ranked.forEach(id => { const n = byId.get(id); if (n.live && n.cluster < 0 && best) n.cluster = +best[0]; });
    return true;
  }

  // Follow the active note. A note not in the loaded data is injected with a re-render (once per note).
  follow(file, fromRender) {
    if (!file || file.extension !== "md") return;
    this.file = file;
    if (!this.handle) return;
    if (this.handle.setLocal(file.path)) { this.note.hide(); return; }
    if (!fromRender && this.injectedFor !== file.path) { this.injectedFor = file.path; this.render(); return; }
    this.note.setText(`“${file.basename}” doesn't link to any other note, and nothing links to it, so this shows the whole map.`);
    this.note.show();
  }
}

// Home-screen view: the whole graph with minimal chrome, made to live in a dashboard card (Hearth's
// "Plugin view" card hosts any registered view). Remembers its mode; a tap opens the note.
class VaultGraphHomeView extends ItemView {
  constructor(leaf, plugin, fixed) { super(leaf); this.plugin = plugin; this.handle = null; this.fixed = fixed || null; }
  getViewType() { return this.fixed ? fixedType(this.fixed) : HOME_TYPE; }
  getDisplayText() { return this.fixed ? `Vault Graph (${FIXED_HOME[this.fixed].toLowerCase()})` : "Vault Graph (home)"; }
  getIcon() { return "git-fork"; }
  async onOpen() { trackInput(this); await this.render(); }
  refreshLive(force) { return refreshLive(this, force); }
  async onClose() { this.renderToken = (this.renderToken || 0) + 1; if (this.handle) { this.handle.destroy(); this.handle = null; } }
  async render() {
    const token = this.renderToken = (this.renderToken || 0) + 1;   // only the newest overlapping render draws
    const el = this.contentEl;
    const data = await this.plugin.graphData();
    if (token !== this.renderToken) return;
    if (this.handle) { this.handle.destroy(); this.handle = null; }
    el.empty(); el.addClass("vg-host"); el.addClass("vg-home");
    if (!data) { el.createEl("p", { text: "Vault Graph: no graph data yet." }); return; }
    const root = el.createDiv();
    this.handle = mountVaultGraph(root, structuredClone(data), {
      compact: true, embed: true, mobile: Platform.isMobile, layoutSeed: () => this.plugin.layoutSeed(),
      initialView: this.fixed || this.plugin.settings.homeView || "foodweb",
      favourites: this.fixed ? undefined : HOME_FAVOURITES,
      ...this.plugin.viewActions(this),
      openNote: (notePath, newPane) => {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (file instanceof TFile) this.app.workspace.getLeaf(newPane ? "tab" : "tab").openFile(file);
      },
      onHoverNote: (notePath, event) => this.app.workspace.trigger("hover-link", {
        event, source: VIEW_TYPE, hoverParent: this, targetEl: this.contentEl, linktext: notePath,
      }),
      onViewChange: view => { if (!this.fixed && this.plugin.settings.homeView !== view) { this.plugin.settings.homeView = view; this.plugin.saveSettings(); } },
    });
    this.handle.setView(this.fixed || this.plugin.settings.homeView || "foodweb");
  }
}


// Obsidian's dialogs for the shared actions: a confirm (resolves true/false) and a line of text (resolves it, or null
// when cancelled). Each answers before closing: close() runs onClose straight away, and a promise keeps its first
// answer, so closing first turned every OK into a Cancel.
function confirmModal(app, title, text, ok) {
  return new Promise(resolve => {
    const { Modal } = require("obsidian"), m = new Modal(app);
    m.titleEl.setText(title); m.contentEl.createEl("p", { text });
    const row = m.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => { resolve(false); m.close(); };
    const b = row.createEl("button", { text: ok || "Do it", cls: "mod-cta" }); b.onclick = () => { resolve(true); m.close(); };
    m.onClose = () => resolve(false); m.open();
  });
}
function inputModal(app, title, text, placeholder) {
  return new Promise(resolve => {
    const { Modal } = require("obsidian"), m = new Modal(app);
    m.titleEl.setText(title); m.contentEl.createEl("p", { text });
    const input = m.contentEl.createEl("input", { type: "text", attr: { placeholder: placeholder || "" } }); input.style.width = "100%";
    const row = m.contentEl.createDiv({ cls: "modal-button-container" }), ok = () => { resolve(input.value.trim()); m.close(); };
    row.createEl("button", { text: "Cancel" }).onclick = () => { resolve(null); m.close(); };
    row.createEl("button", { text: "OK", cls: "mod-cta" }).onclick = ok;
    input.addEventListener("keydown", e => { if (e.key === "Enter") ok(); });
    m.onClose = () => resolve(null); m.open(); setTimeout(() => input.focus(), 0);
  });
}

// Vault HQ: the vault's home screen (src/hq.js) over the one live state and the shared file's marks. It mounts once
// and updates in place after each change, keeping its screen and scroll.
class VaultHQView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.handle = null; }
  getViewType() { return HQ_TYPE; }
  getDisplayText() { return "Vault HQ"; }
  getIcon() { return "layout-dashboard"; }
  async onOpen() { await this.render(); }
  onload() { watchMobileNavbar(this); }
  async onClose() { this.renderToken = (this.renderToken || 0) + 1; if (this.handle) { this.handle.destroy(); this.handle = null; } }
  refreshLive() { return this.render(); }
  renderSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.render(), 150); }
  async render() {
    const token = this.renderToken = (this.renderToken || 0) + 1;   // only the newest overlapping render draws
    const data = await this.plugin.graphData(), sh = await this.plugin.loadShared();
    if (token !== this.renderToken) return;
    const state = { review: (sh && sh.review) || {}, hidden: ((sh && sh.cosmos) || {}).hidden || [] };
    const d = data || { nodes: [], links: [], hq: await this.plugin.hqData() };
    if (this.handle) { this.handle.update(d, state); return; }
    const el = this.contentEl; el.empty(); el.addClass("vg-hq-host");
    const api = this.plugin.viewActions(this), open = api.openNote;
    api.openNote = notePath => open(notePath, true);   // a note opens in its own tab: HQ stays where it is
    api.searchNotes = (query, count) => this.plugin.recall(query, count);
    this.handle = mountVaultHQ(el.createDiv({ cls: "vg-hq-root" }), d, {
      api, state, mobile: Platform.isMobile, screen: this.plugin.settings.hqScreen,
      onScreen: s => { this.plugin.settings.hqScreen = s; this.plugin.saveSettings(); },
      ask: (title, text, ok) => confirmModal(this.app, title, text, ok),
      input: (title, text, placeholder) => inputModal(this.app, title, text, placeholder),
      onDone: msg => this.plugin.recordAction(msg),
      openGraph: () => this.plugin.open(),
    });
  }
}

// Suggestions sidebar: the one next step for the note you're writing, plus today's quests. Built with
// Obsidian's DOM helpers (no innerHTML). Actions ask first and count toward XP/quests in the graph.
const SUGGEST_TYPE = "vault-graph-suggest";
// the shared actions' icon names (the graph's own set) as Obsidian's Lucide icons
const LUCIDE = { open: "external-link", target: "crosshair", link: "link", plus: "plus", reviewed: "check", file: "bookmark", tasks: "check-square",
  close: "x", folder: "archive", copy: "copy" };
class VaultGraphSuggestView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.file = null; }
  getViewType() { return SUGGEST_TYPE; }
  getDisplayText() { return "Vault Graph suggestions"; }
  getIcon() { return "lightbulb"; }
  async onOpen() {
    this.registerEvent(this.app.workspace.on("file-open", f => { if (f) { this.file = f; this.renderSoon(); } }));
    this.file = this.app.workspace.getActiveFile();
    this.render();
  }
  renderSoon() { clearTimeout(this.t); this.t = setTimeout(() => this.render(), 150); }
  confirm(title, text, ok) { return confirmModal(this.app, title, text, ok); }
  async act(label, fn, logText) {
    try { await fn(); if (logText) await this.plugin.recordAction(logText); this.render(); }   // the action published the new state
    catch (e) { new Notice(`${label} didn't work: ${e.message || e}`); }
  }
  // Link two notes, writing the Related line into the staler one (linking it is a touch, so it stops being stale)
  // Fuzzy picker over the vault's notes; resolves to a TFile, or null when cancelled
  pickNote(placeholder, filter) {
    return new Promise(resolve => {
      const { FuzzySuggestModal } = require("obsidian"), app = this.app;
      class Picker extends FuzzySuggestModal {
        getItems() { return app.vault.getMarkdownFiles().filter(f => !filter || filter(f)); }
        getItemText(f) { return f.path.replace(/\.md$/, ""); }
        onChooseItem(f) { resolve(f); }
      }
      const m = new Picker(app);
      m.setPlaceholder(placeholder);
      const close = m.onClose.bind(m);
      m.onClose = () => { close(); setTimeout(() => resolve(null), 0); };   // runs before onChooseItem; the choice wins
      m.open();
    });
  }
  // The context the shared note actions (vault_graph_actions.js) run in here: the same buttons, confirmations and
  // results as the graph's inspector. Each write publishes the new state, which redraws this sidebar too.
  actionCtx(data) {
    const api = this.plugin.viewActions(this);
    return {
      api, data,
      ask: (title, text, ok) => this.confirm(title, text, ok),
      input: (title, text, placeholder) => inputModal(this.app, title, text, placeholder),
      showRows: async path => { const leaf = await this.plugin.openHQ();   // a report's rows, ticked in Vault HQ
        for (let t = 0; t < 40 && !leaf.view.handle; t++) await sleep(100); if (leaf.view.handle) leaf.view.handle.showRows(path); },
      pick: (placeholder, filter) => this.pickNote(placeholder, f => !filter || filter(f.path)).then(f => (f ? f.path : null)),
      done: (msg, undo) => { undoNotice(msg, undo); this.plugin.recordAction(msg); },
      fail: msg => new Notice(msg),
      focus: async id => { const leaf = await this.plugin.open(); if (leaf.view && leaf.view.focusNote) leaf.view.focusNote(id); },
      copy: id => navigator.clipboard.writeText(`[[${this.plugin.linkText(id, "")}]]`).then(() => new Notice("Copied link")),
      icon: (b, name) => { const s = b.createSpan({ cls: "vg-s-bic" }); require("obsidian").setIcon(s, LUCIDE[name] || name); },
    };
  }
  async render() {
    const token = this.renderToken = (this.renderToken || 0) + 1;   // only the newest overlapping render draws
    const data = await this.plugin.graphData(), file = this.file;
    if (token !== this.renderToken) return;
    const el = this.contentEl, scroll = el.scrollTop;   // a redraw after an action keeps your place
    el.empty(); el.addClass("vg-suggest");
    if (!data) { el.createEl("p", { cls: "vg-s-muted", text: "No graph data yet." }); return; }
    const byId = new Map(data.nodes.map(n => [n.id, n])), n = file && byId.get(file.path);
    const clusterName = c => { const x = data.clusters.find(k => k.id === c); return x ? (x.label || x.name) : "Unclustered"; };
    const moc = n && VGRules.mapForCluster(data.mocs, n.cluster);
    const ctx = this.actionCtx(data);
    this.tasksLoading = null;
    // a note the graph doesn't hold (a daily, an Inbox capture...) still gets the actions that don't need the graph
    const subject = n || (file && file.extension === "md" ? { id: file.path, name: file.basename, tasks: 0, refs: true, cluster: null } : null);
    const run = (key, node) => VGActions.run(key, node || subject, ctx);
    const head = el.createDiv({ cls: "vg-s-head" });
    head.createEl("div", { cls: "vg-s-title", text: file ? file.basename : "No note open" });
    if (n) head.createEl("div", { cls: "vg-s-muted", text: `${clusterName(n.cluster)} · ${n.inlinks} in · ${n.outlinks} out` });
    if (subject) VGActions.render(head.createDiv({ cls: "vg-s-acts vg-s-noteacts" }), VGActions.forNote(subject, ctx), subject, ctx, { btn: "vg-s-btn", primary: "mod-cta", ghost: "vg-s-ghost" });
    // every suggestion for this note, best first; each button is one of the shared actions above
    const items = [];
    if (n) {
      const said = (data.said_unlinked || []).find(([id]) => id === n.id);
      // same rule as appendSection's "Already in…" (shared, vault_graph_rules.js)
      const inMap = moc ? VGRules.onMap(moc, n.id) : null;
      if (said && moc && !inMap) items.push({ icon: "sun", title: `Named in ${said[1]} daily notes but never linked`, sub: `Add it to ${moc.title} so its topic map links it`, btn: "Add to map", run: () => run("map") });
      else if (said) items.push({ icon: "sun", title: `Named in ${said[1]} daily notes but never linked`, sub: "Turn the first plain mention in each into a link", btn: "Link mentions", run: () => run("mentions") });
      if (moc && inMap === false && !(said && moc)) items.push({ icon: "hexagon", title: `Not listed in its topic's map`, sub: moc.title, btn: "Add to map", run: () => run("map") });
      data.links.filter(l => VGRules.isSuggestion(l) && (l.source === n.id || l.target === n.id)).forEach(l => {
        const other = byId.get(l.source === n.id ? l.target : l.source); if (!other) return;
        items.push({ icon: "link", title: `Link ${other.name}`, sub: l.why, btn: "Link", ghost: "Dismiss", open: other.id,
          run: async () => {
            // the Related line goes in the staler note: linking it is a touch, so it stops being stale
            const intoOther = (other.age || 0) > (n.age || 0);
            const [from, to] = intoOther ? [other, n] : [n, other];
            const where = intoOther ? `"${other.name}"'s Related section (it's the staler note)` : "this note's Related section";
            if (await this.confirm("Link these notes", `Add a link between "${n.name}" and "${other.name}" in ${where}?`, "Link"))
              this.act("Link", () => this.plugin.linkNotes(from.id, to.id, l.why), `Linked ${n.name} ↔ ${other.name}`); },
          dismiss: () => this.act("Dismiss", () => this.plugin.dismiss(n.id, other.id, l.kind), `Dismissed ${n.name} ↔ ${other.name}`) });
      });
      if (n.tasks) items.push({ icon: "check-square", title: `${n.tasks} open task${n.tasks === 1 ? "" : "s"}`, sub: "Check them off here", tasks: true });
      if (staleFor(n, (data.quality || {}).stale_days)) items.push({ icon: "clock", title: `Not edited in ${n.age} days`, sub: "Still current? Mark it reviewed", btn: "Still current", run: () => run("current") });
      if (n.refs === false) items.push({ icon: "bookmark", title: "No references", sub: "Point it at the map or reference note that holds its links", btn: "Add reference", run: () => run("reference") });
      if (n.isolated) items.push({ icon: "unlink", title: "Not linked to any topic note", sub: "Link it to the note it belongs with", btn: "Link to…", run: () => run("link") });
    } else if (subject) items.push({ icon: "info", title: "Not in the graph yet", sub: "Link it to a topic note so the next analysis places it", btn: "Link to…", run: () => run("link") });
    const sec = (t) => el.createDiv({ cls: "vg-s-sec", text: t });
    if (items.length) {
      sec("Suggested next step");
      items.forEach((it, i) => {
        const card = el.createDiv({ cls: "vg-s-card" + (i === 0 ? " is-top" : "") });
        const top = card.createDiv({ cls: "vg-s-row" });
        const ic = top.createSpan({ cls: "vg-s-ic" }); require("obsidian").setIcon(ic, it.icon);
        const txt = top.createDiv({ cls: "vg-s-txt" }); txt.createDiv({ text: it.title, cls: "vg-s-t" }); if (it.sub) txt.createDiv({ text: it.sub, cls: "vg-s-muted" });
        const acts = card.createDiv({ cls: "vg-s-acts" });
        if (it.btn) { const b = acts.createEl("button", { text: it.btn, cls: i === 0 ? "mod-cta" : "" }); b.onclick = () => it.run(); }
        if (it.ghost) { const b = acts.createEl("button", { text: it.ghost }); b.onclick = () => it.dismiss(); }
        if (it.open) { const b = acts.createEl("button", { text: "Open" }); b.onclick = () => { const f = this.app.vault.getAbstractFileByPath(it.open); if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f); }; }
        if (it.tasks) {
          const box = card.createDiv({ cls: "vg-s-tasks" });
          // same task actions as the graph views: complete or cancel one, or close the whole note
          this.tasksLoading = this.plugin.readTasks(n.id).then(ts => {
            if (ts.length) {
              const all = box.createDiv({ cls: "vg-s-acts" });
              VGActions.render(all, VGActions.forNote(n, ctx, ["complete", "cancel"]), n, ctx, { btn: "vg-s-btn" });
            }
            ts.slice(0, 20).forEach(tk => {
              const row = box.createDiv({ cls: "vg-s-task" }), lab = row.createEl("label"), cb = lab.createEl("input", { type: "checkbox", attr: { title: "Complete" } });
              lab.createSpan({ text: tk.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1") });
              cb.onchange = () => this.act("Check off", () => this.plugin.setTaskStatus(n.id, tk.line, tk.text, "x"), `Checked off “${tk.text.slice(0, 60)}” in ${n.name}`);
              row.createEl("button", { text: "Cancel", cls: "vg-s-task-cancel", attr: { title: "Cancel this task" } }).onclick = () =>
                this.act("Cancel task", () => this.plugin.setTaskStatus(n.id, tk.line, tk.text, "-"), `Cancelled “${tk.text.slice(0, 60)}” in ${n.name}`);
            });
          });
        }
      });
    } else if (n) { sec("Suggested next step"); el.createDiv({ cls: "vg-s-card", text: "Nothing to do for this note." }); }
    // Today: the same list as the graph (VGRules.todayList), its three picks first. The picks are the graph's saved
    // ones for today; before a graph has opened today, the same rule picks them from this list.
    const sh = await this.plugin.loadShared(), cos = (sh && sh.cosmos) || {};
    if (token !== this.renderToken) return;   // a newer render emptied the pane while this one waited
    this.hidden = this.hidden || new Set();   // dismissed here: gone at once, before the game file catches up
    const hidden = new Set([...(cos.hidden || []), ...this.hidden]);
    const g = VGRules.graph(data, { review: sh && sh.review }), liveDone = q => VGRules.questDone(q, g);
    const list = VGRules.todayList(data, { review: sh && sh.review, hidden: [...hidden], today: today() });
    const saved = cos.daily && cos.daily.date === today() ? (cos.daily.quests || []).filter(q => !hidden.has(q.key) && (q.done || VGRules.missionValid(q, g))) : null;
    const picks = saved || VGRules.todayPick(list), pickKeys = new Set(picks.map(q => q.key));
    sec("Today");
    const stats = el.createDiv({ cls: "vg-s-stats" });
    const days = new Set((cos.log || []).map(e => e.date)); let d = new Date(), streak = 0;
    if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
    while (days.has(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
    [[`${streak}`, "day streak"], [`${cos.xp || 0}`, "XP"], [`${picks.filter(q => liveDone(q)).length}/${picks.length}`, "today"]]
      .forEach(([v, l]) => { const c = stats.createDiv(); c.createEl("b", { text: v }); c.createSpan({ text: l }); });
    // close every open task in a note (the same setNoteTasks the graph's task lists use)
    const taskAll = (id, how) => { const tn = byId.get(id), a = VGActions.ACTIONS.find(x => x.key === (how === "-" ? "cancel" : "complete"));
      return [a.label(tn, ctx), () => run(a.key, tn)]; };
    const openNote = id => ["Open", () => { const f = this.app.vault.getAbstractFileByPath(id); if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f); }];
    // one row per item: its action (VGActions.runToday, as in the graph), Open, Not related for a pair, and hide
    const row = (it, pick) => {
      const done = pick && liveDone(it), noteId = it.id || (it.ids || [])[0], tn = noteId && byId.get(noteId);
      const c = el.createDiv({ cls: "vg-s-card vg-s-questcard" + (done ? " is-done" : "") });
      const x = c.createEl("button", { cls: "vg-s-hide clickable-icon", attr: { "aria-label": done ? "Clear it" : "Not for me — hide it", title: done ? "Clear it" : "Not for me — hide it" } });
      require("obsidian").setIcon(x, "x");
      x.onclick = async () => { this.hidden.add(it.key); c.remove(); await this.plugin.hideGameItem(it.key); this.renderSoon(); };
      const t = c.createDiv({ cls: "vg-s-txt" });
      t.createDiv({ text: `${pick ? (done ? "✓ " : "○ ") : ""}${it.title}`, cls: "vg-s-t" });
      if (it.why && !done) t.createDiv({ text: it.why, cls: "vg-s-muted" });
      if (done) return;
      const acts = c.createDiv({ cls: "vg-s-acts" }), actions = [];
      if (VGActions.todayWhen(it, ctx)) actions.push([VGActions.todayLabel(it), async () => { if (await VGActions.runToday(it, ctx) && pick) await this.plugin.markQuestDone(it.key); }]);
      if (it.kind === "link") actions.push(["Not related", () => this.act("Dismiss", () => this.plugin.dismiss(it.a, it.b, "gap"), `Dismissed ${it.names[0]} ↔ ${it.names[1]}`)]);
      // an HQ item (a task, a draft...): the same Later, Reject, Delegate and Open as in Vault HQ
      VGActions.todayMore(it, ctx).filter(m => !(m.key === "open" && VGActions.todayLabel(it) === "Open")).forEach(m => actions.push([m.label, () => VGActions.runMore(m, it, ctx)]));
      if (tn && !VGRules.TODAY_GROUP[it.kind]) actions.push(openNote(noteId));
      if (tn && tn.tasks > 0) actions.push(taskAll(noteId, "x"), taskAll(noteId, "-"));   // the item's note has open tasks
      actions.forEach(([label, fn], i) => { const btn = acts.createEl("button", { text: label, cls: i === 0 ? "mod-cta" : "" }); btn.onclick = () => fn(); });
    };
    picks.forEach(q => row(q, true));
    const rest = list.filter(it => !pickKeys.has(it.key));
    if (rest.length) { sec(`Next up · ${rest.length}`); rest.slice(0, 3).forEach(it => row(it, false)); }
    if (!picks.length && !rest.length) el.createDiv({ cls: "vg-s-card", text: "Nothing to do today." });
    const open = el.createEl("button", { text: "Open Vault Graph", cls: "vg-s-open" }); open.onclick = () => this.plugin.open();
    el.scrollTop = scroll;
    if (this.tasksLoading) this.tasksLoading.then(() => { if (token === this.renderToken) el.scrollTop = scroll; });
  }
}
// local date, not UTC: in Central time the UTC date rolls over at 7 PM, which dated notes and quests a day early
const { today, localDay } = VGRules;   // the shared date rules (this device's calendar day)
// Every plugin method that writes to the vault. onload wraps each so it announces the change when done (every open
// surface redraws); viewActions hands the same methods to every graph surface. A new write action goes in this list.
const WRITE_ACTIONS = ["openDaily", "linkNotes", "writeNote", "appendSection", "moveNote", "renameMap", "setTaskStatus", "completeTask", "logWork", "setTasksStatus", "setTaskField", "setNoteStatus", "setProjectStatus", "setNoteTasks", "stampReviewed", "dismiss", "linkMentions",
  "addReference", "tickMocRow", "saveBinary", "stateSnapshots", "undo"];
// The only methods that touch the vault for a write action. Each notes what it's about to change in the open undo
// entry, so every action can be undone from the message that confirms it. tests/test_rules.js fails on a vault write
// anywhere else (outside STATE_WRITERS).
const WRITE_PRIMITIVES = ["ioProcess", "ioModify", "ioFrontMatter", "ioCreate", "ioCreateBinary", "ioRename", "ioFolder", "ioTrash", "ioData"];
const UNDO_KEEP = 20;   // actions that can still be undone (this session)
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
    await this.loadDismissed();   // dismissed pairs stop showing at once (the analysis drops them at its next run)
    CONTENT.log = {};
    for (const p of [CONTENT.path, VGRules.files.content_backup]) {   // the backup when a reinstall removed the plugin folder
      try { CONTENT.log = JSON.parse(await this.app.vault.adapter.read(normalizePath(p))); break; } catch (e) { /* try the next */ }
    }
    // keep the content log current: a note's "since" moves only when its fingerprint changes
    this.registerEvent(this.app.vault.on("modify", file => { if (file instanceof TFile && file.extension === "md" && !this.ignoreEdit(file.path)) this.noteContent(file); }));
    this.registerEvent(this.app.vault.on("rename", (file, old) => { if (CONTENT.log[old]) { CONTENT.log[file.path] = CONTENT.log[old]; delete CONTENT.log[old]; this.saveContentSoon(); } }));
    this.registerView(VIEW_TYPE, leaf => new VaultGraphView(leaf, this));
    this.registerView(LOCAL_TYPE, leaf => new VaultGraphLocalView(leaf, this));
    this.registerView(HOME_TYPE, leaf => new VaultGraphHomeView(leaf, this));
    Object.keys(FIXED_HOME).forEach(v => this.registerView(fixedType(v), leaf => new VaultGraphHomeView(leaf, this, v)));
    if (!this.settings.homeV2) { this.settings.homeV2 = 1; this.settings.homeView = "foodweb"; this.saveSettings(); }   // once: the card had been left on Subway, which is crowded small
    // after each plugin update, test every view and lens once in the background (desktop); a notice only if something broke
    this.app.workspace.onLayoutReady(() => { if (Platform.isDesktopApp) setTimeout(async () => { const sig = await this.buildSig(); if (sig && (this.settings.lastSelfTest || {}).sig !== sig) this.selfTest(true); }, 45000); });
    this.addCommand({ id: "self-test", name: "Run self-test (every view and lens, in the background; writes a report to the reports folder)", callback: () => this.selfTest(false) });
    this.addCommand({ id: "state-snapshots", name: "Add map snapshots to the latest State of the vault note", callback: () => this.stateSnapshots() });
    this.registerView(SUGGEST_TYPE, leaf => new VaultGraphSuggestView(leaf, this));
    this.registerView(HQ_TYPE, leaf => new VaultHQView(leaf, this));
    this.addCommand({ id: "open-hq", name: "Open Vault HQ", callback: () => this.openHQ() });
    this.addRibbonIcon("layout-dashboard", "Open Vault HQ", () => this.openHQ());
    // a note HQ reads changed (a task ticked in the journal, a draft's status set by hand): HQ and the sidebar redraw.
    // The live signature can't see these (no file or link count changes).
    this.registerEvent(this.app.metadataCache.on("changed", file => {
      if (!VGRules.hqKind(file.path, (this.app.metadataCache.getFileCache(file) || {}).frontmatter, today())) return;
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
      graph.use = Object.fromEntries((data.nodes || []).map(nd => [nd.id, (nd.inlinks || 0) + (nd.opens90 || 0)])); }
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
  pythonCmd() { return this.settings.python || (process.platform === "win32" ? "python" : "python3"); }   // the setting, else the platform's

  wrapWriteActions() {
    this.undoLog = []; this.undoSeq = 0;
    // every vault write counts, so an action that wrote nothing (a preview, a check) neither waits for the index nor redraws
    WRITE_PRIMITIVES.forEach(k => { const g = this[k].bind(this); this[k] = (...a) => { this.writes = (this.writes || 0) + 1; return g(...a); }; });
    WRITE_ACTIONS.forEach(k => {
      const f = this[k].bind(this); this[k] = async (...a) => { const settled = this.indexSettled(), before = this.writes || 0;
        const own = k !== "undo" && !this.undoCur ? (this.undoCur = { ops: [] }) : null;
        try { return await f(...a); }
        finally { if (own) { this.undoCur = null; await this.closeUndo(own); } if ((this.writes || 0) !== before) { await settled; await this.publish(); } } }; });
  }

  // ---- the vault writes (WRITE_PRIMITIVES): each records its change in the open undo entry, then writes
  fileAt(p) { const f = this.app.vault.getAbstractFileByPath(normalizePath(p)); return f instanceof TFile ? f : null; }
  async noteBefore(file) {
    const e = this.undoCur;
    if (e && !e.ops.some(o => o.kind === "text" && o.path === file.path)) e.ops.push({ kind: "text", path: file.path, before: await this.app.vault.read(file) });
  }
  async ioProcess(file, fn) { await this.noteBefore(file); return this.app.vault.process(file, fn); }
  async ioModify(file, text) { await this.noteBefore(file); return this.app.vault.modify(file, text); }
  async ioFrontMatter(file, fn) { await this.noteBefore(file); return this.app.fileManager.processFrontMatter(file, fn); }
  async ioCreate(path, md) { const f = await this.app.vault.create(path, md); if (this.undoCur) this.undoCur.ops.push({ kind: "create", path: f.path }); return f; }
  async ioCreateBinary(path, buf) { const f = await this.app.vault.createBinary(path, buf); if (this.undoCur) this.undoCur.ops.push({ kind: "create", path: f.path, binary: true }); return f; }
  async ioRename(file, dest) { const from = file.path; await this.app.fileManager.renameFile(file, dest); if (this.undoCur) this.undoCur.ops.push({ kind: "rename", from, to: dest }); }
  async ioFolder(path) { await this.app.vault.createFolder(path); }   // a folder an action made stays after an undo (empty is harmless)
  async ioTrash(file) { await this.app.fileManager.trashFile(file); }   // the user's trash setting: never deleted outright
  async ioData(path, text) { await this.app.vault.adapter.write(path, text); }   // the plugin's data files the analysis reads (dismissals); not undoable

  // An entry closes when its action finishes: note what each file looks like now, so an undo can tell if it changed since
  async closeUndo(e) {
    if (!e.ops.length) return;
    const renamedTo = (i, p) => e.ops.slice(i + 1).reduce((q, o) => (o.kind === "rename" && o.from === q ? o.to : q), p);
    for (const [i, o] of e.ops.entries()) {
      if (o.kind === "rename") continue;
      const f = this.fileAt(renamedTo(i, o.path));
      o.after = f && !o.binary ? await this.app.vault.read(f) : null;
    }
    e.id = ++this.undoSeq;
    this.undoLog = [...this.undoLog, e].slice(-UNDO_KEEP);
  }
  lastUndo() { const e = this.undoLog[this.undoLog.length - 1]; return e ? e.id : 0; }
  // Put back what one action changed, its last change first. Nothing is undone if any of its files changed since.
  async undo(id) {
    const e = this.undoLog.find(x => x.id === id);
    if (!e) throw new Error("it's no longer in the undo list");
    const renamedTo = (i, p) => e.ops.slice(i + 1).reduce((q, o) => (o.kind === "rename" && o.from === q ? o.to : q), p);
    for (const [i, o] of e.ops.entries()) {
      const p = o.kind === "rename" ? renamedTo(i, o.to) : renamedTo(i, o.path), f = this.fileAt(p);
      if (!f) throw new Error(`${p} isn't there any more`);
      if (o.kind !== "rename" && !o.binary && await this.app.vault.read(f) !== o.after) throw new Error(`${f.basename} changed since`);
    }
    for (const o of [...e.ops].reverse()) {
      if (o.kind === "text") await this.ioModify(this.fileAt(o.path), o.before);
      else if (o.kind === "create") await this.ioTrash(this.fileAt(o.path));
      else if (o.kind === "rename") await this.ioRename(this.fileAt(o.to), o.from);
    }
    this.undoLog = this.undoLog.filter(x => x !== e);
  }
  // After a write: resolve on Obsidian's next "resolved" (its index has caught up), or after 1.5 s if the write
  // changed nothing it indexes (a JSON file, "Already in…"). Registered before the write so the event can't be missed.
  indexSettled(ms = 1500) {
    return new Promise(done => { const mc = this.app.metadataCache;
      const finish = () => { mc.offref(ref); clearTimeout(t); done(); }, ref = mc.on("resolved", finish), t = setTimeout(finish, ms); });
  }
  // Re-merge now and redraw every surface from the result: graph views, local pane, home cards, note embeds, sidebar
  async publish() {
    this.cacheStale = true;
    const data = await this.graphData();
    this.lastLiveSig = this.liveSignature();
    await Promise.all(STATE_VIEWS()
      .flatMap(t => this.app.workspace.getLeavesOfType(t)).map(l => l.view.refreshLive && l.view.refreshLive(true)));
    (this.embeds || new Set()).forEach(e => e.refresh(data));
    this.app.workspace.getLeavesOfType(SUGGEST_TYPE).forEach(l => l.view.renderSoon && l.view.renderSoon());
    return data;
  }

  // The one live state every surface draws from (graphs, local pane, home cards, embeds, sidebar, self-test).
  // `base` is the analysis file, read once and again only when it's rewritten; the live merge over it runs once per
  // vault change (cacheStale), not once per surface. Surfaces must not mutate it: graphs mount a structuredClone,
  // because they keep layout positions on their nodes. reloadSoon() tells every surface to redraw from it.
  async graphData() {
    if (this.cache && !this.cacheStale) return this.cache;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.cacheStale = false;
      await linksReady(this.app);
      if (!this.base) {
        try { this.base = JSON.parse(await this.app.vault.adapter.read(normalizePath(this.settings.dataPath))); }
        catch (e) {   // no analysis file: the engine builds the data from Obsidian's index (and the analysis runs too, where there is one)
          this.base = null;
          if (await this.hasAnalysis()) { if (!this.refreshing) this.refresh(true); }
          try { this.base = await this.engineData(); } catch (err) { console.error("Vault Graph: the engine didn't run", err); }
        }
      }
      if (!this.base) return (this.cache = null);
      const data = structuredClone(this.base);
      try { liveMerge(this.app, data, this.dataMtime()); } catch (e) { console.error("Vault Graph: live merge failed", e); }
      data.scenes = await this.sceneBlocks();
      try { data.hq = await this.hqData(); } catch (e) { console.error("Vault Graph: HQ notes not read", e); data.hq = null; }
      this.version = (this.version || 0) + 1;
      if (data.live && data.live.indexNotReady) this.mergeWhenIndexed();
      this.writeLiveDiag(data);
      return (this.cache = data);
    })();
    try { return await this.loading; } finally { this.loading = null; }
  }

  /* Options, one per line (all optional):
       note: [[Other note]]   centre on another note (default: this note)
       depth: 2               links away from the centre (1-4)
       map: true              this note is a MOC: show every topic it maps
       view: 2d | 3d | neural
       height: 420            pixels */
  async embed(src, el, ctx) {
    const o = {};
    src.split("\n").forEach(line => { const m = line.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/); if (m) o[m[1].toLowerCase()] = m[2]; });
    const data = await this.graphData();
    if (!data) { el.createEl("p", { text: "Vault Graph: no graph data yet (run the analysis on desktop)." }); return; }
    const host = el.createDiv({ cls: "vg-host vg-embed" });
    host.style.height = Math.max(200, Math.min(1200, parseInt(o.height, 10) || 380)) + "px";
    const root = host.createDiv();
    const child = new MarkdownRenderChild(host);
    ctx.addChild(child);
    const handle = mountVaultGraph(root, structuredClone(data), {   // own copy of the shared state: positions are per view
      compact: true, embed: true, mobile: Platform.isMobile, layoutSeed: () => this.layoutSeed(),
      initialView: (o.view || "").toLowerCase() || undefined,
      ...this.viewActions(null),
      openNote: (notePath, newPane) => {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (file instanceof TFile) this.app.workspace.getLeaf(newPane ? "tab" : false).openFile(file);
      },
      onHoverNote: (notePath, event) => this.app.workspace.trigger("hover-link", {
        event, source: VIEW_TYPE, hoverParent: child, targetEl: host, linktext: notePath,
      }),
    });
    const entry = { refresh: d => { if (!handle.applyLive(structuredClone(d))) { child.unload(); el.empty(); this.embed(src, el, ctx); } } };
    (this.embeds = this.embeds || new Set()).add(entry);
    child.onunload = () => { this.embeds.delete(entry); handle.destroy(); };
    const self = ctx.sourcePath, mocs = data.mocs || [];
    const moc = mocs.find(m => m.id === self);
    if (o.view) handle.setView(o.view.toLowerCase());
    if ((o.map === "true" || (!o.note && moc)) && moc && moc.clusters.length) { handle.showClusters(moc.clusters); return; }
    let target = self;
    if (o.note) {
      const f = this.app.metadataCache.getFirstLinkpathDest(o.note.replace(/^\[\[|\]\]$/g, "").split("|")[0], self);
      if (f) target = f.path;
    }
    if (!handle.setLocal(target, Math.max(1, Math.min(4, parseInt(o.depth, 10) || 1))))
      el.createEl("div", { cls: "vg-embed-note", text: "This note isn't in the graph yet (it has no links to other topic notes, or the data is older than the note)." });
  }

  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  reloadSoon() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.publish(), 500);
  }

  // What the open graphs show changes when files come and go, links change, a note is touched for the first
  // time today (stale -> fresh), or the data file is rewritten. Typing in a note changes none of these.
  liveSignature() {
    const resolved = this.app.metadataCache.resolvedLinks || {};
    let links = 0;
    for (const src in resolved) links += Object.keys(resolved[src]).length;
    const files = this.app.vault.getMarkdownFiles(), dayStart = new Date().setHours(0, 0, 0, 0);
    const touched = files.filter(f => f.stat.mtime >= dayStart).length;
    return `${files.length}|${links}|${touched}|${this.dataStamp || 0}`;
  }
  liveSoon() {
    clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      const sig = this.liveSignature();
      if (sig === this.lastLiveSig) return;
      this.lastLiveSig = sig;
      this.reloadSoon();
    }, 1000);   // links patch the open graphs in place now, so this can follow your edits closely
  }

  async refresh(quiet = false) {
    if (this.refreshing) { this.queued = true; return; }
    if (!(await this.hasAnalysis())) {   // no Python analysis in this vault: the engine finds the topics again
      this.base = null; this.cache = null; this.reloadSoon();
      return;
    }
    this.refreshing = true;
    this.updateStatus();
    const { execFile } = require("child_process");
    const python = this.pythonCmd();
    if (!quiet) new Notice("Vault Graph: analysing the vault…");
    execFile(python, [this.settings.script], { cwd: this.app.vault.adapter.getBasePath(), timeout: 300000 },
      (err, stdout, stderr) => {
        this.refreshing = false;
        if (this.queued) { this.queued = false; this.scheduleAutoRefresh(); }   // edits made while it ran
        if (err) { new Notice(`Vault Graph refresh failed: ${(stderr || err.message).slice(0, 300)}`, 10000); this.updateStatus(); return; }
        const kept = (stdout || "").match(/^Kept \S+ from (\S+):/m);   // vault_graph.newer_analysis: another PC's is newer
        if (!quiet) new Notice(kept ? `Vault Graph: kept the analysis from ${kept[1]}, built from newer notes` : "Vault Graph refreshed");
        this.base = null; this.cache = null;
        this.mergeContentFromDisk().then(() => this.reloadSoon());   // the run rewrote the content log too
        setTimeout(() => this.updateStatus(), 1000);
      });
  }

  // Edits that don't count toward "the data is behind": the analysis's own output and reports, plugin files, trash.
  // An edit while the analysis runs still counts: it queues another run (refresh), and its fingerprint is recorded.
  ignoreEdit(path) {
    return [VGRules.folders.scripts + "/", VGRules.folders.reports + "/", ".obsidian/", ".trash/"].some(p => path.startsWith(p));
  }
  async editsSinceData() {
    let since = 0;
    try { since = (await this.app.vault.adapter.stat(normalizePath(this.settings.dataPath))).mtime; } catch (e) { return 0; }
    return this.app.vault.getMarkdownFiles().filter(f => f.stat.mtime > since && !this.ignoreEdit(f.path)).length;
  }
  async updateStatus() {
    if (!this.statusEl) return 0;
    this.statusEl.setText(this.refreshing ? "Graph: updating…" : "");
    return this.editsSinceData();
  }
  // Re-run the analysis after a pause in editing whenever anything changed since it last ran
  scheduleAutoRefresh(delaySeconds) {
    if (!Platform.isDesktopApp) return;
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(async () => {
      if (this.refreshing) { this.scheduleAutoRefresh(); return; }
      if (await this.editsSinceData()) this.refresh(true);
    }, (delaySeconds ?? ANALYSE_AFTER_IDLE) * 1000);
  }

  // Obsidian re-indexes an edited note in the background. Wait for that before redrawing, or the redraw still
  // sees the old links and keeps suggesting the link that was just made. Register before the write.
  waitIndexed(file, ms = 2000) {
    return new Promise(resolve => {
      const cache = this.app.metadataCache;
      const done = () => { cache.offref(ref); clearTimeout(timer); this.cacheStale = true; resolve(); };
      const ref = cache.on("resolve", f => { if (f && f.path === file.path) done(); });
      const timer = setTimeout(done, ms);
    });
  }

  // "Named in daily notes but never linked": turn the first plain mention of the note in each daily note that names
  // it into a link. dryRun lists those daily notes without writing. Frontmatter, code, existing links and URLs are left alone.
  // Only the dailies the analysis counted (said_unlinked's third field): the day a mention is new, not every later
  // standup whose task table carries the same row, nor the rollups that copy it.
  async linkMentions(notePath, dryRun) {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(notePath)); if (!(f instanceof TFile)) throw new Error("missing note");
    // every way the analysis counts a mention (title, "<Topic> - Context" topic, aliases): shared rule
    const names = VGRules.mentionNames(f.basename, ((this.app.metadataCache.getFileCache(f) || {}).frontmatter || {}).aliases);
    if (!names.length) return [];   // a generic title with no aliases: prose never names it
    const pat = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), re = new RegExp(`(^|[^\\w\\[|/#])(${pat})(?![\\w\\]])`, "i");
    const resolved = this.app.metadataCache.resolvedLinks || {}, out = [];
    const counted = (((this.base || {}).said_unlinked || []).find(([id]) => id === f.path) || [])[2];
    const asked = Array.isArray(counted) ? new Set(counted) : null;
    const plainAt = line => { const m = re.exec(line); if (!m) return null; const at = m.index + m[1].length, before = line.slice(0, at);
      if ((before.match(/\[\[/g) || []).length > (before.match(/\]\]/g) || []).length || (before.match(/`/g) || []).length % 2 || /https?:\/\/\S*$/.test(before)) return null;
      return { at, text: m[2] }; };
    const linkFirst = (text, from) => { const lt = this.app.metadataCache.fileToLinktext(f, from || "", true), nl = text.includes("\r\n") ? "\r\n" : "\n", lines = text.split(/\r?\n/); let fm = lines[0] === "---", code = false;
      for (let i = 0; i < lines.length; i++) { const l = lines[i];
        if (fm) { if (i > 0 && l === "---") fm = false; continue; }
        if (/^\s*```/.test(l)) { code = !code; continue; } if (code) continue;
        const hit = plainAt(l); if (!hit) continue;
        lines[i] = l.slice(0, hit.at) + (hit.text === lt ? `[[${lt}]]` : `[[${lt}|${hit.text}]]`) + l.slice(hit.at + hit.text.length);
        return lines.join(nl); }
      return null; };
    for (const d of this.app.vault.getMarkdownFiles()) {
      if (!d.path.startsWith(VGRules.folders.daily + "/") || (resolved[d.path] || {})[f.path]) continue;   // already links it
      if (asked && !asked.has(d.path)) continue;
      const text = await this.app.vault.cachedRead(d); if (!re.test(text) || linkFirst(text, d.path) == null) continue;
      if (!dryRun) await this.ioProcess(d, t => linkFirst(t, d.path) ?? t);
      out.push(d.path);
    }
    return out;
  }
  async linkNotes(fromPath, toPath, why) {
    const from = this.app.vault.getAbstractFileByPath(fromPath), to = this.app.vault.getAbstractFileByPath(toPath);
    if (!(from instanceof TFile) || !(to instanceof TFile)) { new Notice("Note not found (renamed since the last refresh?)"); throw new Error("missing note"); }
    const resolved = this.app.metadataCache.resolvedLinks;
    if ((resolved[from.path] || {})[to.path] || (resolved[to.path] || {})[from.path]) {
      new Notice(`${from.basename} and ${to.basename} are already linked`);
      return;
    }
    const line = `- ${this.linkText(to.path, from.path)} — ${why}`;
    const indexed = this.waitIndexed(from);
    let wrote = false;
    await this.ioProcess(from, text => { const out = addRelatedLine(text, line); wrote = out !== text; return out; });
    if (!wrote) {   // the line is already there but its link points somewhere else (often a same-name copy): say so
      new Notice(`${from.basename} already has that line, but its link resolves to a different note. Check for a duplicate named "${to.basename}".`, 8000);
      return;
    }
    await indexed;
    new Notice(`Linked ${from.basename} → ${to.basename}`);
  }

  async openSuggestions() {
    let leaf = this.app.workspace.getLeavesOfType(SUGGEST_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: SUGGEST_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }

  // An action taken outside the graph (sidebar): hand it to an open graph view, or queue it in the shared
  // game file; the graph awards XP/quests from the queue next time it opens (one rulebook: the renderer's).
  async recordAction(text) {
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).find(v => v && v.handle);
    if (view) { view.handle.record(text); return; }
    await this.updateShared(sh => { sh.pending = [...(sh.pending || []), text]; return sh; });
    this.app.workspace.getLeavesOfType(SUGGEST_TYPE).forEach(l => l.view.renderSoon && l.view.renderSoon());
  }

  async openLocal() {
    let leaf = this.app.workspace.getLeavesOfType(LOCAL_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: LOCAL_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }

  async saveSettings() { await this.saveData(this.settings); }

  // Notes written from the graph (hub, bridge, map, wanted). mode "create": never overwrite -- pick a
  // free name instead. mode "regen": keep the note's text above the generated marker, replace below it.
  async writeNote(notePath, md, o) {
    o = o || {};
    let path = normalizePath(notePath);
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.ioFolder(folder);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile && o.mode === "regen") {
      const cut = md.indexOf(MARKER);
      await this.ioProcess(file, text => {
        const at = text.indexOf(MARKER);
        if (at < 0 || cut < 0) return text.replace(/\s*$/, "") + "\n\n" + (cut < 0 ? md : md.slice(cut));
        return text.slice(0, at) + md.slice(cut);
      });
    } else {
      // create: wikilinks resolve by name, so a second "Name 2" note would split links. If a note with this
      // name exists anywhere, regenerate it when Vault Graph wrote it (marker), otherwise just open it.
      const name = path.split("/").pop().replace(/\.md$/, "");
      const existing = file instanceof TFile ? file : this.app.metadataCache.getFirstLinkpathDest(name, "");
      if (existing instanceof TFile) {
        const text = await this.app.vault.read(existing), cut = md.indexOf(MARKER), at = text.indexOf(MARKER);
        if (at >= 0 && cut >= 0) await this.ioModify(existing, text.slice(0, at) + md.slice(cut));
        else new Notice(`${existing.basename} already exists — opened it instead of making a copy`);
        if (o.open) await this.app.workspace.getLeaf("tab").openFile(existing);
        return existing.path;
      }
      file = await this.ioCreate(path, md);
    }
    if (o.open) await this.app.workspace.getLeaf("tab").openFile(file);
    return path;
  }

  // Append lines under a heading (adds to it if it's already there, e.g. a second add the same day). Line endings kept.
  async appendSection(notePath, heading, lines) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) { new Notice(`Not found: ${notePath}`); throw new Error("missing note"); }
    // Never add a link the note already has: by resolved path, or by a same-name copy (wikilinks resolve by name)
    const cache = this.app.metadataCache, have = cache.resolvedLinks[file.path] || {};
    const stem = VGRules.stem;
    const haveNames = new Set(Object.keys(have).map(stem));
    const linked = line => {
      const m = line.match(/\[\[([^\]|#]+)/);
      if (!m) return false;
      const target = m[1].replace(/\\$/, "").trim(), dest = cache.getFirstLinkpathDest(target, file.path);
      return Boolean(dest && have[dest.path]) || haveNames.has(stem(dest ? dest.path : target));
    };
    lines = lines.filter(line => !linked(line));
    if (!lines.length) { new Notice(`Already in ${file.basename}`); return false; }
    let wrote = false;
    await this.ioProcess(file, text => {
      const nl = text.includes("\r\n") ? "\r\n" : "\n";
      const present = new Set(text.split(/\r?\n/).map(l => l.trim()));
      lines = lines.filter(l => !present.has(l.trim()));   // the link cache can lag a quick second click
      if (!lines.length) return text;
      wrote = true;
      const at = text.indexOf(heading);
      if (at >= 0) {
        let end = text.indexOf(nl + "#", at + heading.length);
        if (end < 0) end = text.length;
        return text.slice(0, end).replace(/\s*$/, "") + nl + lines.join(nl) + nl + text.slice(end);
      }
      return text.replace(/\s*$/, "") + nl + nl + heading + nl + nl + lines.join(nl) + nl;
    });
    if (!wrote) new Notice(`Already in ${file.basename}`);
    else await this.waitIndexed(file, 1500);
    return wrote;
  }

  // Move a note into a folder. Obsidian's renameFile rewrites links to it, so nothing breaks; nothing is deleted.
  async moveNote(notePath, folder) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) { new Notice(`Not found: ${notePath}`); throw new Error("missing note"); }
    const dir = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.ioFolder(dir);
    const dest = normalizePath(`${dir}/${file.name}`);
    if (this.app.vault.getAbstractFileByPath(dest)) { new Notice(`${dest} already exists — not moved`); throw new Error("exists"); }
    await this.ioRename(file, dest);
    new Notice(`Moved to ${dir}/`);
    return dest;
  }

  // Unchecked tasks in a note: [{line, text}]
  async readTasks(notePath) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) return [];
    const lines = (await this.app.vault.cachedRead(file)).split(/\r?\n/);
    return lines.map((l, i) => { const m = l.match(/^\s*[-*+] \[ \] (.+)$/); return m ? { line: i, text: m[1] } : null; }).filter(Boolean);
  }

  // Serialize template rendering as well as creation: Templater keeps a current-functions object, and rapid
  // clicks (or two HQ panes) must reuse the same exact path, never writeNote's free-name/overwrite modes.
  async openDaily(date = today(), kind = "journal") {
    const path = normalizePath(VGRules.dailyNotePath(date, kind));
    const run = async () => {
      const existing = () => this.fileAt(path) || this.fileAt(VGRules.canonicalDailyPath(this.app.vault.getMarkdownFiles(), date, kind) || "");
      let file = existing();
      if (!file) {
        const prepared = await this.dailyTemplate(date, kind), engine = prepared.engine;
        const folder = path.slice(0, path.lastIndexOf("/"));
        if (!this.app.vault.getAbstractFileByPath(folder)) {
          try { await this.ioFolder(folder); }
          catch (error) { if (!this.app.vault.getAbstractFileByPath(folder)) throw error; }
        }
        file = existing();
        if (!file) {
          if (engine) engine.start_templater_task(path);
          try {
            let created = false;
            try { file = await this.ioCreate(path, engine ? "" : this.dailyPlaceholders(prepared.text, date)); created = true; }
            catch (error) { file = existing(); if (!file) throw error; }
            if (created && engine) {
              try {
                // Templater reads target_file while generating tp.file.content, so it needs a real file.
                const text = await this.renderDailyTemplate(prepared, file, date);
                if (await this.app.vault.read(file) !== "") throw new Error("Daily note changed during template rendering; its content was kept.");
                await this.ioModify(file, text);
              } catch (error) {
                // Only discard our untouched placeholder, never a competing writer's content.
                if (this.fileAt(path) === file && await this.app.vault.read(file) === "") await this.ioTrash(file);
                throw error;
              }
            }
          } finally { if (engine) await engine.end_templater_task(path); }
        }
      }
      await this.app.workspace.getLeaf("tab").openFile(file);
      return file.path;
    };
    const pending = (this.dailyQueue || Promise.resolve()).catch(() => {}).then(run);
    this.dailyQueue = pending;
    return pending;
  }

  async dailyTemplate(date, kind) {
    const pn = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["periodic-notes"];
    const dn = this.app.internalPlugins && this.app.internalPlugins.plugins && this.app.internalPlugins.plugins["daily-notes"];
    const daily = pn && pn.settings && pn.settings.daily;
    const configured = kind === "journal" && ((daily && daily.enabled && daily.template) ||
      (dn && dn.enabled && dn.instance && dn.instance.options && dn.instance.options.template));
    const templatePath = configured || `${VGRules.folders.templates}/${kind === "standup" ? "Daily Standup Template" : "Daily Notes Template"}`;
    const template = this.fileAt(templatePath.replace(/\.md$/i, "") + ".md");
    if (!template) {
      if (configured) throw new Error(`Template not found: ${templatePath}`);
      const text = kind === "standup"
        ? `---\ntype: standup\ndate: ${date}\ntags:\n  - daily/standup\n---\n\n## Daily Work Summary\n\n**Date:** ${date}\n\n## 1. Work Completed Today\n\n1. \n\n## 2. Blocks\n\n1. \n\n## 3. Work Expected To Be Done Tomorrow\n\n1. \n`
        : `---\nDate: ${date}\ntags:\n  - daily/journal\n---\n\n# ${date}\n\n**Standup:** [[Daily Standup ${date}]]\n\n## Today's Tasks\n\n- [ ] \n`;
      return { text };
    }
    const text = await this.app.vault.read(template);
    let engine = null;
    if (text.includes("<%")) {
      engine = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins["templater-obsidian"] &&
        this.app.plugins.plugins["templater-obsidian"].templater;
      if (!engine || !["parse_template", "start_templater_task", "end_templater_task"].every(k => typeof engine[k] === "function"))
        throw new Error("Enable a compatible Templater to create this daily note from its template.");
    }
    return { text, template, engine };
  }

  async renderDailyTemplate(prepared, file, date) {
    // The date override belongs to this render's tp object, not Templater's global clock or settings.
    const prefix = `<%* { const hqNow = tp.date.now; tp.date.now = (format, offset, reference, referenceFormat) => hqNow(format, offset, reference === undefined ? "${date}" : reference, reference === undefined ? "YYYY-MM-DD" : referenceFormat); tp.file.cursor = () => ""; } -%>\n`;
    const text = await prepared.engine.parse_template({ template_file: prepared.template, target_file: file, active_file: file, run_mode: 0 }, prefix + prepared.text);
    if (typeof text !== "string" || text.includes("<%")) throw new Error(`Template did not finish: ${prepared.template.path}`);
    return this.dailyPlaceholders(text, date);
  }

  dailyPlaceholders(text, date) {
    return text.replace(/\{\{(date|time)(?::([^}]+))?\}\}/gi, (_, type, format) =>
      moment(`${date}T${moment().format("HH:mm:ss")}`).format(format || (type.toLowerCase() === "date" ? "YYYY-MM-DD" : "HH:mm")));
  }

  // The one set of actions every graph surface gets (main view, local pane, home cards, embeds). Each goes through a
  // plugin method in WRITE_ACTIONS, which writes and then announces the change, so every open surface redraws.
  // Each write publishes the new state to every surface, the one that made it included.
  viewActions(owner) {
    return {
      openNote: (notePath, newPane) => {
        const target = String(notePath || "");
        const file = this.app.vault.getAbstractFileByPath(target) ||
          (this.app.metadataCache.getFirstLinkpathDest && this.app.metadataCache.getFirstLinkpathDest(target.replace(/\.md$/i, ""), ""));
        if (file instanceof TFile) this.app.workspace.getLeaf(newPane ? "tab" : false).openFile(file);
        else new Notice(`Not found (renamed since the last refresh?): ${notePath}`);
      },
      openDaily: date => this.openDaily(date),
      openStandup: date => this.openDaily(date, "standup"),
      linkNotes: (fromPath, toPath, why) => this.linkNotes(fromPath, toPath, why),
      linkMentions: (notePath, dryRun) => this.linkMentions(notePath, dryRun),
      writeNote: (notePath, md, o) => this.writeNote(notePath, md, o),
      appendSection: (notePath, heading, lines) => this.appendSection(notePath, heading, lines),
      moveNote: (notePath, folder) => this.moveNote(notePath, folder),
      readTasks: notePath => this.readTasks(notePath),
      toggleTask: (notePath, line, text) => this.setTaskStatus(notePath, line, text, "x"),
      setTaskStatus: (notePath, line, text, status) => this.setTaskStatus(notePath, line, text, status),
      setNoteTasks: (notePath, status) => this.setNoteTasks(notePath, status),
      setTaskField: (notePath, line, text, key, value) => this.setTaskField(notePath, line, text, key, value),
      completeTask: (notePath, line, text) => this.completeTask(notePath, line, text),
      logWork: text => this.logWork(text),
      setTasksStatus: (rows, status) => this.setTasksStatus(rows, status),
      setNoteStatus: (notePath, status, reason) => this.setNoteStatus(notePath, status, reason),
      setProjectStatus: (notePath, status, closeTasks) => this.setProjectStatus(notePath, status, closeTasks),
      hqMark: (key, mark) => this.hqMark(key, mark),
      stampReviewed: notePath => this.stampReviewed(notePath),
      dismissPair: async (a, b, kind) => { await this.dismiss(a, b, kind); new Notice("Won't suggest that pair again"); },
      linkText: (id, fromPath) => this.linkText(id, fromPath),
      addToMap: (mocId, ids) => this.addToMap(mocId, ids),
      createMap: clusterId => this.createMap(clusterId),
      renameMap: (mapPath, clusterId) => this.renameMap(mapPath, clusterId),
      addReference: (notePath, holderPath) => this.addReference(notePath, holderPath),
      lastUndo: () => this.lastUndo(), undo: id => this.undo(id),   // VGActions offers Undo on the message an action shows
      outlinksOf: notePath => Object.keys((this.app.metadataCache.resolvedLinks || {})[notePath] || {}),   // stars on hubs the graph leaves out
      recall: query => this.recall(query),   // search inside notes (the palette's "In your notes")
    };
  }

  // Add a map/hub/reference holder to the note's `references:` property (quoted wikilinks, per Link Conventions)
  async addReference(notePath, holder) {   // holder: its path (or the file)
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) throw new Error("missing note");
    const link = this.linkText(typeof holder === "string" ? holder : holder.path, notePath);
    const indexed = this.waitIndexed(file);
    await this.ioFrontMatter(file, fm => {
      const refs = [].concat(fm.references || []);
      if (!refs.includes(link)) refs.push(link);
      fm.references = refs;
    });
    await indexed;
  }
  // The link index wasn't complete at merge time: merge again on Obsidian's next "resolved" (or in 10 s), once
  mergeWhenIndexed() {
    if (this.indexWait) return;
    const mc = this.app.metadataCache, again = () => { mc.offref(ref); clearTimeout(t); this.indexWait = null; this.cacheStale = true; this.reloadSoon(); };
    const ref = mc.on("resolved", again), t = setTimeout(again, 10000);
    this.indexWait = ref;
  }
  // What the last live merge saw, for diagnosing "nothing updates" from outside Obsidian: <cache folder>/live-state.json (local only)
  writeLiveDiag(data) {
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const notes = data.nodes.filter(n => !n.person && !n.moc && !n.ghost);
    const diag = { at: new Date().toISOString(), version: this.version, indexSources: Object.keys(resolved).length,
      notes: notes.length, linked: notes.filter(n => !n.isolated).length, links: data.links.filter(l => l.kind === "link").length, live: data.live || null };
    clearTimeout(this.diagTimer);
    this.diagTimer = setTimeout(async () => {
      const dir = normalizePath(VGRules.folders.cache), io = this.app.vault.adapter;   // not synced: missing on a new PC
      try { if (!(await io.exists(dir))) await io.mkdir(dir); await io.write(`${dir}/live-state.json`, JSON.stringify(diag, null, 1) + "\n"); } catch (e) { /* diagnostics only */ }
    }, 2000);
  }

  // List notes in a map, under a dated "Also in this topic" heading: the one add-to-map, for the graph and the sidebar
  addToMap(mocId, ids) {
    return this.appendSection(mocId, `## Also in this topic (added ${today()})`, ids.map(i => `- ${this.linkText(i, mocId)}`));
  }
  // Give a topic its map: "<Topic> Hub" in 00-Inbox listing the topic's notes, best connected first. Its name and
  // tag make it a map candidate (VGRules.isMapCandidate), so it's the topic's map at once and after the analysis.
  // A topic's map (Create map): "<name> Hub" listing the topic's notes best connected first, below the marker so the
  // list can be made again
  mapNote(data, c, path, name) {
    const members = data.nodes.filter(x => x.cluster === c.id && !x.person && !x.moc && !x.ghost).sort((x, y) => (y.bc || 0) - (x.bc || 0));
    return `---\ncreated: ${today()}\ntags:\n  - meta/hub\n---\n# ${name} Hub\n\nTopic cluster C${c.id} as of ${today()} (${members.length} notes).\n\n` +
      `${MARKER} — edit above this line; everything below is regenerated %%\n\n## All notes\n${members.map(x => `- ${this.linkText(x.id, path)}`).join("\n")}\n`;
  }
  async createMap(clusterId) {
    const data = await this.graphData(), c = data && data.clusters.find(k => k.id === clusterId);
    if (!c) throw new Error("that topic is gone");
    const name = c.label || c.name, path = `${VGRules.folders.inbox}/${VGRules.safeName(name)} Hub.md`;
    return this.writeNote(path, this.mapNote(data, c, path, name), { mode: "create", open: true });
  }
  // A map Create map made, renamed to its topic's name now (the Today list offers it when they differ): the file is
  // renamed through Obsidian, so links to it follow; its heading takes the new name and its list is made again
  async renameMap(mapPath, clusterId) {
    const data = await this.graphData(), c = data && data.clusters.find(k => k.id === clusterId);
    const file = this.app.vault.getAbstractFileByPath(normalizePath(mapPath));
    if (!c) throw new Error("that topic is gone");
    if (!(file instanceof TFile)) throw new Error("the map isn't there");
    const dir = file.parent && file.parent.path && file.parent.path !== "/" ? file.parent.path + "/" : "";
    const dest = normalizePath(`${dir}${VGRules.safeName(c.name)} Hub.md`), old = file.basename.replace(/ Hub$/, "");
    if (dest !== file.path && this.app.vault.getAbstractFileByPath(dest)) throw new Error(`${dest} already exists`);
    if (dest !== file.path) await this.ioRename(file, dest);
    const renamed = this.app.vault.getAbstractFileByPath(dest);
    await this.ioProcess(renamed, text => text.split("\n").map(l => (l.replace(/\r$/, "") === `# ${old} Hub` ? `# ${c.name} Hub${l.endsWith("\r") ? "\r" : ""}` : l)).join("\n"));
    await this.writeNote(dest, this.mapNote(data, c, dest, c.name), { mode: "regen" });
    return dest;
  }

  // The one way to write a link to a note: Obsidian's own link text, so a same-name copy elsewhere (a root
  // dashboard, a duplicate in another folder) never takes the link -- that left suggestions that never cleared
  linkText(id, fromPath) {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(id));
    if (!(f instanceof TFile)) return `[[${String(id).split("/").pop().replace(/\.md$/i, "")}]]`;
    return `[[${this.app.metadataCache.fileToLinktext(f, typeof fromPath === "string" ? fromPath : "", true)}]]`;
  }

  // Tasks, from any view or the sidebar. status: "x" complete, "-" cancelled (the vault's convention: left out of
  // Carried Over), " " reopen. Only if the line is still the one we showed (the note may have changed since).
  async setTaskStatus(notePath, line, text, status = "x") {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) throw new Error("missing note");
    let done = false;
    await this.ioProcess(file, data => {
      const nl = data.includes("\r\n") ? "\r\n" : "\n", lines = data.split(/\r?\n/), m = lines[line] !== undefined && lines[line].match(TASK_LINE);
      if (m && m[4] === text) { lines[line] = VGRules.taskLine(lines[line], status, today(), VGRules.stampsDone(file.path)); done = true; }
      return lines.join(nl);
    });
    if (!done) { new Notice("That task changed since — open the note to update it"); throw new Error("stale"); }
  }
  // Done in HQ: the task checked off in its journal, and the same words added to today's standup under its "work
  // completed" heading (VGRules.addWorkLine), as one action with one Undo. Resolves whether the standup got the line
  // (there's no standup for today yet, or it has no such heading: only the task is checked off).
  async completeTask(notePath, line, text) {
    await this.setTaskStatus(notePath, line, text, "x");
    return this.logWork(text);
  }
  async logWork(text) {
    const day = today(), file = this.app.vault.getMarkdownFiles().find(f => VGRules.hqKind(f.path, null, day) === "standup" && f.path.includes(day));
    if (!file) return false;
    let wrote = false;
    await this.ioProcess(file, t => { const out = VGRules.addWorkLine(t, text); wrote = out != null && out !== t; return out == null ? t : out; });
    return wrote;
  }
  // Several tasks at once (the carried-over sweep's Done all / Cancel all), as one action with one Undo. A task that
  // changed since is left as it is. Resolves how many were changed.
  async setTasksStatus(rows, status) {
    let n = 0;
    for (const r of rows) { try { await this.setTaskStatus(r.path, r.line, r.text, status); n++; } catch (e) { if (e.message !== "stale") throw e; } }
    return n;
  }
  // An inline field on one task ([delegate:: claude]: Delegate in HQ), only if the line is still the one we showed
  async setTaskField(notePath, line, text, key, value) {
    const file = this.fileAt(notePath);
    if (!file) throw new Error("missing note");
    let done = false;
    await this.ioProcess(file, data => {
      const nl = data.includes("\r\n") ? "\r\n" : "\n", lines = data.split(/\r?\n/), m = lines[line] !== undefined && lines[line].match(TASK_LINE);
      if (m && m[4] === text) { lines[line] = VGRules.taskField(lines[line], key, value); done = true; }
      return lines.join(nl);
    });
    if (!done) { new Notice("That task changed since — open the note to update it"); throw new Error("stale"); }
  }
  // A note's status in its frontmatter (Accept or Reject a draft in HQ); a reason goes at the end as "**Why <status>:** ..."
  async setNoteStatus(notePath, status, reason) {
    const file = this.fileAt(notePath);
    if (!file) throw new Error("missing note");
    await this.ioFrontMatter(file, fm => { fm.status = status; });
    if (reason) await this.ioProcess(file, text => { const nl = text.includes("\r\n") ? "\r\n" : "\n"; return text.replace(/\s*$/, "") + nl + nl + `**Why ${status}:** ${reason}` + nl; });
  }
  // A project's status from HQ: its status, its updated date and its status tag (VGRules.withStatusTag), in one write.
  // closeTasks: a closing status also ticks (or cancels) every open task in it (VGRules.closeMark). Returns how many.
  async setProjectStatus(notePath, status, closeTasks = false) {
    const file = this.fileAt(notePath);
    if (!file) throw new Error("missing note");
    const mark = closeTasks && VGRules.closeMark(status), n = mark ? await this.markOpenTasks(file, mark) : 0;
    await this.ioFrontMatter(file, fm => { fm.status = status; fm.updated = today(); fm.tags = VGRules.withStatusTag(fm, status); });
    return n;
  }
  // every open task in a note (VGRules.openTaskLines) gets the mark, done ones stamped with the day; how many changed
  async markOpenTasks(file, mark) {
    let n = 0;
    await this.ioProcess(file, data => {
      const nl = data.includes("\r\n") ? "\r\n" : "\n", lines = data.split(/\r?\n/);
      VGRules.openTaskLines(data).forEach(t => { lines[t.line] = VGRules.taskLine(lines[t.line], mark, today(), VGRules.stampsDone(file.path)); n++; });
      return lines.join(nl);
    });
    return n;
  }
  toggleTask(notePath, line, text) { return this.setTaskStatus(notePath, line, text, "x"); }

  // Close a whole note: every open task in it gets the status, and the note's status tag follows (complete ->
  // status/done, cancelled -> status/cancelled), so the shared rules count it as a record and it stops showing as stale.
  async setNoteTasks(notePath, status = "x") {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
    if (!(file instanceof TFile)) throw new Error("missing note");
    const n = await this.markOpenTasks(file, status), tag = NOTE_STATUS[status];
    if (tag && n) await this.ioFrontMatter(file, fm => {   // only a note whose tasks did change is marked done or cancelled
      const tags = [].concat(fm.tags || []).map(t => String(t).replace(/^#/, "")).filter(t => !t.startsWith("status/"));
      fm.tags = [...tags, tag];
    });
    return n;
  }

  // Mark a note reviewed: `reviewed: <today>` in its frontmatter (which also updates its edit date).
  // Self-test: opens every view and lens in the main graph, watching for errors and timing each, and writes a
  // short report. A view that breaks shows up here instead of as a blank pane found by hand weeks later.
  // ---- the analysis engine on this vault's live index (ROADMAP phase 4): topics from Obsidian's own links and
  // frontmatter and the Smart Connections index, with no Python. Topic ids carry on from the last analysis's topics.
  async engineTopics(prev) {
    const ignored = [].concat((this.app.vault.getConfig && this.app.vault.getConfig("userIgnoreFilters")) || []).map(p => String(p).replace(/\/?$/, "/"));
    const files = this.app.vault.getMarkdownFiles().filter(f => ![...EXCLUDE_PREFIXES, ...ignored].some(p => f.path.startsWith(p)));
    const notes = files.map(f => ({ path: f.path, tags: VGEngine.frontmatterTags((this.app.metadataCache.getFileCache(f) || {}).frontmatter) }));
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const links = Object.fromEntries(files.map(f => [f.path, Object.keys(resolved[f.path] || {}).filter(t => t.endsWith(".md") && t !== f.path)]));
    const F = VGRules.folders;
    const T = VGEngine.topicGraph(notes, links, { kind: VGRules.noteKind, isHub: VGRules.isHub, joinsWhenLinked: VGRules.joinsWhenLinked });
    const vectors = await this.smartVectors(T.knowledge);
    const coh = VGEngine.cohesionGraph(T.graph, T.knowledge, vectors), topics = VGEngine.topicsOf(VGEngine.absorbSmall(VGEngine.louvain(coh), coh));
    const raw = {};   // every topic note's text: topic keywords and word counts
    for (const r of T.knowledge) { const f = this.app.vault.getAbstractFileByPath(r); if (f instanceof TFile) raw[r] = await this.app.vault.cachedRead(f); }
    const tags = Object.fromEntries(notes.map(n => [n.path, n.tags]));
    const ids = VGEngine.stableIds(topics, prev || {}), kw = VGEngine.topicWords(topics, raw), labels = topics.map(m => VGEngine.label(m, T.graph, tags)), st = VGEngine.stacks(topics, tags, VGRules.RULES.stack);
    const names = VGEngine.readableNames(topics, kw, labels.map(l => l.core)).map((n, i) => VGEngine.withStack(n, st[i]));
    return { topics: topics.map((m, i) => ({ id: ids[i], size: m.length, name: names[i], stack: st[i], keywords: kw[i], ...labels[i], members: m })),
      bc: VGEngine.betweenness(T.graph), knowledge: T.knowledge.length, vectors: vectors.size, notes: T.knowledge, graph: T.graph, raw, tags, files };
  }
  // The graph data when this vault has no analysis file (no Python, a phone, a new vault): the engine's topics and
  // influence over Obsidian's index, in the analysis's shape; liveMerge adds the live fields over it as it does over the
  // analysis's. Topic ids carry on from the last engine run (kept in the plugin's settings).
  async engineData() {
    const E = await this.engineTopics(this.settings.engineTopics);
    this.settings.engineTopics = Object.fromEntries(E.topics.map(t => [t.id, t.members])); await this.saveSettings();
    const at = new Map(), unresolved = this.app.metadataCache.unresolvedLinks || {};
    E.topics.forEach(t => t.members.forEach(r => at.set(r, t.id)));
    const words = r => ((E.raw[r] || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").match(/[A-Za-z0-9]+/g) || []).length;
    const day = t => VGRules.localDay(new Date(t));
    const nodes = E.notes.map(r => { const f = this.app.vault.getAbstractFileByPath(r), st = f instanceof TFile ? f.stat : { ctime: Date.now(), mtime: Date.now() };
      return { id: r, name: f instanceof TFile ? f.basename : r.split("/").pop().replace(/\.md$/i, ""), cluster: at.has(r) ? at.get(r) : -1, bc: Math.round((E.bc[r] || 0) * 1e5) / 1e5,
        folder: r.includes("/") ? r.slice(0, r.lastIndexOf("/")) : "", mentions: 0, recent: 0, opens: 0, opens90: 0, inlinks: 0, outlinks: 0,
        broken: Object.keys(unresolved[r] || {}).length, tasks: 0, words: words(r), age: 0, refs: false, isolated: !E.graph[r], tags: E.tags[r] || [],
        born: day(st.ctime), edited: day(st.mtime) }; });
    const links = [];
    for (const [r, nb] of Object.entries(E.graph)) for (const [t, w] of Object.entries(nb)) if (VGEngine.pyCmp(r, t) < 0) links.push({ source: r, target: t, w, kind: "link" });
    const wanted = VGEngine.wantedNotes(unresolved, E.notes);
    wanted.forEach(w => w.refs.slice(0, 12).forEach(r => links.push({ source: r, target: w.id, w: 1, kind: "wanted" })));
    return { vault: this.app.vault.getName(), date: VGRules.today(), since: null, recent_days: 30, has_usage: false, dailies_used: 0, engine: true,
      said_unlinked: [], wanted, series: [], nodes, links, mocs: [],
      clusters: E.topics.map(t => ({ id: t.id, name: t.name, keywords: t.keywords, stack: t.stack, label: null, size: t.size, folder: t.folder, core: t.core.slice(0, 3).map(VGRules.stem) })),
      gaps: [], quality: { stub_words: VGRules.RULES.stub_words, stale_days: VGRules.RULES.stale_days }, pairs: [], snapshots: [],
      timeline: { weeks: [], clusters: {}, notes: {} }, near_dupes: [] };
  }
  // the vault has the analysis to run (its script and Python): otherwise the engine is the analysis
  async hasAnalysis() {
    if (!Platform.isDesktopApp) return false;
    try { return !!(await this.app.vault.adapter.exists(normalizePath(this.settings.script))); } catch (e) { return false; }
  }
  // the Smart Connections index (.smart-env), read for the engine: its logs, then each vector file they name
  async smartVectors(notes) {
    const A = this.app.vault.adapter, base = ".smart-env", text = async p => { try { return await A.read(p); } catch (e) { return null; } };
    const sources = await text(`${base}/smart_sources/smart_sources.ajson`), models = await text(`${base}/embedding_models/embedding_models.ajson`);
    if (sources == null || models == null) return new Map();
    const blobs = {}, files = new Set();
    for (const v of VGEngine.parseAjson(sources).values()) Object.keys(((v && v.embedding) || {}).default || {}).forEach(f => files.add(f));
    for (const f of files) if (!/[\/\\]/.test(f)) { try { blobs[f] = new Uint8Array(await A.readBinary(`${base}/smart_sources/${f}`)); } catch (e) { blobs[f] = null; } }
    return VGEngine.embeddings({ sources, models, blob: f => blobs[f] }, notes);
  }

  async selfTest(auto) {
    // Runs in a hidden, off-screen graph so it never takes over the one you're using. After each plugin update it runs
    // once by itself (desktop) and stays quiet unless something broke; the command always writes a report.
    const data = await this.graphData();
    if (!data) { if (!auto) new Notice("Vault Graph: no graph data to test"); return; }
    if (!auto) new Notice("Vault Graph self-test running in the background… (about a minute)");
    const host = document.body.createDiv({ cls: "vg-host" });
    host.style.cssText = "position:fixed;left:-12000px;top:0;width:1100px;height:720px;pointer-events:none;";
    const errors = [], oe = console.error, onErr = e => errors.push(String(e.message || e.reason || e));
    console.error = (...a) => { errors.push(a.map(String).join(" ").slice(0, 200)); oe(...a); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
    const rows = [], lensRows = [];
    let handle = null;
    try {
      handle = mountVaultGraph(host.createDiv(), structuredClone(data), { mobile: Platform.isMobile, alwaysOn: true, layoutSeed: () => this.layoutSeed() });
      await sleep(1500);
      const D = handle._debug, q = s => host.querySelector(s);
      for (const w of D.views()) {
        const e0 = errors.length, t0 = performance.now(); D.setView(w); const sw = performance.now() - t0; await sleep(1500);
        const today = q(".vg-today");
        rows.push(`| ${w} | ${errors.length - e0 ? "❌ " + (errors.length - e0) + " error(s)" : "✅"} | ${Math.round(sw)} ms | ${D.drawMs().toFixed(1)} ms | ${D.P.size} | ${today && !today.hidden ? q(".vg-today-text").textContent.replace(/\|/g, "/") : ""} |`);
      }
      const keys = D.lenses();
      for (const k of keys) {
        const e0 = errors.length; D.openLens(k); await sleep(400);
        const body = q(".vg-lens-body"); lensRows.push(`| ${k} | ${errors.length - e0 ? "❌" : "✅"} | ${body.textContent.length} chars | ${(body.querySelector(".vg-empty") || {}).textContent || ""} |`);
      }
    } catch (e) { errors.push("self-test stopped: " + e.message); }
    finally {
      console.error = oe; window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr);
      if (handle) handle.destroy(); host.remove();
    }
    this.settings.lastSelfTest = { sig: await this.buildSig(), date: today(), errors: errors.length }; await this.saveSettings();
    if (auto && !errors.length) return;   // quiet when all is well
    const now0 = new Date(), stamp = `${today()} ${String(now0.getHours()).padStart(2, "0")}${String(now0.getMinutes()).padStart(2, "0")}`;
    // the engine's topics on the live index, against the last analysis's
    let engine;
    try { const E = await this.engineTopics(), at = new Map(), D = await this.graphData();
      E.topics.forEach(t => t.members.forEach(r => at.set(r, t.id)));
      const both = ((D && D.nodes) || []).filter(n => !n.ghost && !n.person && n.cluster >= 0 && at.has(n.id)), same = both.filter(n => at.get(n.id) === n.cluster).length;
      engine = `**Engine topics:** ${same} of ${both.length} notes in the same topic as the analysis · ${E.topics.length} topics from ${E.knowledge} notes and ${E.vectors} embeddings.`;
    } catch (e) { engine = `**Engine topics:** didn't run: ${(e && e.message) || e}`; }
    const md = ["---", `created: ${today()}`, "type: report", "tags:", "  - meta/cleanup", "---", "",
      `# Vault Graph self-test ${stamp}`, "", auto ? "_Ran by itself after a plugin update._" : "", "",
      errors.length ? `**${errors.length} error(s)**: ${errors.slice(0, 5).map(e => "`" + e.slice(0, 160).replace(/`/g, "'") + "`").join(" · ")}` : "**No errors.**", "", engine, "",
      "| View | Result | Switch | Frame | Notes drawn | Today strip |", "|---|---|---|---|---|---|", ...rows, "", "| Lens | Result | Size | Empty message |", "|---|---|---|---|", ...lensRows, ""].join("\n");
    await this.writeNote(`${VGRules.folders.reports}/Vault Graph Self-test ${stamp}.md`, md, { mode: "create", open: !auto });
    new Notice(errors.length ? `Vault Graph self-test: ${errors.length} error(s), see ${VGRules.folders.reports}` : "Vault Graph self-test: all clear", errors.length ? 10000 : 4000);
  }
  async buildSig() {   // which build of the plugin this is: main.js size + modified time
    try { const s = await this.app.vault.adapter.stat(normalizePath(`${this.manifest.dir}/main.js`)); return `${s.size}|${s.mtime}`; } catch (e) { return ""; }
  }
  // The weekly State of the vault note (written by `vault_graph.py --state`, run by the gardener) gets pictures:
  // Weather, Radar and Food web as they look now, saved to attachments/ and embedded under "## Maps".
  async stateSnapshots() {
    const notes = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(`${VGRules.folders.reports}/State of the Vault `)).sort((a, b) => b.path.localeCompare(a.path));
    if (!notes.length) { new Notice("No State of the vault note yet: run the analysis with --state (the Friday gardener does)"); return; }
    const leaf = await this.open(), v = leaf.view; await sleep(1200); if (!v.handle) return;
    const was = v.handle._debug.st.view, day = today(), lines = [];
    for (const w of ["weather", "radar", "foodweb"]) {
      v.handle.setView(w); await sleep(3200);
      const name = `attachments/state-${day}-${w}.png`;
      await this.saveBinary(name, await v.handle.snapshot()); lines.push(`![[${name.split("/").pop()}]]`);
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
    let disk = {}; try { disk = JSON.parse(await this.app.vault.adapter.read(normalizePath(CONTENT.path))); } catch (e) { return; }
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
    const file = this.app.vault.getAbstractFileByPath(normalizePath(notePath));
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
  // ---- this vault's rules: the built-in defaults, then what its Obsidian settings say (detectRules), then its rules
  // file where that has a value. The analysis reads the same file; the settings tab edits it (setRule).
  async loadRules() {
    let file = null;
    try { file = JSON.parse(await this.app.vault.adapter.read(normalizePath(this.settings.rulesPath))); } catch (e) { /* no rules file: Obsidian's settings and the defaults */ }
    this.rulesFile = file;
    this.detected = this.detectRules(file);
    VGRules.configure(VGRules.mergeRules(BUILT_RULES, { folders: this.detected }, file || {}));
    ruleConsts();
    this.rules = VGRules;
  }
  // Folders Obsidian's own settings name, for what the rules file doesn't: the daily notes folder (Periodic Notes or
  // the core Daily notes plugin), the folder new notes go in, and the people folder (where notes tagged person live)
  detectRules(file) {
    const set = (file && file.folders) || {}, out = {}, top = p => String(p || "").replace(/^\/+/, "").split("/")[0];
    const pn = this.app.plugins && this.app.plugins.plugins["periodic-notes"], dn = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById("daily-notes");
    const daily = (pn && pn.settings && pn.settings.daily && pn.settings.daily.folder) || (dn && dn.enabled && dn.instance && dn.instance.options && dn.instance.options.folder);
    if (set.daily === undefined && top(daily)) out.daily = top(daily);
    const cfg = k => (this.app.vault.getConfig ? this.app.vault.getConfig(k) : undefined);
    if (set.inbox === undefined && cfg("newFileLocation") === "folder" && cfg("newFileFolderPath")) out.inbox = String(cfg("newFileFolderPath")).replace(/^\/+|\/+$/g, "");
    if (set.people === undefined) {
      const count = {};
      for (const f of this.app.vault.getMarkdownFiles()) { const c = this.app.metadataCache.getFileCache(f), fm = (c && c.frontmatter) || {};
        const tags = [].concat(fm.tags || [], fm.type || []).map(t => String(t).replace(/^#/, "").toLowerCase());
        if (f.path.includes("/") && tags.some(t => /(^|\/)(person|people)$/.test(t))) count[top(f.path)] = (count[top(f.path)] || 0) + 1; }
      const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 2) out.people = best[0];
    }
    return out;
  }
  // One rule changed (from the settings tab): written into the rules file, changing just that value where the file
  // has it so the rest stays as written, then every surface redraws with it
  async setRule(keys, value) {
    const p = normalizePath(this.settings.rulesPath);
    let text = null; try { text = await this.app.vault.adapter.read(p); } catch (e) { /* first rule: a new file */ }
    const obj = text ? JSON.parse(text) : {};
    let o = obj; keys.slice(0, -1).forEach(k => { o = o[k] = o[k] && typeof o[k] === "object" ? o[k] : {}; }); o[keys[keys.length - 1]] = value;
    let out = null;
    if (text) {
      const k = keys[keys.length - 1], from = keys.length > 1 ? Math.max(0, text.indexOf(`"${keys[keys.length - 2]}"`)) : 0;
      const m = new RegExp(`("${k}"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false|null)`).exec(text.slice(from));
      if (m) { const at = from + m.index, cand = text.slice(0, at) + m[1] + JSON.stringify(value) + text.slice(at + m[0].length);
        try { if (JSON.stringify(JSON.parse(cand)) === JSON.stringify(obj)) out = cand; } catch (e) { /* not in place: written out whole */ } }
    }
    await this.app.vault.adapter.write(p, out || JSON.stringify(obj, null, 2) + "\n");
    await this.rulesChanged();
  }
  // the rules file changed (here, or edited / synced): load it, and remount every surface on the new rules
  async rulesChanged() {
    await this.loadRules();
    this.base = null; this.cache = null;
    STATE_VIEWS().flatMap(t => this.app.workspace.getLeavesOfType(t)).forEach(l => l.view.render && l.view.render());
    this.app.workspace.getLeavesOfType(SUGGEST_TYPE).forEach(l => l.view.renderSoon && l.view.renderSoon());
  }
  dataMtime() { const f = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.dataPath)); return f instanceof TFile ? f.stat.mtime : 0; }
  // The shared game file with every device's ledger folded in (VGRules.applyLedgers): the one read path
  async loadShared() {
    let sh = null;
    try { sh = JSON.parse(await this.app.vault.adapter.read(normalizePath(this.settings.sharedPath))); } catch (e) { /* no file yet */ }
    const ledgers = await this.loadLedgers();
    return ledgers.length ? VGRules.applyLedgers(sh, ledgers) : sh;
  }
  // The one write path for the shared file outside a graph view (sidebar actions): change a copy of it and save
  // through the same three-way merge as saveShared, re-read just before writing so another device's save isn't lost
  async updateShared(change) {
    const base = await this.loadShared(), mine = change(VGRules.sharedSnapshot(base) || { v: 1 });
    if (mine) await this.writeShared(VGRules.mergeShared(base, mine, await this.loadShared()));
  }
  async writeShared(sh) {
    await this.app.vault.adapter.write(normalizePath(this.settings.sharedPath), JSON.stringify(sh, null, 1));
    await this.recordLedger(sh);
  }
  // This device's id: in its own local storage, never in a synced file (the plugin's settings sync to every device)
  deviceId() {
    const key = "vg-device-id", store = this.app.loadLocalStorage ? this.app : null;
    let id = store ? store.loadLocalStorage(key) : window.localStorage.getItem(key);
    if (!id) {
      id = `${Platform.isMobile ? "mobile" : "desktop"}-${Math.random().toString(36).slice(2, 10)}`;
      if (store) store.saveLocalStorage(key, id); else window.localStorage.setItem(key, id);
    }
    return id;
  }
  async loadLedgers() {
    const io = this.app.vault.adapter, dir = normalizePath(VGRules.files.device_ledgers);
    try {
      if (!(await io.exists(dir))) return [];
      const files = (await io.list(dir)).files.filter(f => f.endsWith(".json"));
      return (await Promise.all(files.map(async f => { try { return JSON.parse(await io.read(f)); } catch (e) { return null; } }))).filter(Boolean);
    } catch (e) { return []; }
  }
  // Add this device's marks (from a shared state it saved, and pairs it dismissed) to its own ledger
  async recordLedger(shared, dismissed) {
    const io = this.app.vault.adapter, dir = normalizePath(VGRules.files.device_ledgers), path = `${dir}/${this.deviceId()}.json`;
    let mine = null;
    try { mine = JSON.parse(await io.read(path)); } catch (e) { /* this device's first mark */ }
    const next = VGRules.ledgerAdd(mine, shared, dismissed, today());
    if (mine && JSON.stringify(next) === JSON.stringify(mine)) return;
    try { if (!(await io.exists(dir))) await io.mkdir(dir); await io.write(path, JSON.stringify(next, null, 1) + "\n"); }
    catch (e) { console.error("Vault Graph: device ledger not saved", e); }
  }
  // Dismissed pairs from the dismissals file and every device's ledger (a dismissal Sync dropped from the file still counts)
  async loadDismissed() {
    let pairs = [];
    try { pairs = JSON.parse(await this.app.vault.adapter.read(normalizePath(this.settings.dismissedPath))).pairs || []; } catch (e) { /* no dismissals yet */ }
    [...pairs, ...VGRules.ledgerDismissed(await this.loadLedgers())].forEach(p => p && p.a && p.b && DISMISSED.add(dismissKey(p.a, p.b)));
  }
  // The shared file, dismissals or a device ledger changed (here or by Sync): dismissals apply at once, the sidebar redraws
  async sharedChanged(file) {
    if (file.path !== normalizePath(this.settings.sharedPath)) { await this.loadDismissed(); this.cacheStale = true; }
    this.app.workspace.getLeavesOfType(SUGGEST_TYPE).forEach(l => l.view.renderSoon && l.view.renderSoon());
    this.app.workspace.getLeavesOfType(HQ_TYPE).forEach(l => l.view.render && l.view.render());   // Later / Done marks
  }
  refreshHQViews() {
    [HQ_TYPE, SUGGEST_TYPE].flatMap(type => this.app.workspace.getLeavesOfType(type)).forEach(leaf => {
      const view = leaf && leaf.view, refresh = view && (typeof view.renderSoon === "function" ? view.renderSoon : view.render);
      if (typeof refresh === "function") refresh.call(view);
    });
  }
  // HQ's marks on an item, in the shared file: "later" (gone for today), "done" (a plan item, which has no checkbox),
  // or null to take one back (Undo). Marks from earlier days are dropped: Later lasts the day, and a plan item's
  // standup is older than the carry-over window by then.
  async hqMark(key, mark) {
    const day = today(), keep = (VGRules.HQ.carry_days || 30) * 864e5;
    await this.updateShared(sh => {
      sh.review = sh.review || {};
      const m = sh.review.hq = { ...(sh.review.hq || {}) };
      if (mark) m[key] = `${mark}:${day}`; else delete m[key];
      Object.keys(m).forEach(k => { const [how, d] = String(m[k]).split(":");
        if ((how === "later" && d !== day) || Date.parse(day) - Date.parse(d) > keep) delete m[k]; });
      return sh;
    });
    STATE_VIEWS().concat(SUGGEST_TYPE).flatMap(t => this.app.workspace.getLeavesOfType(t)).forEach(l => (l.view.renderSoon || l.view.render || (() => {})).call(l.view));
  }
  // data.hq: the notes HQ reads (VGRules.hqKind: journals and standups in the carry-over window, scopes of work, the
  // backlog, reports, drafts, decisions, the run log) and each device's run records, through VGRules.hqGather. A note
  // is read again only when it changed; which notes count comes from Obsidian's frontmatter, so nothing else is read.
  async hqData() {
    const H = VGRules.HQ;
    if (!H || !H.journal) return null;
    const day = today(), cache = this.hqTexts = this.hqTexts || new Map(), files = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (EXCLUDE_PREFIXES.some(x => f.path.startsWith(x)) || !VGRules.hqKind(f.path, fm, day)) { cache.delete(f.path); continue; }
      let c = cache.get(f.path);
      if (!c || c.mtime !== f.stat.mtime) cache.set(f.path, c = { mtime: f.stat.mtime, text: await this.app.vault.cachedRead(f) });
      files.push({ path: f.path, text: c.text, fm: fm || {} });
    }
    const io = this.app.vault.adapter, dir = H.automation_status && normalizePath(H.automation_status);
    try {
      if (dir && await io.exists(dir)) for (const p of (await io.list(dir)).files.filter(x => x.endsWith(".json")))
        try { files.push({ path: p, json: JSON.parse(await io.read(p)) }); } catch (e) { /* a record being written */ }
    } catch (e) { /* no run records on this device */ }
    return VGRules.hqGather(files, { today: day });
  }
  async openHQ() {
    let leaf = this.app.workspace.getLeavesOfType(HQ_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: HQ_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
    return leaf;
  }
  // A quest finished from the sidebar, or found already done ("Already in…"): mark it in the shared game file so
  // the sidebar and the graph agree. An open graph view checks its own quests (and writes this file itself).
  async markQuestDone(key) {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE).some(l => l.view && l.view.handle)) return;
    await this.updateShared(sh => {
      const d = sh.cosmos && sh.cosmos.daily, q = d && d.date === today() && (d.quests || []).find(x => x.key === key);
      if (!q || q.done) return null;
      q.done = true; return sh;
    });
  }
  // A graph view's handle on the shared game file. base is what the view last read or wrote, so a save can tell
  // "removed here" from "added on another device" (VGRules.mergeShared) instead of replacing the other device's changes.
  sharedStore() {
    const store = { base: null,
      load: async () => { const sh = await this.loadShared(); store.base = VGRules.sharedSnapshot(sh); return sh; },
      save: v => this.saveShared(v, store) };
    return store;
  }
  async saveShared(v, store) {
    clearTimeout(this.sharedTimer);
    this.sharedTimer = setTimeout(async () => {
      const mine = VGRules.sharedSnapshot(v), disk = await this.loadShared();
      await this.writeShared(VGRules.mergeShared(store && store.base, mine, disk));
      if (store) store.base = mine;
    }, 1500);
  }

  // The latest MOC Alignment report: its tickable rows, so they can be ticked from the graph.
  async mocReportFile() {
    const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(`${VGRules.folders.reports}/MOC Alignment `)).sort((a, b) => b.stat.mtime - a.stat.mtime);
    return files[0] || null;
  }
  async loadMocReport() {
    const file = await this.mocReportFile(); if (!file) return null;
    const lines = (await this.app.vault.cachedRead(file)).split(/\r?\n/), rows = [];
    let section = "";
    lines.forEach((l, i) => {
      const h = l.match(/^#{2,3} (.+)$/); if (h) section = h[1];
      const m = l.match(/^\s*- \[([ xX\-])\] (.*?)%%act:(\{.*\})%%/);
      if (m) { let act = null; try { act = JSON.parse(m[3]); } catch (e) { /* malformed row */ }
        rows.push({ line: i, state: m[1], label: m[2].trim(), section, act }); }
    });
    return { path: file.path, rows };
  }
  async tickMocRow(line, on) {
    const file = await this.mocReportFile(); if (!file) throw new Error("no report");
    await this.ioProcess(file, data => {
      const nl = data.includes("\r\n") ? "\r\n" : "\n", lines = data.split(/\r?\n/);
      if (lines[line] && /- \[[ xX]\] /.test(lines[line])) lines[line] = lines[line].replace(/- \[[ xX]\] /, on ? "- [x] " : "- [ ] ");
      return lines.join(nl);
    });
  }
  applyMocReport() {
    return this.mocReportFile().then(file => new Promise((resolve, reject) => {
      if (!file) return reject(new Error("no report"));
      const { execFile } = require("child_process");
      const python = this.pythonCmd();
      execFile(python, [this.settings.script.replace("vault_graph.py", "moc_align.py"), "--apply", file.path], { cwd: this.app.vault.adapter.getBasePath(), timeout: 300000 },
        (err, stdout, stderr) => { if (err) { new Notice(`MOC apply failed: ${(stderr || err.message).slice(0, 300)}`, 10000); reject(err); } else { new Notice("MOC alignment applied:\n" + stdout.slice(0, 400), 8000); resolve(stdout); } });
    }));
  }

  async saveBinary(notePath, buf) {
    let path = normalizePath(notePath);
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.ioFolder(folder);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = notePath.replace(/(\.\w+)$/, ` ${i}$1`);
    await this.ioCreateBinary(path, buf);
    new Notice(`Saved ${path}`);
    return path;
  }

  // read by vault_gaps.py: dismissed pairs are never suggested again (graph or weekly report)
  async dismiss(a, b, kind) {
    const path = normalizePath(this.settings.dismissedPath), adapter = this.app.vault.adapter;
    let data = { version: 1, pairs: [] };
    try { data = JSON.parse(await adapter.read(path)); } catch (e) { /* first dismissal creates the file */ }
    data.pairs = data.pairs || [];
    DISMISSED.add(dismissKey(a, b));
    this.cacheStale = true;
    if (data.pairs.some(p => (p.a === a && p.b === b) || (p.a === b && p.b === a))) return;   // already dismissed
    const pair = { a, b, kind, date: today(), via: "graph" };
    data.pairs.push(pair);
    await this.ioData(path, JSON.stringify(data, null, 2) + "\n");
    await this.recordLedger(null, [pair]);   // kept even if Sync later keeps another device's copy of the file
  }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Real "last edited" dates. File dates mean nothing here (bulk link and tag passes and Obsidian Sync touched nearly
// every note), so a note's age is days since its *content* changed: a fingerprint of the body without frontmatter,
// Related / Merged-from sections, "Possible duplicate" / "Overlaps with" lines, generated hub lists or whitespace.
// Same fingerprint as vault_graph.py (content_body + FNV-1a over UTF-16 code units); the log is
// .obsidian/plugins/jk-vault-graph/content-log.json ({path: {h, since}}), kept current here as you edit and checked by every analysis run.
const CONTENT = { log: {}, path: VGRules.files.content_log, dirty: false };   // in the plugin folder: not indexed, so it stays out of recent-files lists
const GEN_MARK = "%% vault-graph:generated", DROP_SECTION = /^#{1,6}\s*(related\b|merged from\b)/i, DROP_LINE = /possible duplicate:|overlaps with/i;
const FM_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
function contentBody(text) {
  const out = []; let skip = false;
  for (const line of text.replace(FM_BLOCK, "").split(GEN_MARK)[0].split(/\r\n|\r|\n/)) {
    if (line.trimStart().startsWith("#")) { skip = DROP_SECTION.test(line.trim()); if (skip) continue; }
    if (skip || DROP_LINE.test(line)) continue;
    out.push(line);
  }
  return out.join(" ").split(/\s+/).filter(Boolean).join(" ");
}
function fingerprint(text) {
  const s = contentBody(text); let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const daysSince = iso => Math.max(0, Math.round((Date.parse(today() + "T12:00") - Date.parse(iso + "T12:00")) / 864e5));
// age = days since the content changed, or since it was last confirmed current ("Still current" stamps `reviewed:`)
function contentAge(app, path, fallback) {
  const e = CONTENT.log[path], f = app.vault.getAbstractFileByPath(path);
  const rv = f && ((app.metadataCache.getFileCache(f) || {}).frontmatter || {}).reviewed;
  const since = [e && e.since, rv && /^\d{4}-\d{2}-\d{2}/.test(String(rv)) ? String(rv).slice(0, 10) : null].filter(Boolean).sort().pop();
  return since ? daysSince(since) : fallback;
}

// Live link sync. Clusters, influence, gaps and evidence come from the weekly analysis (vault_graph.py),
// but links change every day, so the link edges are rebuilt from Obsidian's own index on every open:
// new links show at once, removed links disappear, notes created since the run join the cluster most of
// their neighbours are in, deleted notes drop out, and suggestions you've since linked stop showing.
// this vault's folders (vault_graph_rules.json folders), worked out again whenever the rules change (ruleConsts)
let DAILY_TOP, PEOPLE_TOP, SKIP_TOP, EXCLUDE_PREFIXES;   // EXCLUDE_PREFIXES: never analysed (vault_lib.EXCLUDE_PREFIXES)
function ruleConsts() {
  DAILY_TOP = VGRules.folders.daily; PEOPLE_TOP = VGRules.folders.people;
  SKIP_TOP = new Set([...VGRules.folders.skip, VGRules.folders.scripts, ".trash"]);
  EXCLUDE_PREFIXES = (VGRules.folders.exclude || []).map(p => p.replace(/\/?$/, "/"));
  CONTENT.path = VGRules.files.content_log;
}
ruleConsts();   // the built-in rules until onload's loadRules brings this vault's
// a scene written in a note: ```vault-graph-scene ... ``` (VGRules.sceneSpec reads it)
const SCENE_LANG = "vault-graph-scene", SCENE_BLOCK = /^```vault-graph-scene[^\S\n]*\n([\s\S]*?)^```/gm, SCENE_BLOCK_START = /^```vault-graph-scene/gm;
const DISMISSED = new Set();   // dismissed pairs by note name (dismissKey); kept current by the plugin, applied in liveMerge
// Shared rules (vault_graph_rules.js, built in ahead of this file): records are never "stale"; dismissals match
// by note name like the analysis (vault_gaps._dismissed), so a same-name copy counts as dismissed too
const { dismissKey } = VGRules, staleFor = (n, days) => VGRules.isStale(n, days);   // the current rules' stale
function liveMerge(app, data, since) {
  const vault = app.vault, cache = app.metadataCache, resolved = cache.resolvedLinks || {};
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  const exists = id => vault.getAbstractFileByPath(id) instanceof TFile;
  const knowledge = file => {   // a topic note (VGRules.noteKind, the engine's and the analysis's rule; catch-all hubs aside)
    if (file.extension !== "md" || SKIP_TOP.has(file.path.split("/")[0]) || EXCLUDE_PREFIXES.some(x => file.path.startsWith(x)) || file.path.split("/").includes("node_modules")) return false;
    return VGRules.noteKind(file.path, VGEngine.frontmatterTags((cache.getFileCache(file) || {}).frontmatter)) === "note";
  };
  // Inbox notes a topic note links to join (VGRules.joinsWhenLinked): a note you just created for a wanted link
  const linkedFromTopics = new Set();
  for (const [src, targets] of Object.entries(resolved)) {
    const f = vault.getAbstractFileByPath(src);
    if ((byId.has(src) && !byId.get(src).person && !byId.get(src).moc) || (f instanceof TFile && knowledge(f))) Object.keys(targets).forEach(t => linkedFromTopics.add(t));
  }
  const joins = file => linkedFromTopics.has(file.path) && !VGRules.isHubName(file.path)
    && VGRules.joinsWhenLinked(file.path, ((cache.getFileCache(file) || {}).frontmatter || {}).tags);
  const removed = data.nodes.filter(n => !n.person && !exists(n.id)).map(n => n.id);   // MOCs too
  removed.forEach(id => byId.delete(id));
  const added = [];
  for (const file of vault.getMarkdownFiles()) {
    if (byId.has(file.path) || !(knowledge(file) || joins(file))) continue;
    const n = { id: file.path, name: file.basename, cluster: -1, bc: 0, folder: file.parent ? file.parent.path : "", mentions: 0, recent: 0,
      opens: 0, opens90: 0, inlinks: 0, outlinks: 0, broken: 0, tasks: 0, words: 0, age: 0, refs: false, isolated: true, live: true };
    byId.set(n.id, n); added.push(n);
  }
  const isNote = id => byId.has(id) && !byId.get(id).person && !byId.get(id).moc;
  const key = VGRules.pairKey;
  const old = new Set(data.links.filter(l => l.kind === "link").map(l => key(l.source, l.target)));
  const now = new Map(), inl = new Map(), outl = new Map();
  for (const [src, targets] of Object.entries(resolved)) {
    if (!isNote(src)) continue;
    for (const dst of Object.keys(targets)) {
      if (dst === src || !isNote(dst)) continue;
      outl.set(src, (outl.get(src) || 0) + 1); inl.set(dst, (inl.get(dst) || 0) + 1);
      now.set(key(src, dst), [src, dst]);
    }
  }
  let gained = 0, lost = 0;
  now.forEach((_, k) => { if (!old.has(k)) gained++; });
  old.forEach(k => { if (!now.has(k)) lost++; });
  // Obsidian's link index is empty or still being built (startup, a big sync): it reads as "most links deleted". Keep
  // the analysis links untouched and say so; graphData() merges again once the index is complete. Real edits never
  // remove more than half the vault's links in one go.
  if (old.size >= 20 && lost > old.size * 0.5) {
    data.live = { added: 0, removed: 0, gained: 0, lost: 0, written: 0, mapAdds: 0, indexNotReady: true, indexLinks: now.size, analysisLinks: old.size };
    return;
  }
  // wanted notes: drop the ones written since the run (they're real notes now)
  const written = new Set((data.wanted || []).filter(w => cache.getFirstLinkpathDest && cache.getFirstLinkpathDest(w.name, "")).map(w => w.id));
  data.wanted = (data.wanted || []).filter(w => !written.has(w.id)).map(w => ({ ...w, refs: w.refs.filter(r => byId.has(r)) })).filter(w => w.refs.length);
  const wantedIds = new Set(data.wanted.map(w => w.id));
  const keep = data.links.filter(l => l.kind !== "link" && byId.has(l.source) && (byId.has(l.target) || wantedIds.has(l.target))
    && !(VGRules.isSuggestion(l) && (now.has(key(l.source, l.target)) || DISMISSED.has(dismissKey(l.source, l.target)))));   // acted on or dismissed since the run
  data.links = keep.concat([...now.values()].map(([s, t]) => ({ source: s, target: t, w: 1, kind: "link" })));
  // pairs linked by the same notes (VGEngine.sharedPairs): a suggestion every vault gets from its own links. Not a pair
  // you dismissed, already linked (a same-name copy counts), one title, one dated series, a private note, or already suggested.
  { const nbs = new Map(), put = (a, b) => { if (!nbs.has(a)) nbs.set(a, new Set()); nbs.get(a).add(b); };
    now.forEach(([s, t]) => { put(s, t); put(t, s); });
    const offered = new Set(data.links.filter(l => VGRules.isSuggestion(l)).map(l => key(l.source, l.target)));
    const fm = id => { const f = vault.getAbstractFileByPath(id); return f instanceof TFile ? (cache.getFileCache(f) || {}).frontmatter : undefined; };
    const series = id => VGEngine.seriesKey(id), title = id => VGEngine.cleanTitle(id).toLowerCase();
    // two notes with one title (dates and brackets aside) are copies or one name for two things: not a pair to link
    VGEngine.sharedPairs(nbs, { skip: (a, b) => offered.has(key(a, b)) || DISMISSED.has(dismissKey(a, b)) || VGRules.linkedByName(resolved, a, b) || title(a) === title(b)
        || (!!series(a) && series(a) === series(b)) || VGRules.isPrivate(a, fm(a)) || VGRules.isPrivate(b, fm(b)) })
      .forEach(p => data.links.push({ source: p.a, target: p.b, w: 1, kind: "shared", why: `${p.n} notes link to both` })); }
  const deg = new Map();
  now.forEach(([s, t]) => { (deg.get(s) || deg.set(s, []).get(s)).push(t); (deg.get(t) || deg.set(t, []).get(t)).push(s); });
  for (const n of byId.values()) {
    if (n.person || n.moc) continue;
    n.inlinks = inl.get(n.id) || 0; n.outlinks = outl.get(n.id) || 0; n.isolated = !deg.has(n.id);
    n.age = contentAge(app, n.id, n.age);   // real edits since the analysis count ("stale" goes away when you edit); bulk touches don't
    const f = vault.getAbstractFileByPath(n.id);   // tasks checked off or added since the analysis (the run counts "- [ ]" lines the same way)
    if (f instanceof TFile && (!since || f.stat.mtime > since)) n.tasks = ((cache.getFileCache(f) || {}).listItems || []).filter(li => li.task === " ").length;
  }
  for (const n of added) {   // a new note joins its neighbours' most common cluster
    const votes = {};
    (deg.get(n.id) || []).forEach(m => { const c = byId.get(m).cluster; if (c >= 0) votes[c] = (votes[c] || 0) + 1; });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    if (best) n.cluster = +best[0];
    const f = vault.getAbstractFileByPath(n.id);
    n.age = contentAge(app, n.id, 0);
  }
  // Maps the analysis hasn't seen yet (Create map, or by hand) are maps at once -- the Today list, City's town halls
  // and "no map" all see them. Same rules as the analysis (VGRules.isMapCandidate + claims, from vault_graph_rules.json),
  // so a map never shows here and then vanishes at the next refresh. Its topic is the cluster most of its links point
  // into, and only a topic with no map yet: one map per topic.
  // a map deleted or renamed since the analysis is no map any more (renamed, it's found again below at its new path)
  data.mocs = (data.mocs || []).filter(m => exists(m.id));
  const known = new Set(data.mocs.map(m => m.id)), mapped = new Set(data.mocs.flatMap(m => m.clusters));
  const sizeOf = new Map((data.clusters || []).map(k => [k.id, k.size]));
  for (const file of vault.getMarkdownFiles()) {
    if (known.has(file.path) || !VGRules.isMapCandidate(file.path, (cache.getFileCache(file) || {}).frontmatter)) continue;
    const targets = Object.keys(resolved[file.path] || {}).filter(id => isNote(id));
    const votes = {}; targets.forEach(id => { const c = byId.get(id).cluster; if (c >= 0) votes[c] = (votes[c] || 0) + 1; });
    const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]; if (!best || !VGRules.claims(best[1], sizeOf.get(+best[0]) || 0)) continue;
    const c = +best[0]; if (mapped.has(c)) continue;
    mapped.add(c); const title = file.basename.replace(/ (hub|moc)$/i, ""), mem = new Set(targets);
    const missing = [...byId.values()].filter(n => n.cluster === c && !n.person && !n.moc && !mem.has(n.id)).map(n => n.id);
    data.mocs = [...(data.mocs || []), { id: file.path, title, nav: false, clusters: [c], members: targets, missing: { [c]: missing }, live: true }];
    byId.set(file.path, { id: file.path, name: title, moc: true, cluster: c, bc: 0, folder: file.parent ? file.parent.path : "", mentions: 0, recent: 0, opens: 0, opens90: 0,
      inlinks: 0, outlinks: targets.length, broken: 0, tasks: 0, words: 0, age: 0, refs: true, isolated: false, live: true });
    targets.forEach(t => data.links.push({ source: file.path, target: t, w: 1, kind: "moc" }));
  }
  // the rest of what buttons change, so their warnings clear without waiting for the analysis:
  const dailyLinked = new Set(); for (const src in resolved) if (src.startsWith(DAILY_TOP + "/")) Object.keys(resolved[src]).forEach(t => dailyLinked.add(t));
  data.said_unlinked = (data.said_unlinked || []).filter(([id]) => byId.has(id) && !dailyLinked.has(id));   // "Link mentions" (or linking by hand)
  // "Not duplicates", or linked since: the analysis only offers unlinked pairs, but one built on another device before
  // your link synced there still has it, and linking is how you say the two are separate notes
  // a pair with the same text ("text") stays a duplicate even when one links the other
  data.near_dupes = (data.near_dupes || []).filter(([a, b, , how]) => byId.has(a) && byId.has(b) && !DISMISSED.has(dismissKey(a, b)) && (how === "text" || !VGRules.linkedByName(resolved, a, b)));
  for (const n of byId.values()) { const f = vault.getAbstractFileByPath(n.id);   // "Add reference"
    if (!n.person && f instanceof TFile && (!since || f.stat.mtime > since)) { const fm = (cache.getFileCache(f) || {}).frontmatter || {}, r = fm.references; n.refs = !!(r && [].concat(r).length);
      // tags too ("Complete all", a status edit by hand): the shared rules read status/ and type/ tags, so stale clears at once
      n.tags = [].concat(fm.tags || []).map(t => String(t).replace(/^#/, "").trim()).filter(Boolean); } }
  data.nodes = [...byId.values()];
  // Maps: members = the analysis's members (links + Dataview) plus whatever the map links to now, so a note
  // added to a map since the run stops being suggested for it. Same-name copies count as members too.
  const stem = VGRules.stem;
  let mapAdds = 0;
  for (const m of data.mocs || []) {
    const members = new Set(m.members || []);
    for (const id of Object.keys(resolved[m.id] || {})) if (byId.has(id) && !members.has(id)) { members.add(id); mapAdds++; }
    // names the map links, graph notes or not (a root dashboard): appendSection's "Already in…" counts these too,
    // so VGRules.onMap must, or a note whose name the map already links is suggested forever and never added
    m.linkedNames = [...new Set(Object.keys(resolved[m.id] || {}).map(stem))];
    const names = new Set([...[...members].map(stem), ...m.linkedNames]);
    m.members = [...members];
    for (const c of Object.keys(m.missing || {})) m.missing[c] = m.missing[c].filter(id => byId.has(id) && !members.has(id) && !names.has(stem(id)));
  }
  data.live = { added: added.length, removed: removed.length, gained, lost, written: written.size, mapAdds };
}

// Append a line to the note's last links section ("## Related", "## Related (added <date>)", "## Related notes"),
// or create "## Related (added <date>)" before the context-note footer ("---" + "**Related Standups**") or at the end.
// Other "## Related ..." headings ("Related Project Contexts", "Related Standups", "Related Issues Fixed") are the
// note's own sections, not where its links go. Line endings kept.
const RELATED_HEAD = /^## Related(?: notes)?(?: \(added [^)]*\))?\s*$/i;
function addRelatedLine(text, line) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.some(l => l.trim() === line.trim())) return text;
  let head = -1;
  lines.forEach((l, i) => { if (RELATED_HEAD.test(l)) head = i; });
  if (head >= 0) {
    let end = lines.findIndex((l, i) => i > head && (/^#{1,2} /.test(l) || l === "---"));
    if (end < 0) end = lines.length;
    let at = end;
    while (at > head + 1 && lines[at - 1].trim() === "") at--;
    lines.splice(at, 0, line);
    if (lines[at + 1] !== undefined && lines[at + 1].trim() !== "" && !lines[at + 1].startsWith("- ")) lines.splice(at + 1, 0, "");
    return lines.join(nl);
  }
  const section = [`## Related (added ${today()})`, "", line, ""];
  const footer = lines.findIndex((l, i) => l === "---" && (lines[i + 1] || "").trim() === "" && (lines[i + 2] || "").startsWith("**Related Standups**"));
  if (footer >= 0) { lines.splice(footer, 0, ...section); return lines.join(nl); }
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return [...lines, "", ...section].join(nl);
}

module.exports.addRelatedLine = addRelatedLine;   // for tests

class VaultGraphSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl;
    el.empty();
    // this vault's rules: the value in use and where it comes from; a change is written to the rules file (the
    // analysis reads it too), on Enter or leaving the field
    new Setting(el).setName("This vault").setHeading();
    const where = keys => { const at = (o, ks) => ks.reduce((x, k) => (x && typeof x === "object" ? x[k] : undefined), o);
      if (at(this.plugin.rulesFile, keys) !== undefined) return `from ${this.plugin.settings.rulesPath}`;
      if (keys[0] === "folders" && this.plugin.detected && this.plugin.detected[keys[1]] !== undefined) return "from Obsidian's settings";
      return "default"; };
    RULE_FIELDS.forEach(([keys, name, desc]) => {
      const cur = keys.reduce((x, k) => x[k], VGRules.RULES);
      new Setting(el).setName(name).setDesc(`${desc} · ${where(keys)}`).addText(t => {
        t.setValue(String(cur));
        t.inputEl.addEventListener("change", async () => {
          const raw = t.getValue().trim(), v = typeof cur === "number" ? Number(raw) : raw.replace(/^\/+|\/+$/g, "");
          if (!raw || (typeof cur === "number" && !(v > 0))) { t.setValue(String(cur)); return; }
          if (v === cur) return;
          try { await this.plugin.setRule(keys, v); new Notice(`${name}: ${v}`); } catch (e) { new Notice(`Couldn't save ${name}: ${e.message}`); }
          this.display();
        });
      });
    });
    new Setting(el).setName("Plugin").setHeading();
    const text = (name, desc, key, placeholder) => new Setting(el).setName(name).setDesc(desc)
      .addText(t => t.setPlaceholder(placeholder).setValue(this.plugin.settings[key])
        .onChange(async v => { this.plugin.settings[key] = v.trim() || DEFAULTS[key]; await this.plugin.saveSettings(); }));
    text("Graph data file", "JSON written by vault_graph.py, relative to the vault.", "dataPath", DEFAULTS.dataPath);
    text("Analysis script", `Runs ${ANALYSE_AFTER_IDLE} seconds after your last edit (desktop only).`, "script", DEFAULTS.script);
    text("Python command", "Leave empty for python (Windows) / python3 (Linux, macOS).", "python", "python");
    text("Rules file", "This vault's folder names and thresholds, relative to the vault.", "rulesPath", DEFAULTS.rulesPath);
  }
}
