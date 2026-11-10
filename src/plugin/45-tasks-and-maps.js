  // Add a map/hub/reference holder to the note's `references:` property (quoted wikilinks, per Link Conventions)
  async addReference(notePath, holder) {   // holder: its path (or the file)
    const file = this.fileAt(notePath);
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
    return `---\ncreated: ${today()}\ntags:\n  - meta/hub\n---\n# ${name} Hub\n\nTopic as of ${today()} (${members.length} notes).\n\n` +
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
    const file = this.fileAt(mapPath);
    if (!c) throw new Error("that topic is gone");
    if (!(file instanceof TFile)) throw new Error("the map isn't there");
    const dir = file.parent && file.parent.path && file.parent.path !== "/" ? file.parent.path + "/" : "";
    const dest = normalizePath(`${dir}${VGRules.safeName(c.name)} Hub.md`), old = file.basename.replace(/ Hub$/, "");
    if (dest !== file.path && this.pathTaken(dest)) throw new Error(`${dest} already exists`);
    if (dest !== file.path) await this.ioRename(file, dest);
    const renamed = this.fileAt(dest);
    await this.ioProcess(renamed, text => text.split("\n").map(l => (l.replace(/\r$/, "") === `# ${old} Hub` ? `# ${c.name} Hub${l.endsWith("\r") ? "\r" : ""}` : l)).join("\n"));
    await this.writeNote(dest, this.mapNote(data, c, dest, c.name), { mode: "regen" });
    return dest;
  }

  // The one way to write a link to a note: Obsidian's own link text, so a same-name copy elsewhere (a root
  // dashboard, a duplicate in another folder) never takes the link -- that left suggestions that never cleared
  linkText(id, fromPath) {
    const f = this.fileAt(id);
    if (!(f instanceof TFile)) return `[[${VGShared.nameOf(id)}]]`;
    return `[[${this.app.metadataCache.fileToLinktext(f, typeof fromPath === "string" ? fromPath : "", true)}]]`;
  }

  // Tasks, from any view or the sidebar. status: "x" complete, "-" cancelled (the vault's convention: left out of
  // Carried Over), " " reopen. Only if the line is still the one we showed (the note may have changed since).
  // A tick made in the editor gets its done date the same way HQ's Done does (VGRules.taskEdit), in the same edit, so one Undo
  // takes back both. A transaction filter, because a checkbox click, the keyboard toggle and a typed x all arrive as editor changes.
  // A click in reading view skips the editor and changes the view's text, so that's compared before and after the click.
  registerDoneDates() {
    this.registerDomEvent(document, "click", e => {
      const box = e.target; if (!box || !box.matches || !box.matches("input.task-list-item-checkbox")) return;
      const leaf = this.app.workspace.getLeavesOfType("markdown").find(l => l.view.containerEl.contains(box)), view = leaf && leaf.view;
      if (!(view instanceof MarkdownView) || view.getMode() !== "preview" || !view.file) return;
      const before = view.data, file = view.file;
      setTimeout(async () => {
        const stamp = VGRules.stampsDone(file.path); if (VGRules.noteTaskEdits(before, view.data, today(), stamp) == null) return;
        await view.save();   // the click's change is on disk first, so the date goes on top of it
        await this.ioProcess(file, text => VGRules.noteTaskEdits(before, text, today(), stamp) ?? text);
      }, 0);
    }, { capture: true });
    let State; try { State = require("@codemirror/state"); } catch (e) { return; }   // not inside Obsidian (the tests)
    this.registerEditorExtension(State.EditorState.transactionFilter.of(tr => {
      if (!tr.docChanged) return tr;
      const info = tr.startState.field(editorInfoField, false), path = info && info.file && info.file.path; if (!path) return tr;
      const before = tr.startState.doc, after = tr.newDoc, changes = [], seen = new Set();
      tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const a = before.lineAt(fromA), b = after.lineAt(fromB);
        if (toA > a.to || toB > b.to || seen.has(b.number)) return; seen.add(b.number);
        const next = VGRules.taskEdit(a.text, b.text, today(), VGRules.stampsDone(path)); if (next == null) return;
        let i = 0; while (i < next.length && i < b.text.length && next[i] === b.text[i]) i++;   // only what differs, so the cursor stays put
        changes.push({ from: b.from + i, to: b.to, insert: next.slice(i) });
      });
      return changes.length ? [tr, { changes, sequential: true }] : tr;
    }));
  }
  async setTaskStatus(notePath, line, text, status = "x") {
    const file = this.fileAt(notePath);
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
  // Tasks into a project's note. Cancelled first: a line that changed since it was shown (stale) is left where it is, not copied.
  async moveTasks(items, to) {
    const note = this.fileAt(to); if (!note) throw new Error(`${to} isn't there any more`);
    let n = 0;
    for (const it of items) {
      const moved = await this.setTasksStatus(VGRules.taskRowsOf(it), "-"); if (!moved) continue; n += moved;
      await this.ioProcess(note, t => VGRules.addProjectTask(t, `${it.text}${it.date ? ` (from [[${it.date}]])` : ""}`, (it.subs || []).map(s => s.text)));
    }
    return n;
  }
  writtenLinks() { const mc = this.app.metadataCache; return VGRules.writtenLinks(mc.resolvedLinks, p => mc.getCache(p), (l, from) => { const f = mc.getFirstLinkpathDest(l.split("#")[0], from); return f && f.path; }); }
  // How many notes link to each note that doesn't exist, the whole list (the graph data keeps only the top ones). Dailies and reports don't count.
  wantedCounts() {
    const un = this.app.metadataCache.unresolvedLinks || {}, by = new Map(); for (const [from, targets] of Object.entries(un)) { if (VGRules.inDaily(from) || from.startsWith(`${VGRules.folders.reports}/`) || EXCLUDE_PREFIXES.some(x => from.startsWith(x))) continue; for (const t of Object.keys(targets)) by.set(t, (by.get(t) || 0) + 1); }
    return [...by.values()];
  }
  // Notes naming a version other than the one you run (the rules file's drift: name, pattern with the version as its first group, current). Code blocks count: a pinned command drifts too.
  async driftScan() {
    const rules = VGRules.RULES.drift || [], out = []; if (!rules.length) return out;
    const skip = [VGRules.folders.reports + "/", VGRules.folders.templates + "/", VGRules.folders.archive + "/", VGRules.folders.system + "/", ...EXCLUDE_PREFIXES], res = rules.map(r => ({ ...r, re: new RegExp(r.pattern, "gi") }));
    for (const f of this.app.vault.getMarkdownFiles()) { if (VGRules.inDaily(f.path) || skip.some(x => f.path.startsWith(x)) || /\d{4}-\d{2}-\d{2}/.test(f.basename) || VGRules.isRecord({ id: f.path, name: f.basename, tags: [] })) continue;
      const lines = (await this.app.vault.cachedRead(f)).split(/\r?\n/); for (const r of res) { let hit = null; for (const l of lines) { r.re.lastIndex = 0; for (const m of l.matchAll(r.re)) if (m[1] && !String(m[1]).startsWith(r.current)) { hit = { found: m[1], text: l.trim() }; break; } if (hit) break; } if (hit) out.push({ path: f.path, name: r.name, current: r.current, ...hit }); } }
    return out;
  }
  // A guide's sites in every note (VGScience.guideSurvey; the lens is Guide scan, its presets the rules file's guides). Reports,
  // the archive and the tooling folders aren't read. Nothing is written.
  async guideScan(guide) {
    const skip = [VGRules.folders.reports + "/", VGRules.folders.archive + "/", ...EXCLUDE_PREFIXES], survey = VGScience.guideSurvey(guide);
    for (const f of this.app.vault.getMarkdownFiles()) { if (skip.some(x => f.path.startsWith(x))) continue; survey.add(f.path, await this.app.vault.cachedRead(f)); }
    return survey.done();
  }
  // Give notes a way up: parent: "[[Hub]]" in the frontmatter, as one action. A note that already has a parent keeps it. Rows: { path, hub }.
  async setParents(rows) {
    this.vitalsMemo = null; let n = 0;
    for (const r of rows) { const file = this.fileAt(r.path); if (!file) continue; await this.ioFrontMatter(file, fm => { if (fm.parent == null || fm.parent === "") { fm.parent = `[[${r.hub}]]`; n++; } }); }
    return n;
  }
  // How each [from, to] link is written, from Obsidian's index and the note's text: { kind, line, text }, with line only when the
  // link is one list line that can go without breaking a sentence. A link in generated sections doesn't count.
  async linkHow(rows) {
    const mc = this.app.metadataCache, re = VGRules.RULES.generated_link_sections ? new RegExp(VGRules.RULES.generated_link_sections, "i") : null, texts = new Map(), out = [];
    const dest = (l, from) => { const f = mc.getFirstLinkpathDest(l.split("#")[0], from); return f && f.path; };
    for (const [from, to] of rows) {
      const c = mc.getCache(from) || {}, file = this.fileAt(from); if (!file) { out.push({ from, to, kind: "sentence" }); continue; }
      if (!texts.has(from)) texts.set(from, (await this.app.vault.cachedRead(file)).split(/\r?\n/));
      const lines = texts.get(from), heads = c.headings || [], kinds = [], at = [];
      for (const l of c.links || []) { if (dest(l.link, from) !== to) continue; const ln = l.position.start.line, h = heads.filter(x => x.position.start.line <= ln).pop(), head = h ? h.heading : ""; if (re && re.test(head.trim())) continue; kinds.push(VGRules.linkKindOf(lines[ln], head)); at.push(ln); }
      (c.frontmatterLinks || []).forEach(l => { if (dest(l.link, from) === to) kinds.push("frontmatter"); });
      const hardest = kinds.map(k => VGRules.LINK_KINDS.indexOf(k)).sort((a, b) => a - b)[0], one = kinds.length === 1 && at.length === 1 && VGRules.bareLinkLine(lines[at[0]]);
      out.push({ from, to, kind: VGRules.LINK_KINDS[hardest] || "sentence", ...(one ? { line: at[0], text: lines[at[0]] } : {}) });
    }
    return out;
  }
  // Take list lines out, as one action. A line that changed since it was shown stays. Rows: { path, line, text }.
  async dropLinkLines(rows) {
    this.vitalsMemo = null; const byPath = new Map(); rows.forEach(r => { if (!byPath.has(r.path)) byPath.set(r.path, []); byPath.get(r.path).push(r); }); let n = 0;
    for (const [path, list] of byPath) { const file = this.fileAt(path); if (!file) continue;
      await this.ioProcess(file, data => { const nl = data.includes("\r\n") ? "\r\n" : "\n", lines = data.split(/\r?\n/); list.slice().sort((a, b) => b.line - a.line).forEach(r => { if (lines[r.line] === r.text && VGRules.bareLinkLine(r.text)) { lines.splice(r.line, 1); n++; } }); return lines.join(nl); }); }
    return n;
  }
  // How much of the Sync limit the vault's history uses, asked at most hourly and never held up for: its limit counts version history, so a
  // big file rewritten often fills it. Obsidian's own, not a published interface, so anything unexpected means no figure rather than a wrong one.
  async syncStorage() {
    const now = Date.now(); if (this.syncSize && now - this.syncSize.t < 3600000) return this.syncSize.v;
    try { const s = this.app.internalPlugins && this.app.internalPlugins.plugins && this.app.internalPlugins.plugins.sync, i = s && s.enabled && s.instance; if (!i || !i.size) return null;
      const r = await Promise.race([i.size(), new Promise(res => setTimeout(() => res(null), 4000))]); const v = r && r.size > 0 && r.limit > 0 ? { used: r.size, limit: r.limit } : null; this.syncSize = { t: now, v }; return v; }
    catch (e) { this.syncSize = { t: now, v: null }; return null; }
  }
  // HQ's vitals, from the same methods and links as the lenses. Kept briefly, since HQ asks after every update; a task or review
  // changed clears it. One sample a day goes in the shared state (small, and capped), for the trend.
  async vitals() {
    const now = Date.now(); if (this.vitalsMemo && now - this.vitalsMemo.t < 60000) return this.vitalsMemo.v;
    const data = await this.graphData(); if (!data || !data.nodes) return null;
    const out = this.writtenLinks(), pairs = [], day = today(), staleDays = (data.quality || {}).stale_days, inbox = `${VGRules.folders.inbox}/`;
    for (const l of data.links || []) { if (l.kind !== "link") continue; if (out[l.source] && out[l.source][l.target]) pairs.push([l.source, l.target]); if (out[l.target] && out[l.target][l.source]) pairs.push([l.target, l.source]); }
    const v = VGScience.vitals({ rows: VGScience.taskLives(await this.taskHistory(), day).rows, today: day, pairs, areaOf: t => VGRules.areaOfText(VGRules.plainTask(t)),
      notes: data.nodes.filter(n => !n.person && !n.ghost && !n.moc).map(n => ({ id: n.id, name: n.name, age: n.age || 0, stale: VGRules.isStale(n, staleDays) })) });
    // what's open is what HQ lists, so the two can't disagree; came in and finished stay the Flow lens's own count
    const sh = await this.loadShared(), carried = VGRules.todayList(data, { review: sh && sh.review, hidden: sh && sh.cosmos && sh.cosmos.hidden, today: day }).filter(i => i.kind === "carried");
    v.sync = await this.syncStorage();
    try { v.drift = (await this.driftScan()).length; } catch (e) { v.drift = 0; }
    v.pile.open = carried.length; v.pile.old = carried.filter(i => i.age > 30).length;
    v.web.noWayUp = data.nodes.filter(n => !n.person && !n.ghost && !n.moc && !VGRules.isRecord(n) && !n.id.startsWith(inbox) && !Object.keys(out[n.id] || {}).length).length;
    this.vitalsMemo = { t: now, v };
    if (!(sh && sh.review && sh.review.vitals && sh.review.vitals[day])) await this.updateShared(s => { s.review = s.review || {}; const h = s.review.vitals = { ...(s.review.vitals || {}), [day]: VGScience.vitalsSample(v) }; Object.keys(h).sort().slice(0, -180).forEach(d => delete h[d]); return s; });
    return v;
  }
  async setTasksStatus(rows, status) {
    this.vitalsMemo = null;
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
    const file = this.fileAt(notePath);
    if (!(file instanceof TFile)) throw new Error("missing note");
    const n = await this.markOpenTasks(file, status), tag = NOTE_STATUS[status];
    if (tag && n) await this.ioFrontMatter(file, fm => {   // only a note whose tasks did change is marked done or cancelled
      const tags = [].concat(fm.tags || []).map(t => String(t).replace(/^#/, "")).filter(t => !t.startsWith("status/"));
      fm.tags = [...tags, tag];
    });
    return n;
  }

