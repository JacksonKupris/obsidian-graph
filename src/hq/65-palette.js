  // ---- the command palette (Ctrl K): one box for everything. Commands, today's work and projects answer as you type; your
  // notes follow as soon as the search does, and what they mean after that. Enter runs the highlighted row.
  let palette = null;
  // a short query is the start of a word ("ses" isn't "Review RTI Server Software" or "wire harnesses"); a longer one may skip letters
  const closeTo = (t, text) => t.length <= 4 && !String(text).toLowerCase().split(/[^a-z0-9]+/).some(w => w.startsWith(t.toLowerCase())) ? -1 : VGRules.fuzzyScore(t, text);
  function paletteCommands(q) {
    const t = q.trim(), go = (label, s, hint) => ({ label, hint, run: () => setScreen(s) });
    const base = [go("Home", "home", "1"), go("Today", "today", "2"), go("Needs you", "needs", "3"), go("People", "people", "4"), go("Projects", "projects", "5"), go("Calendar", "calendar", "6"), go("Threads", "threads"), { label: `Next: ${nextStep().label}`, run: goNext }, ...(api.hqSession ? [{ label: "Start a focus session", hint: "s", run: () => sessionStart() }] : []), go("Wrap up", "wrap", "w"), go("Weekly review", "review", "r"), go("Automations", "automations"),
      ...(api.openDaily ? [{ label: "Open today's journal", run: () => api.openDaily(day()) }] : []), ...(api.openStandup ? [{ label: "Open today's standup", run: () => api.openStandup(day()) }] : []), ...(opts.openGraph ? [{ label: "Open the graph", run: () => opts.openGraph() }] : [])];
    if (!t) return base;
    return base.map(c => ({ c, s: closeTo(t, c.label) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 4).map(x => x.c);
  }
  function paletteRows(q) {
    const t = q.trim(), cmds = paletteCommands(q), rows = cmds.length ? [{ head: t ? "Go" : "Go to" }, ...cmds] : [];
    if (!t) return rows;
    const items = LIST.map(it => ({ it, s: closeTo(t, it.title) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 6);
    if (items.length) rows.push({ head: "Open work" }, ...items.map(({ it }) => ({ label: it.title, hint: VGRules.kindWords(it.kind), run: () => { setScreen(it.group === "needs" ? "needs" : it.group === "upkeep" ? "home" : "today"); selectItem(it.key); } })));
    const projects = VGRules.hqProjects(DATA).map(p => ({ p, s: Math.max(closeTo(t, p.title), closeTo(t, p.name || "")) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 5);
    if (projects.length) rows.push({ head: "Projects" }, ...projects.map(({ p }) => ({ label: p.title, hint: p.status || "project", run: () => { setScreen("projects"); drawer = p.path; focusDrawerOnRender = true; render(); } })));
    if (palette.notes.length) rows.push({ head: "In your notes" }, ...palette.notes.map(h => ({ label: nameOf(h.path), sub: VGRules.plainSnippet(h.snippet), hint: h.heading && h.heading !== nameOf(h.path) ? h.heading : "", run: () => api.openNote && api.openNote(h.path) })));
    if (palette.meaning.length) rows.push({ head: "Similar in meaning" }, ...palette.meaning.map(h => ({ label: nameOf(h.path), hint: h.heading || "", run: () => api.openNote && api.openNote(h.path) })));
    if (api.capture) rows.push({ head: "Capture" }, { label: `Add task: ${t}`, hint: "today's journal", run: () => api.capture(t, "task").then(() => toast("Added to today")) }, { label: `Save note: ${t}`, hint: "inbox", run: () => api.capture(t, "note").then(() => toast("Note saved")) });
    return rows;
  }
  function paletteDraw() {
    if (!palette) return; const rows = palette.rows = paletteRows(palette.box.querySelector("input").value), runs = rows.filter(r => r.run);
    palette.at = Math.max(0, Math.min(runs.length - 1, palette.at));
    palette.box.querySelector(".vg-hq-palrows").innerHTML = rows.map(r => r.head ? `<div class="vg-hq-palhead">${esc(r.head)}</div>` : `<button class="vg-hq-palrow${runs[palette.at] === r ? " is-at" : ""}" data-pal="${runs.indexOf(r)}"><span><b>${esc(r.label)}</b>${r.sub ? `<small>${esc(r.sub.slice(0, 110))}</small>` : ""}</span>${r.hint ? `<em>${esc(r.hint)}</em>` : ""}</button>`).join("") || '<p class="vg-hq-ctx-none">Nothing matches.</p>';
    const on = palette.box.querySelector(".vg-hq-palrow.is-at"); if (on) on.scrollIntoView({ block: "nearest" });
  }
  function paletteSearch(q) {
    clearTimeout(palette.timer); palette.notes = []; palette.meaning = []; const token = ++palette.token, t = q.trim(); if (!t) return;
    palette.timer = setTimeout(async () => {
      if (api.searchNotes) { try { const hits = await api.searchNotes(t, 8); if (palette && token === palette.token) { palette.notes = (hits || []).filter((h, i, a) => a.findIndex(x => x.path === h.path) === i).slice(0, 6); paletteDraw(); } } catch (e) { /* the rest of the palette still works */ } }
      if (api.searchMeaning) { try { const hits = await api.searchMeaning(t, 5); if (palette && token === palette.token) { const have = new Set(palette.notes.map(h => h.path)); palette.meaning = (hits || []).filter(h => !have.has(h.path)).slice(0, 4); paletteDraw(); } } catch (e) { /* keyword results stand on their own */ } }
    }, 110);
  }
  function openPalette() {
    if (palette) { palette.box.querySelector("input").select(); return; }
    const box = document.createElement("div"); box.className = "vg-hq-palette"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Command palette");
    box.innerHTML = `<div class="vg-hq-palcard"><input class="vg-hq-palinput" placeholder="Find anything, or type to add a task…" aria-label="Find or do anything"><div class="vg-hq-palrows"></div><div class="vg-hq-palfoot">↑ ↓ move · Enter run · Esc close</div></div>`;
    palette = { box, at: 0, notes: [], meaning: [], rows: [], token: 0, timer: null, back: document.activeElement }; el.appendChild(box);
    const input = box.querySelector("input"), close = () => { clearTimeout(palette.timer); box.remove(); const b = palette.back; palette = null; if (b && b.isConnected) b.focus(); };
    const runAt = i => { const r = palette.rows.filter(x => x.run)[i]; if (r) { close(); r.run(); } };
    input.oninput = () => { palette.at = 0; paletteSearch(input.value); paletteDraw(); };
    box.onkeydown = e => { e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) { e.preventDefault(); palette.at++; paletteDraw(); }
      else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) { e.preventDefault(); palette.at = Math.max(0, palette.at - 1); paletteDraw(); }
      else if (e.key === "Enter") { e.preventDefault(); runAt(palette.at); } };
    box.addEventListener("click", e => { const b = e.target.closest("[data-pal]"); if (b) runAt(+b.dataset.pal); else if (e.target === box) close(); });
    paletteDraw(); input.focus();
  }
