  // HQ's marks on an item, in the shared file: "later" (gone for today), "done" (a plan item, which has no checkbox),
  // or null to take one back (Undo). Marks from earlier days are dropped: Later lasts the day, and a plan item's
  // standup is older than the carry-over window by then.
  // HQ's capture box: a task goes under today's journal's task heading (the journal is made if it isn't there yet); a note
  // goes in the capture folder, named from its first words. to: a project's note, for a task that belongs there instead.
  async capture(text, kind, to) {
    text = String(text || "").trim(); if (!text) return null;
    if (to) { const note = this.fileAt(to); if (!note) throw new Error(`${to} isn't there any more`); await this.ioProcess(note, t => VGRules.addProjectTask(t, text)); return note.path; }
    if (kind === "note") {
      const folder = (VGRules.HQ && VGRules.HQ.capture_folder) || VGRules.folders.inbox, title = text.split(/\r?\n/)[0].replace(/[\\/:*?"<>|#^\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim() || "Capture";
      let path = normalizePath(`${folder}/${title}.md`); for (let i = 2; this.pathTaken(path); i++) path = normalizePath(`${folder}/${title} ${i}.md`);
      if (!this.pathTaken(folder)) await this.ioFolder(folder);
      await this.ioCreate(path, `---\ncreated: ${today()}\n---\n\n${text}\n`);
      return path;
    }
    const day = today(); let file = this.fileAt(VGRules.canonicalDailyPath(this.app.vault.getMarkdownFiles(), day, "journal") || "");
    if (!file) { await this.openDaily(day); file = this.fileAt(VGRules.canonicalDailyPath(this.app.vault.getMarkdownFiles(), day, "journal") || ""); await this.openHQ(); }
    if (!file) throw new Error("today's journal couldn't be made");
    await this.ioProcess(file, t => VGRules.addTaskLine(t, text));
    return file.path;
  }
  // Notes close in meaning, through Smart Connections' index when that plugin is there (nothing, otherwise): it finds what no
  // word in common would, a couple of seconds after keyword search has already answered.
  async searchMeaning(query, n = 5) {
    const env = window.smart_env, sources = env && env.smart_sources; if (!sources || !sources.lookup) return [];
    const out = await sources.lookup({ hypotheticals: [query], filter: { limit: n * 3 } }), seen = new Set(), hits = [];
    for (const r of out || []) { const key = String((r.item && r.item.key) || r.key || ""), path = key.split("#")[0]; if (!path.endsWith(".md") || seen.has(path) || !this.fileAt(path)) continue;
      if (path.startsWith(VGRules.folders.reports + "/") || (VGRules.RULES.recall.rollup_pattern && new RegExp(VGRules.RULES.recall.rollup_pattern).test(path))) continue;
      seen.add(path); hits.push({ path, heading: (key.split("#").pop() || "").replace(/^\{\d+\}$/, ""), score: r.score || 0 }); if (hits.length >= n) break; }
    return hits;
  }
  // Today's focus, in the shared file so every device sees it; yesterday's falls away by itself
  async hqFocus(keys) {
    await this.updateShared(sh => { sh.review = sh.review || {}; sh.review.focus = { day: today(), keys }; return sh; });
    STATE_VIEWS().concat(SUGGEST_TYPE).flatMap(t => this.app.workspace.getLeavesOfType(t)).forEach(l => (l.view.renderSoon || l.view.render || (() => {})).call(l.view));
  }
  // A line in today's standup under what's expected tomorrow
  async planLine(text) {
    const day = today(), file = this.app.vault.getMarkdownFiles().find(f => VGRules.hqKind(f.path, null, day) === "standup" && f.path.includes(day)); if (!file) return false;
    let wrote = false; await this.ioProcess(file, t => { const out = VGRules.addWorkLine(t, text, VGRules.HQ.plan_heading); wrote = out != null && out !== t; return out == null ? t : out; }); return wrote;
  }
  // More / Less like this on an item's kind: how is more, less, undo-more, undo-less, hide or show. Through the shared file, so every device learns it.
  async hqReact(kind, how) {
    await this.updateShared(sh => {
      const r = sh.review = sh.review || {};
      if (how === "hide" || how === "show") { r.hiddenKinds = (r.hiddenKinds || []).filter(k => k !== kind); if (how === "hide") r.hiddenKinds.push(kind); return sh; }
      const all = r.reactions = { ...(r.reactions || {}) }, one = all[kind] = { more: 0, less: 0, ...(all[kind] || {}) }, field = how.replace("undo-", "");
      one[field] = Math.max(0, one[field] + (how.startsWith("undo-") ? -1 : 1));
      return sh;
    });
    STATE_VIEWS().concat(SUGGEST_TYPE).flatMap(t => this.app.workspace.getLeavesOfType(t)).forEach(l => (l.view.renderSoon || l.view.render || (() => {})).call(l.view));
  }
  async hqMark(key, mark) {
    const day = today(), keep = (VGRules.HQ.carry_days || 30) * VGShared.DAY_MS;
    await this.updateShared(sh => {
      sh.review = sh.review || {};
      const m = sh.review.hq = { ...(sh.review.hq || {}) };
      if (mark) m[key] = String(mark).startsWith("until:") ? mark : `${mark}:${day}`; else delete m[key];   // until:<date> carries its own day
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
      const fc = this.app.metadataCache.getFileCache(f) || {}, fm = fc.frontmatter;   // Obsidian's index says which old journals have an open task, so only those are read
      if (EXCLUDE_PREFIXES.some(x => f.path.startsWith(x)) || !VGRules.hqKind(f.path, fm, day, hasOpenTask(fc))) { cache.delete(f.path); continue; }
      let c = cache.get(f.path);
      if (!c || c.mtime !== f.stat.mtime) cache.set(f.path, c = { mtime: f.stat.mtime, text: await this.app.vault.cachedRead(f) });
      files.push({ path: f.path, text: c.text, fm: fm || {} });
    }
    const io = this.app.vault.adapter, dir = H.automation_status && normalizePath(H.automation_status);
    try {
      if (dir && await io.exists(dir)) for (const p of (await io.list(dir)).files.filter(x => x.endsWith(".json")))
        { const json = await this.readJson(p); if (json) files.push({ path: p, json }); }   // none: a record being written
    } catch (e) { /* no run records on this device */ }
    return VGRules.hqGather(files, { today: day });
  }
  // The status bar's next step and where it leads
  nextStepSoon(ms = 1500) { if (!this.nextEl) return; clearTimeout(this.nextTimer); this.nextTimer = setTimeout(() => this.updateNextStep(), ms); }
  async updateNextStep() {
    if (!this.nextEl) return;
    try {
      const data = await this.graphData(), sh = await this.loadShared();
      if (this.focusNow) return;   // the clock has the status bar; a session that started while this was reading
      const n = VGRules.hqNextOf(data || {}, { review: sh && sh.review, hidden: sh && sh.cosmos && sh.cosmos.hidden, today: today() });
      const v = VGRules.nextView(n); this.nextEl.setText(v.text); this.nextEl.setAttr("aria-label", v.aria);
    } catch (e) { console.error("Vault Graph: next step not worked out", e); }
  }
  // A focus session running in HQ: its clock takes the status bar, so it shows while you work in a note, and the graph's chip follows.
  showFocus(s) {
    const changed = !this.focusNow !== !s; this.focusNow = s || null;
    if (changed) this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(l => { if (l.view && l.view.handle && l.view.handle.syncNext) l.view.handle.syncNext(); });
    if (!this.nextEl) return;
    this.nextEl.toggleClass("is-over", !!(s && s.over));
    if (!s) { clearTimeout(this.nextTimer); this.updateNextStep(); return; }
    this.nextEl.setText(`${s.paused ? "Paused" : "Focus"} ${s.clock} · ${s.title}`); this.nextEl.setAttr("aria-label", `Go to: ${s.title}`);
  }
  async goNextStep() { const leaf = await this.openHQ(); if (!leaf.view.handle && leaf.view.render) await leaf.view.render(); if (leaf.view.handle) leaf.view.handle.next(); }
  // one HQ, however many tabs a restart or an update left
  oneHQ() { const open = this.app.workspace.getLeavesOfType(HQ_TYPE); open.slice(1).forEach(l => l.detach()); return open[0] || null; }
  async openHQ() {
    let leaf = this.oneHQ();
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

