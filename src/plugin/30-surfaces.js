  // After a write: resolve on Obsidian's next "resolved" (its index has caught up), or after 1.5 s if the write
  // changed nothing it indexes (a JSON file, "Already in…"). Registered before the write so the event can't be missed.
  indexSettled(ms = 1500) {
    return new Promise(done => { const mc = this.app.metadataCache;
      const finish = () => { mc.offref(ref); clearTimeout(t); done(); }, ref = mc.on("resolved", finish), t = setTimeout(finish, ms); });
  }
  // Re-merge now and redraw every surface from the result: graph views, local pane, note embeds, sidebar
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

  // The one live state every surface draws from (graphs, local pane, embeds, sidebar, self-test).
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
          if (Platform.isDesktopApp && !this.refreshing) this.refresh(true);
          try { this.base = await this.engineData(); } catch (err) { console.error("Vault Graph: the engine didn't run", err); }
        }
      }
      if (!this.base) return (this.cache = null);
      const data = structuredClone(this.base);
      const owns = VGRules.engineOwns(!Platform.isDesktopApp);
      if (!data.engine && owns.length) { if (this.engineNotesDone) VGRules.applyEngineNotes(data, this.engineNotesDone, owns); else this.engineNotesSoon(); }
      try { liveMerge(this.app, data, this.dataMtime()); } catch (e) { console.error("Vault Graph: live merge failed", e); }
      data.scenes = await this.sceneBlocks();
      try { data.hq = await this.hqData(); data.hqError = null; } catch (e) { console.error("Vault Graph: HQ notes not read", e); data.hq = null; data.hqError = (e && e.message) || String(e); }
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
        const file = this.fileAt(notePath);
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

  // The graph, and optionally a view or a lens in it (to: { view, lens }). A new tab has no handle until its data has loaded.
  async openGraphAt(to) {
    const leaf = await this.open(); if (!to) return leaf;
    if (leaf.loadIfDeferred) await leaf.loadIfDeferred();
    for (let i = 0; i < 100 && !(leaf.view && leaf.view.handle); i++) await new Promise(r => setTimeout(r, 100));
    const h = leaf.view && leaf.view.handle; if (!h) return leaf;
    if (to.view) h.setView(to.view); if (to.lens) h.openLens(to.lens);
    return leaf;
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
    if (!Platform.isDesktopApp) { this.base = null; this.cache = null; this.engineNotesDone = null; this.reloadSoon(); return; }   // a phone reads what a desktop wrote
    {
      this.refreshing = true; this.updateStatus();
      if (!quiet) new Notice("Vault Graph: analysing the vault…");
      try { const kept = await this.writeGraphFile(); if (!quiet) new Notice(kept ? `Vault Graph: kept the analysis from ${kept}, built from newer notes` : "Vault Graph refreshed"); }
      catch (e) { console.error("Vault Graph: the analysis didn't run", e); new Notice(`Vault Graph refresh failed: ${e.message}`, 10000); this.refreshing = false; this.updateStatus(); return; }
      this.refreshing = false; if (this.queued) { this.queued = false; this.scheduleAutoRefresh(); }   // edits made while it ran
      this.base = null; this.cache = null; this.reloadSoon(); setTimeout(() => this.updateStatus(), 1000);
      return;
    }
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
      if (!(await this.editsSinceData())) return;
      let wait = 0; try { wait = (await this.app.vault.adapter.stat(normalizePath(this.settings.dataPath))).mtime + ANALYSE_EVERY_MS - Date.now(); } catch (e) { /* no data file yet: run now */ }
      if (wait > 0) this.scheduleAutoRefresh(Math.ceil(wait / 1000)); else this.refresh(true);
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

