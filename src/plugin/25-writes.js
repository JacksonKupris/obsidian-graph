  // ---- the vault writes (WRITE_PRIMITIVES): each records its change in the open undo entry, then writes
  fileAt(p) { return fileIn(this.app.vault, p); }
  pathTaken(p) { return !!this.app.vault.getAbstractFileByPath(normalizePath(p)); }   // a note, another file or a folder
  fmOf(file) { return fmIn(this.app.metadataCache, file); }
  // a JSON file's contents, or fallback when it's missing or doesn't parse (another device may be writing it)
  async readJson(p, fallback = null) { try { return JSON.parse(await this.app.vault.adapter.read(normalizePath(p))); } catch (e) { return fallback; } }
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
  async ioData(path, text) { await this.app.vault.adapter.write(path, text); }   // the plugin's data files the analysis reads (dismissals) and kept originals; not undoable
  // a folder and every folder above it, for a file the adapter writes
  async mkdirs(dir) { const A = this.app.vault.adapter, parts = normalizePath(dir).split("/"); for (let i = 1; i <= parts.length; i++) { const d = parts.slice(0, i).join("/"); if (d && !await A.exists(d)) await A.mkdir(d); } }

  // An entry closes when its action finishes: note what each file looks like now, so an undo can tell if it changed since
  async closeUndo(e) {
    if (!e.ops.length) return;
    const renamedTo = (i, p) => e.ops.slice(i + 1).reduce((q, o) => (o.kind === "rename" && o.from === q ? o.to : q), p);
    for (const [i, o] of e.ops.entries()) {
      if (o.kind === "rename") continue;
      const f = this.fileAt(renamedTo(i, o.path));
      o.after = f && !o.binary ? await this.app.vault.read(f) : null;
    }
    e.id = ++this.undoSeq; e.when = Date.now();
    this.undoLog = [...this.undoLog, e].slice(-UNDO_KEEP);
    await this.saveUndoLog();
  }
  // The undo list outlives a restart: kept in the cache folder, which Obsidian Sync leaves out, since it holds what a note looked like on this PC.
  // Oldest entries go first if it grows past the limit; a change it can't keep can still be rolled back from the vault's own history.
  undoLogPath() { return normalizePath(`${VGRules.folders.cache}/undo-log.json`); }
  async saveUndoLog() {
    try { const io = this.app.vault.adapter, dir = normalizePath(VGRules.folders.cache); let keep = this.undoLog, text = JSON.stringify({ seq: this.undoSeq, log: keep });
      while (text.length > UNDO_FILE_MAX && keep.length) { keep = keep.slice(1); text = JSON.stringify({ seq: this.undoSeq, log: keep }); }
      if (io.mkdir && !await io.exists(dir)) await io.mkdir(dir); await io.write(this.undoLogPath(), text); }
    catch (err) { console.error("Vault Graph: the undo list wasn't saved", err); }
  }
  async loadUndoLog() {
    const d = await this.readJson(this.undoLogPath()); if (d && Array.isArray(d.log)) { this.undoLog = d.log; this.undoSeq = Math.max(d.seq || 0, ...d.log.map(e => e.id || 0)); }
  }
  // What the message said, so Recent changes reads the same
  labelUndo(id, label) { const e = this.undoLog.find(x => x.id === id); if (e) { e.label = label; this.saveUndoLog(); } }
  recentChanges() { return this.undoLog.slice().reverse().map(e => ({ id: e.id, label: e.label || "", when: e.when || 0, files: [...new Set(e.ops.map(o => o.path || o.to).filter(Boolean))] })); }
  lastUndo() { const e = this.undoLog[this.undoLog.length - 1]; return e ? e.id : 0; }
  // Put back what one action changed, its last change first. Nothing is undone if any of its files changed since.
  async undo(id) {
    this.vitalsMemo = null;
    const e = this.undoLog.find(x => x.id === id);
    if (!e) throw new Error("it's no longer in the undo list");
    if (this.undoCur) this.undoCur.label = `Undid: ${e.label || "a change"}`;
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
    this.undoLog = this.undoLog.filter(x => x !== e); await this.saveUndoLog();
  }
