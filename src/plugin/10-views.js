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
        save: view => { this.plugin.settings.view = this.plugin.followSaved(view); this.plugin.saveSettings(); },   // an open graph still holds old paths after a move
      },
      onHoverNote: (notePath, event) => this.app.workspace.trigger("hover-link", {
        event, source: VIEW_TYPE, hoverParent: this, targetEl: this.contentEl, linktext: notePath,
      }),
      sharedStore: this.plugin.sharedStore(),
      taskHistory: () => this.plugin.taskHistory(),
      writtenLinks: () => this.plugin.writtenLinks(),
      linkHow: rows => this.plugin.linkHow(rows),
      dropLinkLines: rows => this.plugin.dropLinkLines(rows),
      setParents: rows => this.plugin.setParents(rows),
      wantedCounts: () => this.plugin.wantedCounts(),
      driftScan: () => this.plugin.driftScan(),
      ...this.plugin.guideReaders(), guideApply: run => this.plugin.guideApply(run),
      mocReport: { load: () => this.plugin.loadMocReport(), tick: (line, on) => this.plugin.tickMocRow(line, on),
                   apply: () => this.plugin.applyMocReport() },
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
        const file = this.plugin.fileAt(notePath);
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
      && this.plugin.fileAt(id) instanceof TFile;
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
      const f = this.plugin.fileAt(id);
      const n = { id, name: f.basename, cluster: -1, bc: 0, folder: f.parent ? f.parent.path : "", mentions: 0, recent: 0,
        inlinks: 0, outlinks: 0, broken: 0, tasks: 0, words: 0,
        age: Math.max(0, Math.round((Date.now() - f.stat.mtime) / VGShared.DAY_MS)), refs: true, isolated: false, live: true };
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
      api, state, mobile: Platform.isMobile, screen: this.plugin.settings.hqScreen, onNext: () => this.plugin.nextStepSoon(), onSession: s => this.plugin.showFocus(s), notify: msg => new Notice(msg, 0),
      onScreen: s => { this.plugin.settings.hqScreen = s; this.plugin.saveSettings(); },
      ask: (title, text, ok) => confirmModal(this.app, title, text, ok),
      input: (title, text, placeholder) => inputModal(this.app, title, text, placeholder),
      onDone: msg => this.plugin.recordAction(msg),
      openGraph: to => this.plugin.openGraphAt(to),
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
    this.register(VGActions.history.subscribe(() => { if (this.drawHistory) this.drawHistory(); }));
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
    // Undo and Redo: the same pair and the same history as the graph's toolbar and Vault HQ
    const hist = head.createDiv({ cls: "vg-s-history" });
    this.drawHistory = () => {
      hist.innerHTML = VGParts.historyButtons(VGActions.history.state(), name => `<span data-icon="${name === "undo" ? "undo-2" : "redo-2"}"></span>`, "vg-s-btn vg-s-ghost");
      hist.querySelectorAll("[data-icon]").forEach(s => require("obsidian").setIcon(s, s.dataset.icon));
      hist.querySelectorAll("button").forEach(b => { b.onclick = () => VGActions.history[b.hasAttribute("data-hundo") ? "undoLast" : "redoLast"](); });
    };
    this.drawHistory();
    if (n) head.createEl("div", { cls: "vg-s-muted", text: `${clusterName(n.cluster)} · ${n.inlinks} in · ${n.outlinks} out` });
    if (subject) VGActions.render(head.createDiv({ cls: "vg-s-acts vg-s-noteacts" }), VGActions.forNote(subject, ctx), subject, ctx, { btn: "vg-s-btn", primary: "mod-cta", ghost: "vg-s-ghost" });
    // every suggestion for this note, best first; each button is one of the shared actions above
    const items = [];
    if (n) {
      const said = (data.said_unlinked || []).find(([id]) => id === n.id);
      // same rule as appendSection's "Already in…"
      const inMap = moc ? VGRules.onMap(moc, n.id) : null;
      if (said && moc && !inMap) items.push({ icon: "sun", title: `Named in ${said[1]} daily notes but never linked`, sub: `Add it to ${moc.title} so its topic map links it`, btn: "Add to map", run: () => run("map") });
      else if (said) items.push({ icon: "sun", title: `Named in ${said[1]} daily notes but never linked`, sub: "Turn the first plain mention in each into a link", btn: "Link mentions", run: () => run("mentions") });
      if (moc && inMap === false && !(said && moc)) items.push({ icon: "hexagon", title: `Not listed in its topic's map`, sub: moc.title, btn: "Add to map", run: () => run("map") });
      data.links.filter(l => VGRules.isSuggestion(l) && (l.source === n.id || l.target === n.id)).forEach(l => {
        const other = byId.get(l.source === n.id ? l.target : l.source); if (!other) return;
        items.push({ icon: "link", title: `Link ${other.name}`, sub: VGRules.whyWords(l.why), btn: "Link", ghost: "Dismiss", open: other.id,
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
        if (it.open) { const b = acts.createEl("button", { text: "Open" }); b.onclick = () => { const f = this.plugin.fileAt(it.open); if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f); }; }
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
              lab.createSpan({ text: VGShared.plainLinks(tk.text) });
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
    const openNote = id => ["Open", () => { const f = this.plugin.fileAt(id); if (f instanceof TFile) this.app.workspace.getLeaf(false).openFile(f); }];
    // one row per item: its action (VGActions.runToday, as in the graph), Open, Not related for a pair, and hide
    const row = (it, pick) => {
      const done = pick && liveDone(it), noteId = it.id || (it.ids || [])[0], tn = noteId && byId.get(noteId);
      const c = el.createDiv({ cls: "vg-s-card vg-s-questcard" + (done ? " is-done" : "") });
      const x = c.createEl("button", { cls: "vg-s-hide clickable-icon", attr: { "aria-label": done ? "Clear it" : "Not for me — hide it", title: done ? "Clear it" : "Not for me — hide it" } });
      require("obsidian").setIcon(x, "x");
      x.onclick = async () => { this.hidden.add(it.key); c.remove(); await this.plugin.hideGameItem(it.key); this.renderSoon(); };
      const t = c.createDiv({ cls: "vg-s-txt" });
      t.createDiv({ text: `${pick ? (done ? "✓ " : "○ ") : ""}${it.title}`, cls: "vg-s-t" });
      if (it.why && !done) t.createDiv({ text: VGRules.whyWords(it.why), cls: "vg-s-muted" });
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
