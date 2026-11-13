  // "Named in daily notes but never linked": turn the first plain mention of the note in each daily note that names
  // it into a link. dryRun lists those daily notes without writing. Frontmatter, code, existing links and URLs are left alone.
  // Only the dailies the analysis counted (said_unlinked's third field): the day a mention is new, not every later
  // standup whose task table carries the same row, nor the rollups that copy it.
  async linkMentions(notePath, dryRun) {
    const f = this.fileAt(notePath); if (!(f instanceof TFile)) throw new Error("missing note");
    // every way the analysis counts a mention (title, "<Topic> - Context" topic, aliases): shared rule
    const names = VGRules.mentionNames(f.basename, (this.fmOf(f) || {}).aliases);
    if (!names.length) return [];   // a generic title with no aliases: prose never names it
    const pat = names.map(VGShared.escapeRegex).join("|"), re = new RegExp(`(^|[^\\w\\[|/#])(${pat})(?![\\w\\]])`, "i");
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
      if (!VGRules.inDaily(d.path) || (resolved[d.path] || {})[f.path]) continue;   // already links it
      if (asked && !asked.has(d.path)) continue;
      const text = await this.app.vault.cachedRead(d); if (!re.test(text) || linkFirst(text, d.path) == null) continue;
      if (!dryRun) await this.ioProcess(d, t => linkFirst(t, d.path) ?? t);
      out.push(d.path);
    }
    return out;
  }
  async linkNotes(fromPath, toPath, why) {
    const from = this.fileAt(fromPath), to = this.fileAt(toPath);
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
    if (folder && !this.pathTaken(folder)) await this.ioFolder(folder);
    let file = this.fileAt(path);
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
      const name = VGShared.nameOf(path);
      const existing = file instanceof TFile ? file : this.app.metadataCache.getFirstLinkpathDest(name, "");
      if (existing instanceof TFile) {
        // the part from the marker down is regenerated inside one read-and-write (vault.process), so text typed into
        // the note meanwhile isn't lost; a note without the marker isn't Vault Graph's and is left alone
        const cut = md.indexOf(MARKER), ours = cut >= 0 && (await this.app.vault.cachedRead(existing)).includes(MARKER);
        if (ours) await this.ioProcess(existing, text => { const at = text.indexOf(MARKER); return at >= 0 ? text.slice(0, at) + md.slice(cut) : text; });
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
    const file = this.fileAt(notePath);
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
    const file = this.fileAt(notePath);
    if (!(file instanceof TFile)) { new Notice(`Not found: ${notePath}`); throw new Error("missing note"); }
    const dir = normalizePath(folder);
    if (!this.pathTaken(dir)) await this.ioFolder(dir);
    const dest = normalizePath(`${dir}/${file.name}`);
    if (this.pathTaken(dest)) { new Notice(`${dest} already exists — not moved`); throw new Error("exists"); }
    await this.ioRename(file, dest);
    new Notice(`Moved to ${dir}/`);
    return dest;
  }

  // Unchecked tasks in a note: [{line, text}]
  async readTasks(notePath) {
    const file = this.fileAt(notePath);
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
        if (!this.pathTaken(folder)) {
          try { await this.ioFolder(folder); }
          catch (error) { if (!this.pathTaken(folder)) throw error; }
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
        : VGRules.HQ.plain_journal ? `# ${date}\n\n## Today's Tasks\n\n- [ ] \n` : `---\nDate: ${date}\ntags:\n  - daily/journal\n---\n\n# ${date}\n\n**Standup:** [[Daily Standup ${date}]]\n\n## Today's Tasks\n\n- [ ] \n`;
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

  // The one set of actions every graph surface gets (main view, local pane, embeds). Each goes through a
  // plugin method in WRITE_ACTIONS, which writes and then announces the change, so every open surface redraws.
  // Each write publishes the new state to every surface, the one that made it included.
  viewActions(owner) {
    return {
      openNote: (notePath, newPane) => {
        const target = String(notePath || "");
        const file = this.fileAt(target) ||
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
      moveTasks: (items, to) => this.moveTasks(items, to),
      recentChanges: () => this.recentChanges(),
      version: () => this.manifest.version,
      hqNewsSeen: version => this.updateShared(sh => { sh.review = sh.review || {}; sh.review.hqNewsSeen = version; return sh; }),
      labelUndo: (id, label) => this.labelUndo(id, label),
      setParents: rows => this.setParents(rows),
      vitals: () => this.vitals(),
      setNoteStatus: (notePath, status, reason) => this.setNoteStatus(notePath, status, reason),
      setProjectStatus: (notePath, status, closeTasks) => this.setProjectStatus(notePath, status, closeTasks),
      hqMark: (key, mark) => this.hqMark(key, mark),
      hqReact: (kind, how) => this.hqReact(kind, how),
      capture: (text, kind, to) => this.capture(text, kind, to),
      hqTourSeen: () => this.updateShared(sh => { sh.review = sh.review || {}; sh.review.hqTour = true; return sh; }),
      goNextStep: () => this.goNextStep(),
      focusNow: () => this.focusNow || null,
      resolveLink: (target, from) => { const f = this.app.metadataCache.getFirstLinkpathDest(target, from || ""); return f ? f.path : null; },
      hqFocus: keys => this.hqFocus(keys),
      hqSession: (day, minutes, project) => this.updateShared(sh => { sh.review = sh.review || {}; sh.review.sessions = VGRules.sessionAdded(sh.review, day, minutes); if (project) sh.review.sessionFor = { ...(sh.review.sessionFor || {}), [project]: VGRules.projectMinutes(sh.review, project) + minutes }; return sh; }),
      readNote: async notePath => { const f = this.fileAt(notePath); if (!(f instanceof TFile)) throw new Error("missing note"); return this.app.vault.cachedRead(f); },
      hqHome: hidden => this.updateShared(sh => { sh.review = sh.review || {}; sh.review.hqHome = hidden; return sh; }),
      planLine: text => this.planLine(text),
      searchMeaning: (q, n) => this.searchMeaning(q, n),
      stampReviewed: notePath => { this.vitalsMemo = null; return this.stampReviewed(notePath); },
      dismissedPairs: () => this.dismissedPairs || [],
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

