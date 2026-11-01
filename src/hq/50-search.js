  function searchScreen() {
    const query = globalQuery.trim(), projects = VGRules.hqProjectSearch(DATA, VGRules.hqProjects(DATA), query, { today: day() });
    const itemHits = LIST.map(it => ({ it, score: Math.max(VGRules.fuzzyScore(query, it.title), VGRules.fuzzyScore(query, it.text || ""),
      VGRules.fuzzyScore(query, it.path || "") - 2, VGRules.fuzzyScore(query, it.why || "") - 3) }))
      .filter(x => x.score >= 0).sort((a, b) => b.score - a.score || a.it.title.localeCompare(b.it.title)).slice(0, 12);
    const projectPaths = new Set((DATA.hq && DATA.hq.projects || []).map(p => p.path));
    const notes = noteHits.filter(hit => !projectPaths.has(hit.path)).slice(0, 16);
    const projectRows = projects.map(p => `<button class="vg-hq-proj vg-hq-search-proj" data-proj="${esc(p.path)}"><span class="vg-hq-projbody">
      <span class="vg-hq-projhead"><small>${esc(p.kind || "Project")}</small><span class="vg-hq-pill is-${esc(p.group)}">${esc(p.status || "no status")}</span></span>
      <b>${esc(p.title)}</b><span class="vg-hq-sum">${esc(p.summary || "No summary yet.")}</span>
      ${p.searchHit ? `<small class="vg-hq-search-hit">${esc([p.searchHit.heading, p.searchHit.why.join(" · ")].filter(Boolean).join(" · "))}${p.searchHit.snippet ? `<span>${esc(p.searchHit.snippet)}</span>` : ""}</small>` : ""}
      <small>${esc(p.path)}</small></span></button>`).join("");
    const noteRows = notes.map(hit => `<article class="vg-hq-note-hit"><div><b>${esc(hit.heading || hit.path.split("/").pop())}</b>
      <small>${esc(hit.path)}${hit.line ? ` · line ${hit.line}` : ""}${hit.why && hit.why.length ? ` · ${esc(hit.why.join(" · "))}` : ""}</small>
      ${hit.snippet ? `<p>${esc(hit.snippet)}</p>` : ""}</div>${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(hit.path)}">Open source</button>` : ""}</article>`).join("");
    const itemRows = itemHits.map(({ it }) => row(it)).join("");
    const pending = searchPending;
    const emptyResult = !projectRows && !itemRows && !noteRows
      ? `<div class="vg-hq-empty">${noteSearchError ? esc(noteSearchError) : pending ? "Searching vault notes…" : "No matching HQ items or vault notes."}</div>` : "";
    return `<h1 class="vg-hq-h1">Search results</h1><p class="vg-hq-lede">Across HQ items, every project, and vault notes. Project filters do not limit these results.</p>` +
      (itemRows ? section("HQ items", itemHits.map(x => x.it)) : "") +
      (projectRows ? `<section class="vg-hq-sec"><h3>Projects <span>${projects.length}</span></h3><div class="vg-hq-grid">${projectRows}</div></section>` : "") +
      (noteRows ? `<section class="vg-hq-sec"><h3>Vault notes <span>${notes.length}</span></h3>${noteRows}</section>` : "") +
      (pending || noteSearchError ? `<p class="vg-hq-lede" role="status">${esc(noteSearchError || "Searching vault notes…")}</p>` : "") +
      emptyResult + drawerHtml(VGRules.hqProjects(DATA));
  }
  function searchNotes(query, delay = 180) {
    clearTimeout(searchTimer);
    const token = ++searchToken;
    noteHits = []; noteSearchError = ""; searchPending = !!(query.trim() && api.searchNotes);
    if (!query.trim() || !api.searchNotes) return;
    searchTimer = setTimeout(async () => {
      try {
        const hits = await api.searchNotes(query.trim(), 24);
        if (token !== searchToken) return;
        noteHits = Array.isArray(hits) ? hits : []; searchPending = false;
      } catch (error) {
        if (token !== searchToken) return;
        noteSearchError = "Vault note search is unavailable right now."; searchPending = false;
      }
      render();
    }, delay);
  }

  // a project's status from its drawer, as a shared action (its message and Undo): shown at once, the host's redraw
  // brings the note's truth. A closing status with open tasks asks first, then ticks (or cancels) them in the same write.
  async function setStatus(path, status, btn) {
    const p = ((hq() || {}).projects || []).find(x => x.path === path); if (!p || p.status === status) return;
    const open = (p.tasks || []).length, top = (p.tasks || []).filter(t => !t.sub).map(t => t.title);
    const mark = open ? VGRules.closeMark(status) : null, done = mark === "x" ? "ticked" : "cancelled";
    const list = top.slice(0, 6).join("; ") + (top.length > 6 ? `; and ${top.length - 6} more` : "");
    btn.disabled = true;
    const ok = await VGActions.run({ label: () => "Set status", title: () => p.title,
      ask: mark ? () => [`Set ${p.title} to ${status}?`, `${plural(open, "open task")} will be ${done}: ${list}.`, `Set to ${status}, ${done === "ticked" ? "tick" : "cancel"} ${plural(open, "task")}`] : null,
      run: async () => { const n = await api.setProjectStatus(path, status, !!mark); return `${p.title}: ${status}${n ? ` · ${plural(n, "task")} ${done}` : ""}`; } }, p, ctx());
    if (!ok) { if (btn.isConnected) btn.disabled = false; return; }
    Object.assign(p, { status, group: VGRules.statusGroup(status), updated: day() }, mark ? { tasks: [] } : {}); render();
  }
  // Done ("x") or Cancel ("-") on a project's open tasks from its drawer: one (its line) or all of them
  async function projectTasks(how, line, btn) {
    const p = ((hq() || {}).projects || []).find(x => x.path === drawer); if (!p) return;
    const list = (p.tasks || []).filter(t => line === null || t.line === line).map(t => ({ ...t, path: p.path }));
    if (!list.length) return;
    btn.disabled = true;
    const ok = await VGActions.runBatch(list, how, ctx(), p.title);
    if (!ok) { if (btn.isConnected) btn.disabled = false; return; }
    const lines = new Set(list.map(t => t.line)); p.tasks = p.tasks.filter(t => !lines.has(t.line)); render();
  }

