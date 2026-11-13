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
  // A ticked row of the map report, written through the same writes as every action, so it can be undone. Each row checks
  // what's there now: a report can be days old, and topics move between runs.
  async applyMapRows(file) {
    const V = this.app.vault, today0 = VGRules.today(), done = []; let skipped = 0, already = 0; const adds = new Map(), at = p => this.fileAt(p), E = VGEngine;
    for (const row of E.rowsOf(await V.read(file))) { if (!/[xX]/.test(row.state)) { skipped++; continue; } const act = row.act; if (!act) { done.push(`skipped a row that can't be read: ${row.label.slice(0, 60)}`); continue; }
      if (act.op === "add") { if (!adds.has(act.moc)) adds.set(act.moc, []); adds.get(act.moc).push(act.note); continue; }
      if (act.op === "tag") { let f = at(act.path); if (!f) { const name = VGShared.baseOf(act.path), same = V.getMarkdownFiles().filter(x => x.name === name); if (same.length !== 1) { done.push(`skipped tag on ${act.path} (not found)`); continue; } f = same[0]; }   // moved since: follow it by name
        const has = VGEngine.frontmatterTags(this.fmOf(f)).includes(act.tag); if (has) { already++; continue; }
        await this.ioFrontMatter(f, fm => { const list = fm.tags == null ? [] : [].concat(fm.tags); fm.tags = [...list, act.tag]; }); done.push(`tagged ${act.path} ${act.tag}`);
      } else if (act.op === "move") { const f = at(act.path), dest = `${act.to}/${VGShared.baseOf(act.path)}`; if (at(dest) && !f) { already++; continue; } if (at(dest)) { done.push(`skipped move of ${act.path} (${dest} already exists)`); continue; } if (!f) { done.push(`skipped move of ${act.path} (not found)`); continue; }
        if (!this.pathTaken(act.to)) await this.ioFolder(act.to); await this.ioRename(f, dest); done.push(`moved ${act.path} to ${act.to}/`);
      } else if (act.op === "merge") { const src = at(act.path), dst = at(act.into); if (!src || !dst) { done.push(`skipped merge of ${act.path} (not found)`); continue; } const s = await V.read(src), d = await V.read(dst), fresh = act.links.filter(r => !E.linkedIn(d, r));
        if (s.includes("Superseded by") && !fresh.length) { already++; continue; } const into = VGShared.nameOf(act.into);
        if (!s.includes("Superseded by")) await this.ioModify(src, E.underFrontmatter(s, `> [!note] Superseded by [[${into}]] (${today0}) — keep using that one.\n\n`));
        if (fresh.length) await this.ioModify(dst, E.appendSection(d, `## Merged from [[${VGShared.nameOf(act.path)}]] (${today0})`, fresh.map(r => `- [[${VGShared.nameOf(r)}]]`))); done.push(`merged ${act.path} into ${act.into} (${fresh.length} new links)`);
      } else if (act.op === "create") { if (at(act.path)) { already++; continue; } const data = await this.graphData(), nodes = new Map(data.nodes.map(n => [n.id, n])), votes = new Map(); (act.core || []).forEach(r => { const c = (nodes.get(r) || {}).cluster; if (c != null && c >= 0) votes.set(c, (votes.get(c) || 0) + 1); });
        // topic numbers change between runs, so the topic is found by its notes
        const [cid, hits] = [...votes].sort((a, b) => b[1] - a[1])[0] || [null, 0], members = cid == null ? [] : data.nodes.filter(n => n.cluster === cid && !n.person && !n.moc && !n.ghost), mapped = cid != null && (data.mocs || []).find(m => (m.clusters || []).includes(cid));
        if (cid == null || hits < Math.max(2, Math.floor(((act.core || []).length + 1) / 2)) || members.length < 3) { done.push(`skipped create ${act.path} (its topic changed since the report: write a new report for a fresh row)`); continue; }
        if (mapped) { done.push(`skipped create ${act.path} (that topic is now covered by ${mapped.title})`); continue; }
        const folder = act.path.slice(0, act.path.lastIndexOf("/")); if (folder && !this.pathTaken(folder)) await this.ioFolder(folder); const ms = members.sort((a, b) => (b.bc || 0) - (a.bc || 0)).map(n => n.id); await this.ioCreate(act.path, E.mapNote(act.name, ms, today0)); done.push(`created ${act.path} (${ms.length} notes)`);
      } else if (act.op === "bridge") { if (act.name_a === act.name_b) { done.push(`skipped bridge ${act.name_a} with itself`); continue; } const name = `Bridge — ${act.name_a} ↔ ${act.name_b}`, path = `${VGRules.folders.inbox}/${name.replace(/[\\/:*?"<>|#^\[\]]/g, "")}.md`;
        if (at(path)) { done.push(`skipped ${path} (exists)`); continue; } await this.ioCreate(path, E.bridgeNote(act, name, today0)); done.push(`drafted ${path}`);
      } else done.push(`skipped a row with an unknown kind: ${act.op}`); }
    for (const [moc, notes] of adds) { const f = at(moc); if (!f) { done.push(`skipped adding to ${moc} (not found)`); continue; } const cur = await V.read(f), fresh = notes.filter((r, i) => notes.indexOf(r) === i && !E.linkedIn(cur, r)); already += notes.length - fresh.length; if (!fresh.length) continue;
      await this.ioModify(f, E.appendSection(cur, `## Also in this topic (added ${today0})`, fresh.map(r => `- [[${VGShared.nameOf(r)}]]`))); done.push(`added ${fresh.length} notes to ${moc}`); }
    return `${done.join("\n") || "nothing new to apply"}\n(${skipped} unticked rows left alone; ${already} ticked rows were already done)`;
  }
  // A report in the reports folder. One a person has ticked is never overwritten: that's their decisions.
  async writeReport(name, text) {
    const folder = VGRules.folders.reports, V = this.app.vault, stamp = () => { const d = new Date(); return `${VGShared.pad2(d.getHours())}${VGShared.pad2(d.getMinutes())}`; }; if (!this.pathTaken(folder)) await this.ioFolder(folder);
    const path = `${folder}/${name}.md`, f = this.fileAt(path); if (!(f instanceof TFile)) { await this.ioCreate(path, text); return path; }
    if (/^\s*- \[[xX\-]\]/m.test(await V.read(f))) { const other = `${folder}/${name} ${stamp()}.md`; const o = this.fileAt(other); if (o instanceof TFile) await this.ioModify(o, text); else await this.ioCreate(other, text); return other; }
    await this.ioModify(f, text); return path;
  }
  async reportInputs() { const G = await this.engineGather(), N = await this.engineNotes(G, { topics: true, prev: this.settings.engineTopics }), date = VGRules.today(); return { G, N, date, input: { R: N.parts.report, T: N.T, date, since: VGEngine.dayShift(date, 365), used: N.used } }; }
  async writeGapsReport() { const { input, date } = await this.reportInputs(), path = await this.writeReport(`Gaps & Bridges ${date}`, VGEngine.gapsReport(input)); new Notice(`Wrote ${path}`); return path; }
  // topics move between runs, so an older map report's rows go stale: it's pointed at the new one
  async writeMapReport() { const { G, N, date } = await this.reportInputs(), R = VGRules.RULES, path = await this.writeReport(`MOC Alignment ${date}`, VGEngine.mapReport({ P: N.parts, T: N.T, raw: G.raw, tags: G.tags, knowledge: G.T.knowledge, date, inbox: VGRules.folders.inbox, notTops: R.not_map_tops || [], min_claim: R.map_min_claim, moveTarget: R.stray_folder || VGRules.folders.inbox }));
    const stem = VGShared.nameOf(path); for (const f of this.app.vault.getMarkdownFiles()) { if (f.path === path || !f.path.startsWith(`${VGRules.folders.reports}/MOC Alignment `)) continue; const t = await this.app.vault.read(f); if (t.includes("Superseded by [[")) continue;
      await this.ioModify(f, VGEngine.underFrontmatter(t, `> [!warning] Superseded by [[${stem}]] (${date})\n> Topics were re-clustered since this report. Ticked rows here were applied or skipped already; tick in the new report instead.\n\n`)); }
    new Notice(`Wrote ${path}`); return path; }
  async writeStateNote() { const d = await this.graphData(), date = VGRules.today(), md = VGEngine.stateNote(d, { levels: VGRules.trophicLevels, isRecord: VGRules.isRecord }), folder = VGRules.folders.reports, base = `${folder}/State of the Vault ${date}.md`, V = this.app.vault; if (!this.pathTaken(folder)) await this.ioFolder(folder);
    let path = base; if (this.pathTaken(base)) { const n = new Date(); path = `${folder}/State of the Vault ${date} ${VGShared.pad2(n.getHours())}${VGShared.pad2(n.getMinutes())}.md`; } if (this.fileAt(path)) await this.ioModify(this.fileAt(path), md); else await this.ioCreate(path, md); new Notice(`Wrote ${path}`); return path; }
  applyMocReport() {
    return this.mocReportFile().then(file => {
      if (!file) throw new Error("no report");
      return this.applyMapRows(file).then(
        text => { new Notice("Map alignment applied:\n" + text.slice(0, 400), 8000); return text; },
        err => { new Notice(`Map alignment failed: ${err.message}`, 10000); throw err; });
    });
  }

  // opts.replace: a picture that stands for a day (the State of the vault maps) takes the place of the one already there
  // (that one goes to the trash) instead of becoming `name 2.png`
  async saveBinary(notePath, buf, opts = {}) {
    let path = normalizePath(notePath);
    const folder = path.split("/").slice(0, -1).join("/");
    if (folder && !this.pathTaken(folder)) await this.ioFolder(folder);
    const old = opts.replace && this.fileAt(path);
    if (old instanceof TFile) await this.ioTrash(old);
    for (let i = 2; this.pathTaken(path); i++) path = notePath.replace(/(\.\w+)$/, ` ${i}$1`);
    await this.ioCreateBinary(path, buf);
    new Notice(`Saved ${path}`);
    return path;
  }

  // read by: dismissed pairs are never suggested again (graph or weekly report)
  async dismiss(a, b, kind) {
    const path = normalizePath(this.settings.dismissedPath), adapter = this.app.vault.adapter;
    const data = (await this.readJson(path)) || { version: 1, pairs: [] };   // the first dismissal creates the file
    data.pairs = data.pairs || [];
    DISMISSED.add(dismissKey(a, b));
    this.cacheStale = true;
    if (data.pairs.some(p => (p.a === a && p.b === b) || (p.a === b && p.b === a))) return;   // already dismissed
    const pair = { a, b, kind, date: today(), via: "graph" };
    data.pairs.push(pair); this.dismissedPairs = [...(this.dismissedPairs || []), pair];
    await this.ioData(path, JSON.stringify(data, null, 2) + "\n");
    await this.recordLedger(null, [pair]);   // kept even if Sync later keeps another device's copy of the file
  }
};
