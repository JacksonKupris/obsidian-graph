  // ---- this vault's rules: the built-in defaults, then what its Obsidian settings say (detectRules), then its rules
  // file where that has a value. The analysis reads the same file; the settings tab edits it (setRule).
  async loadRules() {
    const file = await this.readJson(this.settings.rulesPath);   // none: Obsidian's settings and the defaults
    this.rulesFile = file;
    this.detected = this.detectRules(file);
    VGRules.configure(VGRules.mergeRules(BUILT_RULES, { folders: this.detected, ...this.detectJournal(file) }, file || {}));
    ruleConsts();
    this.rules = VGRules;
  }
  // Where this person's daily notes go and how they're named, from Obsidian's settings, unless the vault's rules file says for itself.
  // A vault that hasn't said gets no standups until it has one.
  detectJournal(file) {
    if (file && file.hq && file.hq.journal) return {};
    const pn = this.app.plugins && this.app.plugins.plugins["periodic-notes"], dn = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById("daily-notes");
    const on = (pn && pn.settings && pn.settings.daily) || (dn && dn.enabled && dn.instance && dn.instance.options) || {}, format = on.format || "YYYY-MM-DD", folder = String(on.folder || "").replace(/^\/+|\/+$/g, "");
    return { hq: { journal: VGRules.formatPattern(format), journal_format: format, journal_folder: folder, standups: "if_any", plain_journal: true }, ...(folder ? {} : { folders: { ...this.detected, daily: "" } }) };
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
    let obj = {};   // a file that isn't valid JSON (mid-edit) is left as it is; the caller reports why nothing was saved
    if (text) try { obj = JSON.parse(text); } catch (e) { throw new Error(`${p} isn't valid JSON (${e.message}); fix the file first`); }
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
  dataMtime() { const f = this.fileAt(this.settings.dataPath); return f instanceof TFile ? f.stat.mtime : 0; }
  // The shared game file with every device's ledger folded in (VGRules.applyLedgers): the one read path
  async loadShared() {
    let sh = await this.readJson(this.settings.sharedPath);
    return VGRules.followLedgers(sh, await this.loadLedgers(), this.pathExists);
  }
  // A note moved or was renamed (a folder move is one of these per note). Batched, since a move can be hundreds of notes.
  noteMoved(to, from) {
    this.movesQueued = { ...(this.movesQueued || {}), [from]: to };
    clearTimeout(this.movesTimer);
    this.movesTimer = setTimeout(() => this.flushMoves(), 1000);
  }
  async flushMoves() {
    clearTimeout(this.movesTimer);
    const moves = this.movesQueued; this.movesQueued = null;
    if (moves) try { await this.recordMoves(moves); } catch (e) { console.error("Vault Graph: moved notes not recorded", e); }
  }
  // The one write for moves: on record in this device's ledger, then every saved mark rewritten to the new paths.
  async recordMoves(moves) {
    const io = this.app.vault.adapter, dir = normalizePath(VGRules.files.device_ledgers), path = `${dir}/${this.deviceId()}.json`;
    let mine = await this.readJson(path);   // none: this device's first mark
    if (!(await io.exists(dir))) await io.mkdir(dir);
    await io.write(path, JSON.stringify(VGRules.ledgerMoved(mine, moves, new Date().toISOString(), this.pathExists), null, 1) + "\n");
    const shared = await this.loadShared();
    if (shared) await this.writeShared(shared);
    await this.loadDismissed();
    const file = normalizePath(this.settings.dismissedPath);
    try {
      const before = await io.read(file), after = JSON.stringify(this.followSaved(JSON.parse(before)), null, 2);
      if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(JSON.parse(after))) await io.write(file, after);
    } catch (e) { /* no dismissals yet */ }
    if (this.settings.view) { this.settings.view = this.followSaved(this.settings.view); await this.saveSettings(); }
    this.refreshHQViews();
  }
  get pathExists() { return p => this.pathTaken(p); }
  followSaved(v) { return VGRules.followMoves(v, this.moves || {}, this.pathExists); }
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
      return (await Promise.all(files.map(f => this.readJson(f)))).filter(Boolean);
    } catch (e) { return []; }
  }
  // Add this device's marks (from a shared state it saved, and pairs it dismissed) to its own ledger
  async recordLedger(shared, dismissed) {
    const io = this.app.vault.adapter, dir = normalizePath(VGRules.files.device_ledgers), path = `${dir}/${this.deviceId()}.json`;
    let mine = await this.readJson(path);   // none: this device's first mark
    const next = VGRules.ledgerAdd(mine, shared, dismissed, today());
    if (mine && JSON.stringify(next) === JSON.stringify(mine)) return;
    try { if (!(await io.exists(dir))) await io.mkdir(dir); await io.write(path, JSON.stringify(next, null, 1) + "\n"); }
    catch (e) { console.error("Vault Graph: device ledger not saved", e); }
  }
  // Dismissed pairs from the dismissals file and every device's ledger (a dismissal Sync dropped from the file still counts)
  async loadDismissed() {
    const pairs = ((await this.readJson(this.settings.dismissedPath)) || {}).pairs || [];
    const ledgers = await this.loadLedgers(); this.moves = VGRules.ledgerMoves(ledgers);
    [...pairs, ...VGRules.ledgerDismissed(ledgers)].map(p => this.followSaved(p)).forEach(p => p && p.a && p.b && DISMISSED.add(dismissKey(p.a, p.b)));
  }
  // The shared file, dismissals or a device ledger changed (here or by Sync): dismissals apply at once, the sidebar redraws
  async sharedChanged(file) {
    this.nextStepSoon();
    if (file.path !== normalizePath(this.settings.sharedPath)) { await this.loadDismissed(); this.cacheStale = true; }
    this.app.workspace.getLeavesOfType(SUGGEST_TYPE).forEach(l => l.view.renderSoon && l.view.renderSoon());
    this.app.workspace.getLeavesOfType(HQ_TYPE).forEach(l => l.view.render && l.view.render());   // Later / Done marks
  }
  refreshHQViews() {
    this.nextStepSoon();
    [HQ_TYPE, SUGGEST_TYPE].flatMap(type => this.app.workspace.getLeavesOfType(type)).forEach(leaf => {
      const view = leaf && leaf.view, refresh = view && (typeof view.renderSoon === "function" ? view.renderSoon : view.render);
      if (typeof refresh === "function") refresh.call(view);
    });
  }
