  // ---------------------------------------------------------------- lenses: other ways to look at the same data
  // An empty state says what's missing and offers the next step, so no panel ends with nothing to do (a test opens every
  // lens on a near-empty vault and fails on one with nothing to click). Steps: "lens:<key>", "draftmap:<cluster>", "daily",
  // "new:person", "new:context", "search". A step whose hook is missing (the page alone can't write) is left out; search
  // is always there.
  function emptyNext(text, ...steps) {
    const btn = s => { const [k, arg] = s.split(":");
      if (k === "lens") return LENSES[arg] ? `<button class="vg-btn vg-btn-sm" data-relens="${arg}">${esc(LENSES[arg].name)}</button>` : "";
      if (k === "draftmap") return opts.writeNote && clusterById[arg] ? `<button class="vg-btn vg-btn-sm" data-draftmap="${arg}">${icon("plus", 12)} Draft a map for ${esc(shortName(+arg))}</button>` : "";
      if (k === "daily") return opts.openDaily ? `<button class="vg-btn vg-btn-sm" data-next="daily">${icon("open", 12)} Today's daily note</button>` : "";
      if (k === "new") return opts.writeNote && NEW_KINDS[arg] ? `<button class="vg-btn vg-btn-sm" data-next="${s}">${icon("plus", 12)} ${NEW_KINDS[arg].label}</button>` : "";
      return `<button class="vg-btn vg-btn-sm" data-next="${k === "search" ? esc(s) : "search"}">${icon("search", 12)} Search notes</button>`; };   // "search:<words>" opens on them
    const bs = steps.map(btn).filter(Boolean);
    if (!bs.length) bs.push(btn("search"));
    return `<div class="vg-empty">${text}</div><div class="vg-ins-actions vg-empty-next">${bs.join("")}</div>`;
  }
  // the buttons emptyNext draws (a lens, a new note, search), working wherever it was drawn
  function wireNext(el) {
    el.querySelectorAll("[data-relens]").forEach(d => d.onclick = e => { e.stopPropagation(); openLens(d.dataset.relens); });
    el.querySelectorAll("[data-next]").forEach(d => d.onclick = e => { e.stopPropagation(); runNext(d.dataset.next); });
  }
  // the notes an empty state can start: where each goes, its tag (from the registry) and its name's suffix
  const NEW_KINDS = {
    note: { label: "New note", ask: "Name", folder: () => FOLDERS.inbox, suffix: "", tag: "", extra: "" },
    person: { label: "New person", ask: "Name", folder: () => FOLDERS.people, suffix: "", tag: "meta/people", extra: "type: person\n" },
    context: { label: "New project context", ask: "Project name", folder: () => FOLDERS.inbox, suffix: " - Context", tag: "meta/context", extra: "" },
  };
  async function runNext(step) {
    if (step.startsWith("search")) { closeLens(); closeMenu(); openPalette(step.includes(":") ? { query: step.slice(7) } : undefined); return; }
    if (step === "daily") { opts.openDaily(); return; }
    const K = NEW_KINDS[step.split(":")[1]]; if (!K) return;
    const name = await confirmBox(K.label, `A note in ${esc(K.folder())}.`, "Create", K.ask);
    if (name) createNote(K, name);
  }
  async function createNote(K, name) {
    const title = safeName(name.split("\n")[0].trim()) + K.suffix, path = `${K.folder()}/${title}.md`;
    const md = `---\ncreated: ${today()}\n${K.tag ? `tags:\n  - ${K.tag}\n` : ""}${K.extra}---\n# ${title}\n\n`;
    try { await opts.writeNote(path, md, { mode: "create", open: true }); toast(`Created ${title}`, "ok"); }
    catch (e) { toast(e.message, "warn"); }
  }
  const LENSES = {
    matrix: { name: "Topic matrix", hint: "Every pair of topics: links vs. co-mentions — red cells are gaps", render: lensMatrix },
    timeline: { name: "Timeline", hint: `What your dailies talked about, week by week (${(DATA.timeline || { weeks: [] }).weeks.length} weeks)`, render: lensTimeline },
    folders: { name: "Folders vs topics", hint: "Where folder structure disagrees with what notes are about", render: lensFolders },
    projects: { name: "Project board", hint: "Context notes as cards: activity, tasks, staleness", render: lensProjects },
    people: { name: "People", hint: "Who you work with on which topics", render: lensPeople },
    river: { name: "Topic river", hint: "Your dailies' topics as a stream over time, and each month's top topics", render: lensRiver },
    maptree: { name: "Map tree", hint: "Each map's topics: what it lists, what it's missing — add in place", render: lensMapTree },
    ring: { name: "Folder ring", hint: "Links between folders — thin chords are knowledge that doesn't connect", render: lensRing },
    stale: { name: "Important but stale", hint: "Notes your work leans on that haven't been edited in a while", render: lensStale },
    write: { name: "Write these next", hint: "Links to notes that don't exist yet, and short notes many others rely on", render: lensWrite },
    follow: { name: "Standup follow-through", hint: "What you planned for tomorrow vs. what the next standups say got done", render: lensFollow },
    dupes: { name: "Duplicates", hint: "Likely duplicate notes side by side, with the links each one has", render: lensDupes },
    ...((DATA.code && (DATA.code.repos || []).length) ? { code: { name: "Code ↔ docs", hint: "Code that changes often with no note, and notes that have fallen behind their code", render: lensCode } } : {}),   // only where work repos exist
    path: { name: "Reading path", hint: "An ordered reading list for getting up to speed on a topic", render: lensPath },
    triage: { name: "Stale triage", hint: "Old notes sorted by what to do: relied on, holding tasks, unconnected, the rest", render: lensTriage },
    blind: { name: "Blind spots", hint: "What you name but never link, topics gone quiet, islands and dead ends", render: lensBlind },
    adjacent: { name: "Adjacent possible", hint: "Notes one step past what you're working on, and strange pairs to combine", render: lensAdjacent },
    ...(opts.mocReport ? { mocalign: { name: "MOC alignment", hint: "Tick the report's rows here; apply when ready", render: () => "", load: lensMocAlign } } : {}),
  };
  let lensKey = null;
  $(".vg-lens-close").onclick = () => closeLens();
  function openLens(k) {
    lensKey = k; closeDrawer(); const box = $(".vg-lens"), l = LENSES[k];
    box.hidden = false; box.dataset.lens = k; root.classList.add("has-lens");
    $(".vg-lens-title").textContent = l.name; $(".vg-lens-sub").textContent = l.hint;
    const body = $(".vg-lens-body"), none = !nodes.some(n => !special(n) && !n.ghost);
    body.innerHTML = none ? emptyNext("No notes in the graph yet.", "new:note") : l.render(); body.scrollTop = 0;
    body.querySelectorAll("[data-id]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); reveal(d.dataset.id); });
    body.querySelectorAll("[data-cl]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); focusClusters(d.dataset.cl.split(",").map(Number)); });
    wireLens(body);
    if (l.load && !none) { body.innerHTML = `<div class="vg-empty">Loading…</div>`; l.load().then(html => { if (lensKey === k) { body.innerHTML = html; wireLens(body); } }); }
  }
  function wireLens(body) {
    // every note row in a lens gets the shared actions behind "⋯", whatever buttons the lens adds itself
    body.querySelectorAll(".vg-sugg, .vg-st-row, .vg-pb-card").forEach(row => {
      const item = row.querySelector("[data-id]"); if (!item || row.querySelector("[data-more]")) return;
      const btn = moreBtn(item.dataset.id); if (!btn) return;
      let acts = row.querySelector(".vg-sugg-acts, .vg-st-acts, .vg-pb-acts");
      if (!acts) { acts = document.createElement("span"); acts.className = "vg-sugg-acts"; row.appendChild(acts); }
      acts.insertAdjacentHTML("beforeend", btn);
    });
    wireFixes(body); wireMore(body);
    wireLensExtras(body);
    wireNext(body);
    body.querySelectorAll("[data-id]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); reveal(d.dataset.id); });
    body.querySelectorAll("[data-cl]").forEach(d => d.onclick = () => { if (!lensBeside()) closeLens(); focusClusters(d.dataset.cl.split(",").map(Number)); });
    body.querySelectorAll("[data-bridge]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [a, b] = d.dataset.bridge.split(",").map(Number);
      if (await confirmBox("Draft a bridge note", `Create a draft in ${FOLDERS.inbox} connecting <b>${esc(clusterName(a))}</b> and <b>${esc(clusterName(b))}</b>?`, "Create")) writeBridge(a, b); });
    body.querySelectorAll("[data-cell]").forEach(d => d.onclick = () => { body.querySelectorAll(".vg-mx-cell.is-on").forEach(x => x.classList.remove("is-on")); d.classList.add("is-on"); showCell(body, ...d.dataset.cell.split(",").map(Number)); });
    body.querySelectorAll("[data-move]").forEach(d => d.onclick = async e => {
      e.stopPropagation(); const id = d.dataset.move, to = d.dataset.to;
      if (!await confirmBox("Move note", `<div class="vg-move-prev"><span>${esc(id)}</span><b>→ ${esc(to)}/${esc(id.split("/").pop())}</b></div>Links to it are updated automatically. Nothing is deleted.`, "Move")) return;
      try { await opts.moveNote(id, to); d.disabled = true; d.textContent = "Moved"; logDiscovery(`Moved ${byId[id].name} to ${to}`); toast("Moved", "ok"); } catch (err) { toast("Couldn't move it", "warn"); }
    });
    body.querySelectorAll("[data-log]").forEach(d => d.onclick = async e => {
      e.stopPropagation(); const id = d.dataset.log;
      const text = await confirmBox(`Log an update · ${byId[id].name}`, `Appended under <b>Recent Changes (as of ${today()})</b>, as your context notes already do.`, "Append", "What changed?");
      if (!text) return;
      try { await opts.appendSection(id, `## Recent Changes (as of ${today()})`, text.split(/\n+/).map(x => `- ${x.replace(/^[-*]\s*/, "")}`)); logDiscovery(`Logged an update on ${byId[id].name}`); toast("Update logged", "ok"); }
      catch (err) { toast("Couldn't append", "warn"); }
    });
    body.querySelectorAll("[data-open]").forEach(d => d.onclick = e => { e.stopPropagation(); if (opts.openNote) opts.openNote(d.dataset.open, e.ctrlKey || e.metaKey); });
    body.querySelectorAll("[data-tasks]").forEach(d => d.onclick = e => { e.stopPropagation(); toggleTasks(d.dataset.tasks, d.closest(".vg-pb-card").querySelector(".vg-pb-tasks")); });
    body.querySelectorAll("[data-tasks]").forEach(d => { if (openTasks.has(d.dataset.tasks)) renderTasks(d.dataset.tasks, d.closest(".vg-pb-card").querySelector(".vg-pb-tasks")); });
    body.querySelectorAll("[data-pin]").forEach(d => d.onclick = e => { e.stopPropagation(); pinReview(d.dataset.pin); d.disabled = true; d.textContent = "In review"; });
    body.querySelectorAll("[data-mocrow]").forEach(cb => cb.onchange = async () => {
      try { await opts.mocReport.tick(+cb.dataset.mocrow, cb.checked); } catch (err) { cb.checked = !cb.checked; toast("Couldn't update the report", "warn"); }
    });
    const ap = body.querySelector("[data-mocapply]");
    if (ap) ap.onclick = async () => {
      if (!await confirmBox("Apply ticked rows", "Runs <code>moc_align.py --apply</code> on the report. Only ticked rows are applied; originals are snapshotted to .trash first.", "Apply")) return;
      ap.disabled = true;
      try { await opts.mocReport.apply(); logDiscovery("Applied the ticked MOC alignment rows"); toast("Applied", "ok"); }
      catch (err) { ap.disabled = false; }
    };
  }
  function showCell(body, a, b) {
    const box = body.querySelector(".vg-mx-detail"); if (!box) return;
    const sugg = links.filter(l => (l.kind === "gap" || l.kind === "similar") && ((l.s.cluster === a && l.t.cluster === b) || (l.s.cluster === b && l.t.cluster === a)));
    const pr = (DATA.pairs || []).find(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a)) || [a, b, 0, 0];
    box.innerHTML = `<div class="vg-card"><div class="vg-card-h"><span>${esc(clusterName(a))} ↔ ${esc(clusterName(b))}</span><span class="vg-muted vg-card-hint">${plural(pr[2], "link")} · ${pr[3]} co-mentions in your dailies</span></div>
      <div class="vg-ins-actions vg-wrap"><button class="vg-btn" data-cl="${a},${b}">${icon("target", 14)} Show both topics</button>
      ${opts.writeNote ? `<button class="vg-btn" data-bridge="${a},${b}">${icon("bridge", 14)} Draft bridge</button>` : ""}</div>
      ${sugg.length ? `<div class="vg-list-h">Suggested links</div>` + sugg.map(l => `<div class="vg-sugg"><button class="vg-item" data-id="${esc(l.s.id)}"><span class="vg-item-main"><span>${esc(l.s.name)} ↔ ${esc(l.t.name)}</span><span class="vg-item-sub">${esc(l.why)}</span></span></button>
        ${opts.linkNotes ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-mxlink="${esc(l.s.id)}|${esc(l.t.id)}">${icon("link", 12)} Link</button></span>` : ""}</div>`).join("") : `<div class="vg-empty">No specific note pairs suggested yet — a bridge note is the way in.</div>`}</div>`;
    wireLens(box);
    box.querySelectorAll("[data-mxlink]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [x, y] = d.dataset.mxlink.split("|");
      if (await confirmBox("Link these notes", `Link <b>${esc(byId[x].name)}</b> → <b>${esc(byId[y].name)}</b>?`, "Link")) { await actOnSuggestion("link", x, y, d); showCell(body, a, b); } });
    box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }
  // open tasks of a note: complete (tick) or cancel each in place, or close the whole note. Writes go through the
  // plugin's task actions (setTaskStatus / setNoteTasks), which every view and the sidebar share.
  async function renderTasks(id, box) {
    if (!opts.readTasks) return;
    box.innerHTML = `<div class="vg-empty">Loading tasks…</div>`;
    const tasks = await opts.readTasks(id), dated = byId[id].taskItems || [];
    const ageOf = t => { const m = dated.find(d => t.trim().startsWith(d[0].slice(0, 40))); return m && m[1] ? Math.round((Date.now() - Date.parse(m[1] + "T12:00")) / 864e5) : null; };
    const all = tasks.length ? `<div class="vg-task-all"></div>` : "";
    box.innerHTML = all + (tasks.length ? tasks.slice(0, 30).map(tk => `<div class="vg-task"><label><input type="checkbox" data-line="${tk.line}" title="Complete"><span>${esc(tk.text.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1"))}${ageOf(tk.text) != null ? ` <span class="vg-muted">· ${ageOf(tk.text)}d</span>` : ""}</span></label>` +
      (opts.setTaskStatus ? `<button class="vg-ibtn vg-task-cancel" data-cancel="${tk.line}" title="Cancel this task" aria-label="Cancel task">${icon("close", 12)}</button>` : "") + `</div>`).join("") +
      (tasks.length > 30 ? `<div class="vg-empty">…and ${tasks.length - 30} more in the note</div>` : "") : `<div class="vg-empty">No open tasks.</div>`);
    const settle = (row, how, tk) => { row.classList.add(how === "-" ? "is-cancelled" : "is-done"); row.querySelectorAll("input,button").forEach(x => x.disabled = true);
      byId[id].tasks = Math.max(0, byId[id].tasks - 1); logDiscovery(`${how === "-" ? "Cancelled" : "Checked off"} “${tk.text.slice(0, 60)}” in ${byId[id].name}`); dirty = true; kick(); };
    const set = async (tk, how, row) => { row.querySelectorAll("input,button").forEach(x => x.disabled = true);
      try { await (opts.setTaskStatus ? opts.setTaskStatus(id, tk.line, tk.text, how) : opts.toggleTask(id, tk.line, tk.text)); settle(row, how, tk); }
      catch (err) { const cb = row.querySelector("input"); if (cb) cb.checked = false; row.querySelectorAll("input,button").forEach(x => x.disabled = false); } };
    box.querySelectorAll("input[data-line]").forEach(cb => cb.onchange = () => set(tasks.find(x => x.line === +cb.dataset.line), "x", cb.closest(".vg-task")));
    box.querySelectorAll("[data-cancel]").forEach(b => b.onclick = () => set(tasks.find(x => x.line === +b.dataset.cancel), "-", b.closest(".vg-task")));
    // close them all: the shared Complete / Cancel actions, the same as in the inspector and the sidebar
    const allBox = box.querySelector(".vg-task-all");
    if (allBox) { const c = actionCtx(); VGActions.render(allBox, VGActions.forNote({ ...byId[id], tasks: tasks.length }, c, ["complete", "cancel"]), { ...byId[id], tasks: tasks.length }, c, { btn: "vg-btn vg-btn-sm" }); }
  }
  // Task lists stay open across redraws: an action publishes new state, the panel redraws, and the lists that were
  // open come back open. Every panel that shows a note's tasks toggles them through here.
  const openTasks = new Set();
  function toggleTasks(id, box) {
    if (box.childElementCount) { box.innerHTML = ""; openTasks.delete(id); return; }
    openTasks.add(id); return renderTasks(id, box);
  }
  // Re-render the open lens in place (after an action, or fresh vault data) without jumping back to the top
  function refreshLens() { if (!lensKey || !LENSES[lensKey]) return; const b = $(".vg-lens-body"), y = b.scrollTop; openLens(lensKey); b.scrollTop = y; }
  function closeLens() { lensKey = null; $(".vg-lens").hidden = true; root.classList.remove("has-lens"); root.focus({ preventScroll: true }); }
  const shortName = c => clusterById[c] ? clusterById[c].name.split(" · ").slice(0, 2).join(" · ") : "—";
  const cellBg = (col, a) => `background:color-mix(in srgb, ${col} ${Math.round(a * 100)}%, transparent)`;

  function lensMatrix() {
    const cs = DATA.clusters.filter(c => c.size >= 5).sort((a, b) => b.size - a.size), pair = {};
    (DATA.pairs || []).forEach(([a, b, l, m]) => { pair[a + "|" + b] = pair[b + "|" + a] = [l, m]; });
    const maxM = Math.max(1, ...(DATA.pairs || []).map(x => x[3])), maxL = Math.max(1, ...(DATA.pairs || []).map(x => x[2]));
    const head = `<tr><th></th>${cs.map(c => `<th class="vg-mx-col" title="${esc(clusterName(c.id))}"><span style="color:${colorOf(c.id)}">C${c.id}</span></th>`).join("")}</tr>`;
    const rows = cs.map(a => `<tr><th class="vg-mx-row"><button class="vg-mx-name" data-cl="${a.id}"><span class="vg-dot" style="background:${colorOf(a.id)}"></span>${esc(shortName(a.id))}</button></th>` +
      cs.map(b => {
        if (a.id === b.id) return `<td class="vg-mx-self" title="${a.size} notes">${a.size}</td>`;
        const [l, m] = pair[a.id + "|" + b.id] || [0, 0];
        const gap = m / maxM * (1 / (1 + l * 0.6));   // talked about together, barely linked
        const style = gap > 0.08 ? cellBg("var(--vg-gap)", Math.min(0.85, 0.15 + gap * 1.6)) : l ? cellBg("var(--vg-ok)", Math.min(0.6, 0.1 + Math.log1p(l) / Math.log1p(maxL) * 0.5)) : "";
        return `<td><button class="vg-mx-cell" style="${style}" data-cell="${a.id},${b.id}" title="${esc(clusterName(a.id))} ↔ ${esc(clusterName(b.id))}: ${plural(l, "link")}, ${m} co-mentions">${l || m ? `${l}<small>/${m}</small>` : ""}</button></td>`;
      }).join("") + `</tr>`).join("");
    const worst = (DATA.pairs || []).filter(([a, b]) => clusterById[a] && clusterById[b]).map(([a, b, l, m]) => ({ a, b, l, m, s: m / (1 + l * 0.6) }))
      .sort((x, y) => y.s - x.s).slice(0, 6);
    return `<div class="vg-mx-wrap"><table class="vg-mx">${head}${rows}</table></div><div class="vg-mx-detail"></div>
      <p class="vg-muted vg-lens-note">Cell = <b>links</b>/<small>co-mentions</small>. Green: well linked. Red: discussed together in your dailies but barely linked. Click a cell for what to do about it.</p>
      <div class="vg-list-h">Biggest gaps</div>${worst.map(g => `<div class="vg-gaprow"><button class="vg-item" data-cl="${g.a},${g.b}"><span class="vg-dots"><span class="vg-dot" style="background:${colorOf(g.a)}"></span><span class="vg-dot" style="background:${colorOf(g.b)}"></span></span>
        <span class="vg-item-main"><span>${esc(clusterName(g.a))} ↔ ${esc(clusterName(g.b))}</span><span class="vg-item-sub">${g.m} co-mentions · ${plural(g.l, "link")}</span></span></button>
        ${opts.writeNote ? `<button class="vg-ibtn" data-bridge="${g.a},${g.b}" title="Draft a bridge note">${icon("bridge", 15)}</button>` : ""}</div>`).join("")}`;
  }

  function lensTimeline() {
    const T = DATA.timeline; if (!T || !T.weeks.length) return emptyNext("No daily notes link or name your notes yet.", "daily");
    const W = T.weeks.length, trend = v => { const a = v.slice(-4).reduce((s, x) => s + x, 0) / 4, b = v.slice(-12, -4).reduce((s, x) => s + x, 0) / 8; return a - b; };
    const strip = (v, col) => { const mx = Math.max(1, ...v); return `<span class="vg-tl-strip">${v.map((x, i) => `<i style="${x ? cellBg(col, 0.15 + 0.85 * x / mx) : ""}" title="week of ${T.weeks[i]}: ${x}"></i>`).join("")}</span>`; };
    const tag = v => { const d = trend(v), base = v.slice(-12, -4).reduce((s, x) => s + x, 0) / 8; return d > Math.max(0.4, base * 0.6) ? `<span class="vg-tl-tag is-up">↑ heating</span>` : d < -Math.max(0.4, base * 0.6) ? `<span class="vg-tl-tag is-down">↓ cooling</span>` : ""; };
    const months = T.weeks.map((w, i) => i % 4 === 0 ? `<span style="grid-column:${i + 1}">${new Date(w + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>` : "").join("");
    const total = T.weeks.map((_, i) => Object.values(T.clusters).reduce((s, v) => s + v[i], 0));
    const cl = Object.entries(T.clusters).filter(([c]) => clusterById[c]).sort((a, b) => b[1].reduce((s, x) => s + x, 0) - a[1].reduce((s, x) => s + x, 0));
    const nt = Object.entries(T.notes).filter(([id]) => byId[id]).sort((a, b) => trend(b[1]) - trend(a[1]));
    return `<div class="vg-tl"><div class="vg-tl-row vg-tl-axis"><span></span><span class="vg-tl-months" style="grid-template-columns:repeat(${W},1fr)">${months}</span></div>
      <div class="vg-tl-row"><span class="vg-tl-label"><b>All topics</b></span>${strip(total, "var(--vg-accent)")}</div>
      <div class="vg-list-h">Topics</div>${cl.map(([c, v]) => `<div class="vg-tl-row"><button class="vg-tl-label" data-cl="${c}"><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(shortName(+c))} ${tag(v)}</button>${strip(v, colorOf(+c))}</div>`).join("")}
      <div class="vg-list-h">Notes, heating up first</div>${nt.map(([id, v]) => `<div class="vg-tl-row"><button class="vg-tl-label" data-id="${esc(id)}"><span class="vg-dot" style="background:${colorOf(byId[id].cluster)}"></span>${esc(byId[id].name)} ${tag(v)}</button>${strip(v, colorOf(byId[id].cluster))}${trend(v) < -0.2 ? `<button class="vg-btn vg-btn-sm vg-tl-pin" data-pin="${esc(id)}" title="Add to today's review">Review now</button>` : ""}</div>`).join("")}</div>
      <p class="vg-muted vg-lens-note">Counts daily notes (journals and standups) that link or name each note. "Heating" compares the last 4 weeks with the 8 before.</p>`;
  }

  function lensFolders() {
    const top = id => id.split("/").slice(0, 2).join("/"), groups = {};
    nodes.filter(n => !special(n) && n.cluster >= 0 && n.id.includes("/")).forEach(n => (groups[top(n.id)] = groups[top(n.id)] || []).push(n));
    const folders = Object.entries(groups).filter(([, ms]) => ms.length >= 4).sort((a, b) => b[1].length - a[1].length);
    const home = {};   // each cluster's home folder: where most of it lives
    nodes.filter(n => !special(n) && n.cluster >= 0).forEach(n => { const f = top(n.id); (home[n.cluster] = home[n.cluster] || {})[f] = (home[n.cluster][f] || 0) + 1; });
    const homeOf = c => Object.entries(home[c] || {}).sort((a, b) => b[1] - a[1])[0];
    const odd = [];
    const bars = folders.map(([f, ms]) => {
      const per = {}; ms.forEach(n => per[n.cluster] = (per[n.cluster] || 0) + 1);
      const segs = Object.entries(per).sort((a, b) => b[1] - a[1]);
      ms.forEach(n => { const h = homeOf(n.cluster); if (h && h[0] !== f && h[1] >= 0.5 * clusterById[n.cluster].size && per[n.cluster] <= 2) odd.push([n, h[0]]); });
      return `<div class="vg-fd-row"><span class="vg-fd-name" title="${esc(f)}">${esc(f)}</span><span class="vg-fd-bar" data-chart>${segs.map(([c, k]) =>
        `<button style="flex:${k};background:${colorOf(+c)}" data-cl="${c}" title="${esc(clusterName(+c))}: ${k}"></button>`).join("")}</span><span class="vg-count">${ms.length}</span></div>`;
    }).join("");
    return `<p class="vg-muted vg-lens-note">Each bar is a folder, split by topic. One colour = the folder matches a topic; many colours = the folder mixes topics.</p>${bars}
      <div class="vg-list-h">Possibly misfiled <span class="vg-count">${odd.length}</span></div>
      ${odd.sort((a, b) => b[0].bc - a[0].bc).slice(0, 40).map(([n, h]) => `<div class="vg-sugg">${noteRow(n.id, `in ${esc(top(n.id))} · its topic lives in <b>${esc(h)}</b>`)}
        ${opts.moveNote && !VGRules.RULES.not_map_tops.includes(h.split("/")[0]) ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-move="${esc(n.id)}" data-to="${esc(h)}">Move to ${esc(h.split("/").pop())}</button></span>` : ""}</div>`).join("") || emptyNext("Nothing looks misfiled.", "lens:triage")}`;
  }

  function lensProjects() {
    const ctx = nodes.filter(n => !special(n) && VGRules.isContextNote(n.name)).sort((a, b) => b.recent - a.recent || b.mentions - a.mentions);
    if (!ctx.length) return emptyNext(`No "… - Context" notes yet.`, "new:context");
    const state = n => n.recent > 0 ? ["Active", "is-ok"] : staleFor(n, Q.stale_days) ? ["Stale", "is-warn"] : ["Quiet", ""];
    return `<div class="vg-pb">${ctx.map(n => { const [s, cls] = state(n), m = inMoc(n.id);
      return `<div class="vg-pb-card" style="--c:${colorOf(n.cluster)}"><button class="vg-pb-main" data-id="${esc(n.id)}"><span class="vg-pb-top"><span class="vg-pb-state ${cls}">${s}</span><span class="vg-muted">${n.age}d since edit</span></span>
        <b class="vg-pb-name">${esc(VGRules.contextTopic(n.name))}</b><span class="vg-item-sub">${esc(clusterName(n.cluster))}</span>
        <span class="vg-pb-stats"><span><b>${n.recent}</b> last ${DATA.recent_days}d</span><span><b>${n.mentions}</b> mentions</span><span><b>${n.tasks}</b> open tasks</span><span><b>${nb[n.id].size}</b> links</span></span>
        ${m === false ? `<span class="vg-pb-flag">not in its map</span>` : ""}</button>
        <span class="vg-pb-acts">${opts.openNote ? `<button class="vg-btn vg-btn-sm" data-open="${esc(n.id)}">${icon("open", 12)} Open</button>` : ""}
          ${opts.appendSection ? `<button class="vg-btn vg-btn-sm" data-log="${esc(n.id)}">${icon("plus", 12)} Log update</button>` : ""}
          ${opts.readTasks && n.tasks ? `<button class="vg-btn vg-btn-sm" data-tasks="${esc(n.id)}">Tasks ${n.tasks}</button>` : ""}</span>
        <div class="vg-pb-tasks"></div></div>`; }).join("")}</div>`;
  }

  async function lensMocAlign() {
    const rep = await opts.mocReport.load();
    if (!rep) return emptyNext("No MOC Alignment report yet.", "lens:triage");
    const groups = {}; rep.rows.forEach(r => (groups[r.section] = groups[r.section] || []).push(r));
    const ticked = rep.rows.filter(r => /[xX]/.test(r.state)).length;
    return `<p class="vg-muted vg-lens-note">${esc(rep.path)} · ${rep.rows.length} rows · <b>${ticked}</b> ticked. Ticking here edits the report; nothing else changes until you apply.</p>
      ${opts.mocReport.apply ? `<div class="vg-ins-actions"><button class="vg-btn vg-btn-primary" data-mocapply>${icon("sparkles", 14)} Apply ticked rows</button></div>` : `<p class="vg-muted vg-lens-note">Applying runs on desktop.</p>`}
      ${Object.entries(groups).map(([sec, rows]) => `<div class="vg-list-h">${esc(sec)}</div>` + rows.map(r => `<label class="vg-task vg-mocrow ${r.state === "-" ? "is-done" : ""}">
        <input type="checkbox" data-mocrow="${r.line}" ${/[xX]/.test(r.state) ? "checked" : ""} ${r.state === "-" ? "disabled" : ""}><span>${esc(r.label.replace(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g, "$1").replace(/[`*]/g, ""))}</span></label>`).join("")).join("")}`;
  }

  function lensPeople() {
    const ppl = nodes.filter(n => n.person); if (!ppl.length) return emptyNext("No people notes linked to topics.", "new:person");
    const per = {}; links.filter(l => l.kind === "person").forEach(l => { const c = l.t.cluster; if (c < 0) return; (per[l.s.id] = per[l.s.id] || {})[c] = (per[l.s.id][c] || 0) + 1; });
    const cs = DATA.clusters.filter(c => ppl.some(p => (per[p.id] || {})[c.id])).sort((a, b) => b.size - a.size).slice(0, 12);
    const mx = Math.max(1, ...Object.values(per).flatMap(o => Object.values(o)));
    return `<div class="vg-mx-wrap"><table class="vg-mx"><tr><th></th>${cs.map(c => `<th class="vg-mx-col" title="${esc(clusterName(c.id))}"><span style="color:${colorOf(c.id)}">C${c.id}</span></th>`).join("")}</tr>
      ${ppl.filter(p => per[p.id]).sort((a, b) => b.outlinks - a.outlinks).map(p => `<tr><th class="vg-mx-row"><button class="vg-mx-name" data-id="${esc(p.id)}"><i class="vg-lg-diamond"></i>${esc(p.name)}</button></th>${cs.map(c => {
        const k = (per[p.id] || {})[c.id] || 0;
        return `<td><button class="vg-mx-cell" style="${k ? cellBg("var(--vg-person)", 0.15 + 0.8 * k / mx) : ""}" data-cl="${c.id}" title="${esc(p.name)} · ${esc(clusterName(c.id))}: ${k}">${k || ""}</button></td>`; }).join("")}</tr>`).join("")}</table></div>
      <p class="vg-muted vg-lens-note">Notes linking each person, by topic (from people notes and the notes that link them). Click a name to see them in the graph; columns: ${cs.map(c => `C${c.id} ${esc(shortName(c.id))}`).join(" · ")}.</p>`;
  }

  // Topic river: what your dailies talked about over time, as a stream (one band per topic, thickness =
  // daily notes naming it that week), plus each month's top topics for quarterly write-ups.
  let riverSkipTop = false;
  function lensRiver() {
    const T = DATA.timeline; if (!T || T.weeks.length < 3) return emptyNext("Fewer than 3 weeks of daily notes link or name your notes.", "daily", "lens:timeline");
    const N = T.weeks.length, sum = v => v.reduce((s, x) => s + x, 0);
    const all = Object.entries(T.clusters).filter(([c]) => clusterById[c]).sort((a, b) => sum(b[1]) - sum(a[1]));
    const biggest = all[0] && +all[0][0], shown = riverSkipTop ? all.slice(1) : all;   // a hub topic can dwarf the rest
    const TOP = 10, bands = shown.slice(0, TOP).map(([c, v]) => ({ c: +c, v }));
    if (shown.length > TOP) bands.push({ c: null, v: T.weeks.map((_, i) => shown.slice(TOP).reduce((s, [, v]) => s + v[i], 0)) });
    const soft = v => v.map((x, i) => (2 * x + (v[i - 1] ?? x) + (v[i + 1] ?? x)) / 4);   // a little smoothing so one busy day doesn't spike
    bands.forEach(b => { b.s = soft(b.v).map(Math.sqrt); });   // square-root thickness: quiet topics stay visible next to busy ones
    const tot = T.weeks.map((_, i) => bands.reduce((s, b) => s + b.s[i], 0)), maxT = Math.max(1e-9, ...tot);
    const VW = 1000, VH = 300, PAD = 24, x = i => PAD + (VW - 2 * PAD) * i / (N - 1), y = v => VH / 2 + (v / maxT) * (VH / 2 - 14);
    const curve = pts => pts.map(([px, py], i) => {   // Catmull-Rom through the points, as cubic Béziers
      if (!i) return `M${px.toFixed(1)},${py.toFixed(1)}`;
      const p0 = pts[i - 2] || pts[i - 1], p1 = pts[i - 1], p3 = pts[i + 1] || [px, py];
      return `C${(p1[0] + (px - p0[0]) / 6).toFixed(1)},${(p1[1] + (py - p0[1]) / 6).toFixed(1)} ${(px - (p3[0] - p1[0]) / 6).toFixed(1)},${(py - (p3[1] - p1[1]) / 6).toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`;
    }).join("");
    const base = tot.map(t => -t / 2);   // centred stream: the river widens when you're busy
    let paths = "", labels = "";
    bands.forEach(b => {
      const lo = base.map((v, i) => [x(i), y(v)]), hi = base.map((v, i) => [x(i), y(v + b.s[i])]);
      base.forEach((v, i) => { base[i] = v + b.s[i]; });
      const col = b.c == null ? "var(--vg-muted)" : colorOf(b.c), name = b.c == null ? "Other topics" : clusterName(b.c);
      paths += `<path class="vg-rv-band" ${b.c == null ? "" : `data-cl="${b.c}"`} d="${curve(hi)}L${lo.slice().reverse().map(p => p.map(n => n.toFixed(1)).join(",")).join("L")}Z" fill="${col}"><title>${esc(name)} · ${sum(b.v)} daily notes over ${N} weeks</title></path>`;
      const pk = b.s.indexOf(Math.max(...b.s)), th = hi[pk][1] - lo[pk][1];
      if (b.c != null && Math.abs(th) > 15) labels += `<text x="${Math.min(VW - 80, Math.max(80, x(pk)))}" y="${((hi[pk][1] + lo[pk][1]) / 2 + 4).toFixed(1)}" text-anchor="middle">${esc(shortName(b.c))}</text>`;
    });
    const ticks = T.weeks.map((w, i) => i % 4 === 0 ? `<text class="vg-rv-tick" x="${x(i).toFixed(1)}" y="${VH - 2}" text-anchor="middle">${esc(new Date(w + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</text>` : "").join("");
    const months = {};   // month -> topic -> daily notes
    T.weeks.forEach((w, i) => { const m = w.slice(0, 7); all.forEach(([c, v]) => { if (v[i]) (months[m] = months[m] || {})[c] = (months[m][c] || 0) + v[i]; }); });
    const rows = Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, per]) => {
      const top3 = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 3);
      return `<div class="vg-rv-month"><b>${esc(new Date(m + "-15T12:00").toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</b>${top3.map(([c, k]) =>
        `<button class="vg-rv-chip" data-cl="${c}"><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(clusterName(+c))} <span class="vg-muted">${k}</span></button>`).join("")}</div>`;
    }).join("");
    return `${biggest != null && all.length > 2 ? `<label class="vg-rv-opt"><input type="checkbox" data-rvskip ${riverSkipTop ? "checked" : ""}> Leave out the biggest topic (${esc(clusterName(biggest))})</label>` : ""}
      <svg class="vg-rv" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Topic river">${paths}<g class="vg-rv-labels">${labels}</g>${ticks}</svg>
      <p class="vg-muted vg-lens-note">Band thickness = daily notes (journals and standups) linking or naming that topic each week, on a square-root scale so quieter topics stay visible. Hover a band for its total; click it to focus the topic. Top ${TOP} topics; the rest are grey.</p>
      <div class="vg-list-h">Top topics by month</div>${rows}`;
  }

  // Map tree: every map (MOC) with its topics, what it lists and what it's missing, fixable in place
  function lensMapTree() {
    if (!mocs.length) return emptyNext("No maps (MOCs) yet.", "draftmap:" + (DATA.clusters.slice().sort((a, b) => b.size - a.size)[0] || {}).id, "lens:blind");
    const row = (id, extra, add) => byId[id] ? `<div class="vg-sugg">${noteRow(id, extra)}${add && canAddToMap() ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-addmap="${esc(add)}|${esc(id)}">${icon("plus", 12)} Add</button></span>` : ""}</div>` : "";
    const cards = mocs.map(m => {
      const miss = m.clusters.flatMap(c => (m.missing[c] || []).filter(id => byId[id]));
      const inTopics = m.members.filter(id => byId[id] && m.clusters.includes(byId[id].cluster)), other = m.members.filter(id => byId[id] && !m.clusters.includes(byId[id].cluster));
      const cover = inTopics.length + miss.length ? Math.round(100 * inTopics.length / (inTopics.length + miss.length)) : 100;
      const topics = m.clusters.map(c => {
        const listed = inTopics.filter(id => byId[id].cluster === c), ms = (m.missing[c] || []).filter(id => byId[id]);
        return `<details class="vg-mt-topic"><summary><span class="vg-dot" style="background:${colorOf(c)}"></span>${esc(clusterName(c))}
            <span class="vg-muted">${listed.length} listed · ${ms.length ? `<b class="vg-mt-miss">${ms.length} missing</b>` : "complete"}</span></summary>
          ${ms.length ? `<div class="vg-list-h">Missing</div>${ms.sort((a, b) => byId[b].bc - byId[a].bc).map(id => row(id, `${byId[id].recent ? `${byId[id].recent} recent · ` : ""}${byId[id].age}d since edit`, m.id)).join("")}` : ""}
          ${listed.length ? `<div class="vg-list-h">Listed</div>${listed.map(id => row(id, "")).join("")}` : ""}</details>`;
      }).join("");
      return `<div class="vg-mt"><div class="vg-mt-head"><button class="vg-item" data-id="${esc(m.id)}"><i class="vg-lg-hex"></i><span class="vg-item-main"><span>${esc(m.title)}</span>
          <span class="vg-item-sub">${plural(m.clusters.length, "topic")} · ${plural(m.members.length, "link")}${other.length ? ` · ${other.length} outside its topics` : ""}</span></span></button>
          <span class="vg-mt-cover" title="${cover}% of its topics' notes are listed"><i style="width:${cover}%;background:${cover >= 80 ? "var(--vg-ok)" : cover >= 50 ? "var(--vg-warn)" : "var(--vg-gap)"}"></i></span><span class="vg-count">${cover}%</span>
          ${miss.length && canAddToMap() ? `<button class="vg-btn vg-btn-sm" data-addall="${esc(m.id)}">Add all ${miss.length}</button>` : ""}</div>${topics}</div>`;
    });
    const order = mocs.map((m, i) => [i, m.clusters.flatMap(c => m.missing[c] || []).length]).sort((a, b) => b[1] - a[1]).map(([i]) => cards[i]);
    const unmapped = DATA.clusters.filter(c => !mocOf[c.id] && c.size >= 6).sort((a, b) => b.size - a.size);
    return `<p class="vg-muted vg-lens-note">Each map, worst coverage first. Open a topic for the notes it lists and the ones it's missing; Add appends them under "Also in this topic".</p>${order.join("")}
      ${unmapped.length ? `<div class="vg-list-h">Topics with no map <span class="vg-count">${unmapped.length}</span></div>${unmapped.map(c => `<div class="vg-sugg"><button class="vg-item" data-cl="${c.id}"><span class="vg-dot" style="background:${colorOf(c.id)}"></span><span class="vg-item-main"><span>${esc(clusterName(c.id))}</span><span class="vg-item-sub">${plural(c.size, "note")}</span></span></button>
        ${opts.writeNote ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-draftmap="${c.id}">Draft map</button></span>` : ""}</div>`).join("")}` : ""}`;
  }

  // Folder ring: top-level folders around a circle, chords sized by the links between them. Thin or missing
  // chords show folders whose knowledge doesn't reach each other.
  // two levels deep (02-Projects/Inventory System), since the top level is just a handful of big buckets;
  // hidden and system folders (.claude, _System…) are left out
  const folderOf = id => { const p = id.split("/"); return p.length === 1 ? "(vault root)" : p.length === 2 ? p[0] : p[0] + "/" + p[1]; };
  const ringFolder = f => !/^[._]/.test(f);
  function lensRing() {
    const notes = nodes.filter(n => !special(n) && !n.ghost && ringFolder(folderOf(n.id))), count = {};
    notes.forEach(n => { const f = folderOf(n.id); count[f] = (count[f] || 0) + 1; });
    const folders = Object.keys(count).filter(f => count[f] >= 3).sort((a, b) => count[b] - count[a]).slice(0, 14), idx = Object.fromEntries(folders.map((f, i) => [f, i]));
    const F = folders.length; if (F < 2) return emptyNext("Not enough folders to compare.", "lens:folders");
    const M = folders.map(() => folders.map(() => 0)), inside = folders.map(() => 0);
    links.filter(l => l.kind === "link" && !special(l.s) && !special(l.t)).forEach(l => {
      const a = idx[folderOf(l.s.id)], b = idx[folderOf(l.t.id)]; if (a == null || b == null) return;
      if (a === b) inside[a]++; else { M[a][b]++; M[b][a]++; }
    });
    const out = M.map(r => r.reduce((s, x) => s + x, 0)), weight = folders.map((_, i) => Math.max(1, out[i]));
    const leaf = f => f.split("/").pop().replace(/^\d+-/, ""), clash = {};
    folders.forEach(f => { clash[leaf(f)] = (clash[leaf(f)] || 0) + 1; });
    const ringLabel = f => clash[leaf(f)] > 1 && f.includes("/") ? `${leaf(f)} (${f.split("/")[0].replace(/^\d+-/, "")})` : leaf(f);
    const R = 150, R2 = 162, C = 200, GAP = 0.04, total = weight.reduce((s, x) => s + x, 0), span = 2 * Math.PI - GAP * F;
    const pt = (a, r) => [(C + r * Math.cos(a - Math.PI / 2)).toFixed(1), (C + r * Math.sin(a - Math.PI / 2)).toFixed(1)];
    const arcs = [], start = [];
    let a0 = 0;
    folders.forEach((f, i) => { const a1 = a0 + span * weight[i] / total; arcs.push([a0, a1]); start.push(a0); a0 = a1 + GAP; });
    const col = i => PALETTE[i % PALETTE.length];
    let svg = "";
    const slot = folders.map((_, i) => start[i]), seg = {};   // each pair gets a slice of both folders' arcs
    folders.forEach((_, i) => folders.forEach((__, j) => { if (i === j || !M[i][j]) return;
      const w = (arcs[i][1] - arcs[i][0]) * M[i][j] / Math.max(1, out[i]); seg[i + "|" + j] = [slot[i], slot[i] + w]; slot[i] += w; }));
    folders.forEach((_, i) => folders.forEach((__, j) => { if (j <= i || !M[i][j]) return;
      const [s0, s1] = seg[i + "|" + j], [t0, t1] = seg[j + "|" + i], p = (a) => pt(a, R).join(",");
      svg += `<path class="vg-rg-chord" data-fp="${i},${j}" fill="${col(i)}" d="M${p(s0)}A${R},${R} 0 0,1 ${p(s1)}Q${C},${C} ${p(t0)}A${R},${R} 0 0,1 ${p(t1)}Q${C},${C} ${p(s0)}Z"><title>${esc(folders[i])} ↔ ${esc(folders[j])}: ${plural(M[i][j], "link")}</title></path>`;
    }));
    folders.forEach((f, i) => {
      const [b0, b1] = arcs[i], large = b1 - b0 > Math.PI ? 1 : 0, mid = (b0 + b1) / 2, [lx, ly] = pt(mid, R2 + 14);
      svg += `<path class="vg-rg-arc" data-fold="${esc(f)}" fill="${col(i)}" d="M${pt(b0, R).join(",")}A${R},${R} 0 ${large},1 ${pt(b1, R).join(",")}L${pt(b1, R2).join(",")}A${R2},${R2} 0 ${large},0 ${pt(b0, R2).join(",")}Z"><title>${esc(f)}: ${plural(count[f], "note")}, ${out[i]} links out, ${inside[i]} inside</title></path>`;
      if (b1 - b0 > 0.08) svg += `<text x="${lx}" y="${ly}" text-anchor="${Math.sin(mid) > 0.2 ? "start" : Math.sin(mid) < -0.2 ? "end" : "middle"}" dominant-baseline="middle">${esc(ringLabel(f))}</text>`;
    });
    const insular = folders.map((f, i) => ({ f, i, n: count[f], ratio: out[i] / Math.max(1, out[i] + inside[i]) })).filter(x => x.n >= 6).sort((a, b) => a.ratio - b.ratio).slice(0, 6);
    return `<svg class="vg-rg" viewBox="-60 -10 520 420" role="img" aria-label="Folder ring">${svg}</svg><div class="vg-rg-detail"></div>
      <p class="vg-muted vg-lens-note">Arcs are folders (two levels deep, the ${F} biggest), sized by links to other folders; chords are those links. Click a chord for the notes behind it, or an arc to light up that folder in the graph.</p>
      <div class="vg-list-h">Most inward-looking folders</div>${insular.map(x => `<div class="vg-fd-row"><button class="vg-fd-name vg-linkish" data-fold="${esc(x.f)}">${esc(x.f)}</button>
        <span class="vg-fd-bar"><i style="flex:${Math.round(100 * x.ratio)};background:var(--vg-ok)"></i><i style="flex:${100 - Math.round(100 * x.ratio)};background:var(--vg-hover)"></i></span><span class="vg-count">${Math.round(100 * x.ratio)}% out</span></div>`).join("")}`;
  }
  const shortDate = d => d ? new Date(d + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const actBtn = (attr, id, label) => `<button class="vg-btn vg-btn-sm" ${attr}="${esc(id)}">${label}</button>`;

  // 1. Important but stale: how much the vault leans on a note vs. how long since it was edited.
  // Top-left = notes your work depends on that may have drifted out of date.
  const STALE_AFTER = Q.stale_days;   // the shared rule (vault_graph_rules.json stale_days): one meaning of stale everywhere
  function lensStale() {
    const ns = nodes.filter(n => !special(n) && !n.ghost && n.cluster >= 0);
    if (!ns.length) return `<div class="vg-empty">No notes to rate.</div>`;
    impMax = null; const imp = importance;   // the shared measure (fresh maxes: the lens can open after edits)
    const VW = 1000, VH = 320, P = 30, maxAge = Math.max(STALE_AFTER * 2, ...ns.map(n => n.age || 0));
    const x = a => P + (VW - 2 * P) * Math.log1p(a) / Math.log1p(maxAge), y = v => VH - P - (VH - 2 * P) * v;
    const cut = 0.35, hot = ns.filter(n => imp(n) >= cut && staleFor(n, STALE_AFTER)).sort((a, b) => imp(b) * Math.log1p(b.age) - imp(a) * Math.log1p(a.age));
    const dots = ns.map(n => { const v = imp(n), danger = v >= cut && staleFor(n, STALE_AFTER);
      return `<circle class="vg-st-dot ${danger ? "is-hot" : ""}" data-id="${esc(n.id)}" cx="${x(n.age || 0).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${danger ? 5 : 3.2}" fill="${colorOf(n.cluster)}"><title>${esc(n.name)} · ${n.age}d since edit · ${n.inlinks} links in · ${n.mentions} daily mentions</title></circle>`; }).join("");
    const ticks = [1, 7, 30, 90, 180, 365, 730].filter(d => d <= maxAge).map(d => `<text class="vg-rv-tick" x="${x(d).toFixed(1)}" y="${VH - 8}" text-anchor="middle">${d < 30 ? d + "d" : d < 365 ? Math.round(d / 30) + "mo" : Math.round(d / 365) + "y"}</text>`).join("");
    return `<svg class="vg-st" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Importance against staleness">
        <rect class="vg-st-zone" x="${x(STALE_AFTER)}" y="${P}" width="${VW - P - x(STALE_AFTER)}" height="${y(cut) - P}"/>
        <line class="vg-st-axis" x1="${x(STALE_AFTER)}" x2="${x(STALE_AFTER)}" y1="${P}" y2="${VH - P}"/><line class="vg-st-axis" x1="${P}" x2="${VW - P}" y1="${y(cut)}" y2="${y(cut)}"/>
        <text class="vg-rv-tick" x="${VW - P}" y="${P - 8}" text-anchor="end">relied on · stale</text><text class="vg-rv-tick" x="${P}" y="${P - 8}">relied on · fresh</text>
        ${dots}${ticks}</svg>
      <p class="vg-muted vg-lens-note">Up = relied on (links in, daily mentions, influence${DATA.has_usage ? ", opens" : ", recent mentions"}). Right = days since the last edit (log scale). The shaded corner is relied on and not edited in ${STALE_AFTER}+ days. Click a dot to find it.</p>
      <div class="vg-list-h">Relied on, not edited in ${STALE_AFTER}+ days <span class="vg-count">${hot.length}</span></div>
      ${hot.slice(0, 40).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.age}d since edit · ${n.inlinks} links in · ${n.mentions} mentions`)}<span class="vg-sugg-acts">
        ${opts.openNote ? actBtn("data-open", n.id, `${icon("open", 12)} Open`) : ""}${opts.stampReviewed ? actBtn("data-reviewed", n.id, "Still current") : ""}${opts.moveNote ? actBtn("data-archive", n.id, "Archive") : ""}</span></div>`).join("") || emptyNext("Nothing relied-on has gone stale.", "lens:triage")}`;
  }

  // 2. Write these next: links pointing at notes that don't exist, and short notes many others lean on
  function createGhost(n) {
    const md = `---\ncreated: ${today()}\n---\n# ${n.name}\n\n` +
      `> Created from Vault Graph: linked from ${n.from.filter(id => byId[id]).map(id => mdLink(id, `${FOLDERS.inbox}/${safeName(n.name)}.md`)).join(", ")}.\n\n`;
    return opts.writeNote(`${FOLDERS.inbox}/${safeName(n.name)}.md`, md, { mode: "create", open: true }).then(() => { n.created = true; toast(`Created ${n.name} in ${FOLDERS.inbox}`, "ok"); });
  }
  function lensWrite() {
    const wanted = nodes.filter(n => n.ghost && !n.created).sort((a, b) => b.from.length - a.from.length);
    const stubs = nodes.filter(n => !special(n) && !n.ghost && (n.words || 0) < Q.stub_words && (n.inlinks || 0) >= 2)
      .sort((a, b) => b.inlinks - a.inlinks || b.mentions - a.mentions);
    if (!wanted.length && !stubs.length) return emptyNext("Every link points at a real note, and no short note has several links in.", "new:note", "lens:triage");
    return `<p class="vg-muted vg-lens-note">Notes other notes already point at, ranked by how many. Writing these fills the biggest holes first.</p>
      <div class="vg-list-h">Linked but never written <span class="vg-count">${wanted.length}</span></div>
      ${wanted.slice(0, 30).map(n => `<div class="vg-sugg"><button class="vg-item" data-id="${esc(n.id)}"><span class="vg-dot is-ghost"></span><span class="vg-item-main"><span>${esc(n.name)}</span>
        <span class="vg-item-sub">linked from ${plural(n.from.length, "note")}: ${n.from.filter(id => byId[id]).slice(0, 3).map(id => esc(byId[id].name)).join(", ")}${n.from.length > 3 ? "…" : ""}</span></span></button>
        ${opts.writeNote && n.creatable ? `<span class="vg-sugg-acts">${actBtn("data-ghost", n.id, `${icon("file", 12)} Create`)}</span>` : ""}</div>`).join("") || `<div class="vg-empty">Every link points at a real note.</div>`}
      <div class="vg-list-h">Short notes that others rely on <span class="vg-count">${stubs.length}</span></div>
      ${stubs.slice(0, 30).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.words || 0} words · ${n.inlinks} links in${n.mentions ? ` · ${n.mentions} mentions` : ""}`)}
        ${opts.openNote ? `<span class="vg-sugg-acts">${actBtn("data-open", n.id, `${icon("open", 12)} Open`)}</span>` : ""}</div>`).join("") || `<div class="vg-empty">No thin notes with several links in.</div>`}`;
  }

  // 4. Standup follow-through: "Work Expected Tomorrow" against what the next standups say got done
  const FT = { next: ["Done next day", "var(--vg-ok)"], later: ["Done later", "color-mix(in srgb, var(--vg-ok) 55%, var(--vg-accent))"],
    carried: ["Carried forward", "var(--vg-warn)"], dropped: ["No sign of it", "var(--vg-muted)"], pending: ["Tomorrow's plan", "var(--vg-accent)"] };
  const ftKey = i => i.d + "|" + i.t.split(" · ")[0].slice(0, 120);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const standupPath = d => { const [y, m] = d.split("-"); return `${FOLDERS.daily}/${y}/${m}-${MONTHS[+m - 1]}/Standups/Daily Standup ${d}.md`; };
  function lensFollow() {
    const F = DATA.followthrough; if (!F || !F.items.length) return emptyNext(`No standups with a "Work Expected Tomorrow" section${F && F.days ? ` in the last ${F.days} days` : ""}.`, "daily");
    const items = F.items, judged = items.filter(i => i.s !== "pending");
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), recent = judged.filter(i => i.d >= since);
    const rate = xs => xs.length ? Math.round(100 * xs.filter(i => i.s === "next" || i.s === "later").length / xs.length) : 0;
    const count = (xs, s) => xs.filter(i => i.s === s).length;
    const monday = d => { const t = new Date(d + "T12:00"); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
    const weeks = {}; judged.forEach(i => { (weeks[monday(i.d)] = weeks[monday(i.d)] || []).push(i); });
    const bars = Object.entries(weeks).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 16).map(([w, xs]) => `<div class="vg-fd-row"><span class="vg-fd-name">week of ${shortDate(w)}</span><span class="vg-fd-bar">${
      ["next", "later", "carried", "dropped"].map(s => count(xs, s) ? `<i style="flex:${count(xs, s)};background:${FT[s][1]}" title="${FT[s][0]}: ${count(xs, s)}"></i>` : "").join("")}</span><span class="vg-count">${rate(xs)}%</span></div>`).join("");
    // the same plan written on several days is one thing you kept meaning to do: group by its first key words
    const key = t => t.toLowerCase().replace(/\[\[|\]\]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(" ");
    const groups = {}; items.forEach(i => { (groups[key(i.t)] = groups[key(i.t)] || []).push(i); });
    const ft = review.ft || {}, handled = i => ft[ftKey(i)];
    const stuck = Object.values(groups).filter(g => g.length >= 2 && !g.some(i => i.s === "next" || i.s === "later") && !handled(g[g.length - 1])).sort((a, b) => b.length - a.length || b[b.length - 1].d.localeCompare(a[a.length - 1].d));
    const dropped = Object.values(groups).filter(g => g.length === 1 && g[0].s === "dropped" && !handled(g[0])).map(g => g[0]).sort((a, b) => b.d.localeCompare(a.d));
    const done0 = Object.entries(ft).sort((a, b) => b[1].date.localeCompare(a[1].date));
    const done = judged.filter(i => i.s === "next" || i.s === "later").sort((a, b) => b.d.localeCompare(a.d));
    const pend = items.filter(i => i.s === "pending");
    const acts = i => `<span class="vg-sugg-acts">${opts.openNote ? `<button class="vg-btn vg-btn-sm" data-ftopen="${esc(i.d)}" title="Open the standup it was planned in">${icon("open", 12)}</button>` : ""}
      <button class="vg-btn vg-btn-sm" data-ftdone="${esc(ftKey(i))}" title="It got done (the standups just didn't say so): stop listing it">Done</button>
      <button class="vg-btn vg-btn-sm vg-btn-ghost" data-ftdrop="${esc(ftKey(i))}" title="Not planned any more: stop listing it">Drop</button></span>`;
    const row = (i, extra, act) => `<div class="vg-ft-row"><span class="vg-ft-dot" style="background:${FT[i.s][1]}" title="${FT[i.s][0]}"></span><span class="vg-ft-main"><span>${esc(i.t.split(" · ")[0])}</span>
      <span class="vg-item-sub">${extra}</span></span>${act ? acts(i) : ""}</div>`;
    const stat = (v, l) => `<div class="vg-stat"><b>${v}</b><span>${l}</span></div>`;
    return `<div class="vg-stats">${stat(rate(recent) + "%", "done · last 30 days")}${stat(count(recent, "next"), "done next day")}${stat(count(recent, "carried"), "carried forward")}${stat(count(recent, "dropped"), "no sign of it")}</div>
      ${/* each "Work Expected Tomorrow" item is matched to the next week's "Work Completed" lines by the rarer words they
         share; it's approximate, so each match shows the line it matched */ ""}
      <p class="vg-muted vg-lens-note">${plural(items.length, "plan")} from ${plural(F.standups, "standup")}, each checked against the next week's "Work Completed".</p>
      ${pend.length ? `<div class="vg-list-h">Tomorrow's plan</div>${pend.map(i => row(i, `planned ${shortDate(i.d)}`)).join("")}` : ""}
      <div class="vg-list-h">By week</div>${bars}
      <div class="vg-ft-legend">${["next", "later", "carried", "dropped"].map(s => `<span><i style="background:${FT[s][1]}"></i>${FT[s][0]}</span>`).join("")}</div>
      <div class="vg-list-h">Kept planning, never got done <span class="vg-count">${stuck.length}</span></div>
      ${stuck.slice(0, 25).map(g => row(g[g.length - 1], `planned ${plural(g.length, "time")} · ${shortDate(g[0].d)} → ${shortDate(g[g.length - 1].d)}`, true)).join("") || `<div class="vg-empty">Nothing stuck.</div>`}
      <details class="vg-ft-more"><summary>Planned once, no sign of it after <span class="vg-count">${dropped.length}</span></summary>${dropped.slice(0, 40).map(i => row(i, `planned ${shortDate(i.d)}`, true)).join("")}</details>
      ${done0.length ? `<details class="vg-ft-more"><summary>Handled by you <span class="vg-count">${done0.length}</span></summary>${done0.slice(0, 60).map(([k, v]) => `<div class="vg-ft-row"><span class="vg-ft-main"><span>${esc(v.t)}</span>
        <span class="vg-item-sub">${v.how === "done" ? "marked done" : "dropped"} ${shortDate(v.date)}</span></span><span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm vg-btn-ghost" data-ftundo="${esc(k)}">Undo</button></span></div>`).join("")}</details>` : ""}
      <details class="vg-ft-more"><summary>Done <span class="vg-count">${done.length}</span></summary>${done.slice(0, 60).map(i => row(i, `planned ${shortDate(i.d)} · done ${shortDate(i.w)}: “${esc(i.m.slice(0, 120))}”`)).join("")}</details>`;
  }

  // 12. Duplicates: notes flagged "(duplicate to merge)", same-name copies, and near-identical text, side by side
  function lensDupes() {
    const pairs = [], seen = new Set();
    const add = (a, b, why) => { const k = [a, b].sort().join("|"); if (a !== b && byId[a] && byId[b] && !seen.has(k)) { seen.add(k); pairs.push({ a, b, why }); } };
    const plain = s => s.replace(/\s*\(duplicate to merge\)\s*$/i, "").trim().toLowerCase();
    const real = nodes.filter(n => !special(n) && !n.ghost);
    real.filter(n => /\(duplicate to merge\)/i.test(n.name)).forEach(n => {
      const twin = real.find(m => m !== n && plain(m.name) === plain(n.name)) ||
        real.filter(m => m !== n && links.some(l => l.kind === "similar" && ((l.s === n && l.t === m) || (l.t === n && l.s === m))))[0];
      if (twin) add(n.id, twin.id, "flagged “duplicate to merge”"); else pairs.push({ a: n.id, b: null, why: "flagged “duplicate to merge”, no twin found by name" });
    });
    const byName = {}; real.forEach(n => (byName[n.name.toLowerCase()] = byName[n.name.toLowerCase()] || []).push(n));
    Object.values(byName).filter(g => g.length > 1).forEach(g => add(g[0].id, g[1].id, "same name, different folders"));
    (DATA.near_dupes || []).forEach(([a, b, s, how]) => add(a, b, how === "text" ? `${Math.round(s * 100)}% the same text` : `${Math.round(s * 100)}% same wording`));
    if (!pairs.length) return emptyNext("No likely duplicates.", "lens:triage");
    const side = (id, other) => { const n = byId[id], mine = [...nb[id]].filter(x => x !== other), theirs = other ? new Set(nb[other]) : new Set();
      const only = mine.filter(x => !theirs.has(x));
      return `<div class="vg-dp-side"><button class="vg-item" data-id="${esc(id)}"><span class="vg-item-main"><span>${esc(n.name)}</span><span class="vg-item-sub">${esc(n.folder || "/")} · ${n.words || 0} words · ${n.age}d since edit · ${n.inlinks} links in</span></span></button>
        <div class="vg-item-sub">${other ? `${plural(only.length, "link")} the other doesn't have` : plural(mine.length, "link")}${only.length ? ": " + only.slice(0, 6).map(x => esc(byId[x].name)).join(", ") + (only.length > 6 ? "…" : "") : ""}</div></div>`; };
    return `<p class="vg-muted vg-lens-note">Pairs that look like the same note. Each side lists the links only it has, so nothing is lost when you merge. Merging is up to you — this only shows them side by side.</p>
      ${pairs.map(p => `<div class="vg-dp"><div class="vg-dp-why">${esc(p.why)}</div><div class="vg-dp-pair">${side(p.a, p.b)}${p.b ? side(p.b, p.a) : ""}</div>
        <div class="vg-sugg-acts">${opts.openNote && p.b ? `<button class="vg-btn vg-btn-sm" data-openboth="${esc(p.a)}|${esc(p.b)}">${icon("open", 12)} Open both</button>` : ""}
        ${opts.dismissPair && p.b ? `<button class="vg-btn vg-btn-sm" data-notdup="${esc(p.a)}|${esc(p.b)}">Not duplicates</button>` : ""}</div></div>`).join("")}`;
  }

  // 14. Reading path: an ordered list for getting up to speed on one topic (map → central notes → details)
  let pathTopic = null;
  function readingPath(c) {
    const ms = topicNotes(c);
    if (!ms.length) return [];
    const inC = new Set(ms.map(n => n.id)), start = ms.slice().sort((a, b) => b.bc - a.bc || b.inlinks - a.inlinks)[0];
    const order = [start.id], seenP = new Set(order);
    for (let i = 0; i < order.length; i++)   // breadth-first from the hub, most central neighbours first
      [...nb[order[i]]].filter(x => inC.has(x) && !seenP.has(x)).sort((a, b) => byId[b].bc - byId[a].bc || byId[b].inlinks - byId[a].inlinks)
        .forEach(x => { seenP.add(x); order.push(x); });
    ms.filter(n => !seenP.has(n.id)).sort((a, b) => b.inlinks - a.inlinks).forEach(n => order.push(n.id));   // unlinked members last
    const core = Math.max(3, Math.round(order.length * 0.25));
    return [{ h: "Start here", ids: order.slice(0, 3) }, { h: "Core", ids: order.slice(3, core) }, { h: "Details", ids: order.slice(core) }].filter(s => s.ids.length);
  }
  const linkCount = (a, b) => { const p = (DATA.pairs || []).find(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a)); return p ? p[2] : 0; };

  // Stale triage: an old note isn't a problem by itself. Records are exempt; the rest split by what to do about them,
  // riskiest first, each group with the button that does its job. A note sits in the first group it fits.
  function lensTriage() {
    const ns = nodes.filter(n => !special(n) && !n.ghost), stale = ns.filter(n => staleFor(n, Q.stale_days)), records = ns.filter(n => isRecord(n) && n.age > Q.stale_days);
    const used = new Set(), take = f => stale.filter(n => !used.has(n.id) && f(n)).map(n => (used.add(n.id), n));
    const relied = take(n => (n.inlinks || 0) >= 4).sort(byImportance);
    const tasks = take(n => n.tasks > 0).sort((a, b) => (b.taskAge || 0) - (a.taskAge || 0) || b.tasks - a.tasks);
    const islands = take(n => n.isolated).sort((a, b) => b.age - a.age);
    const rest = take(() => true).sort(byImportance);
    const row = (n, sub, acts, extra) => `<div class="vg-sugg vg-st-row">${noteRow(n.id, sub)}<span class="vg-sugg-acts">${acts}</span>${extra || ""}</div>`;
    const open = n => opts.openNote ? actBtn("data-open", n.id, `${icon("open", 12)} Open`) : "";
    const ok = n => opts.stampReviewed ? actBtn("data-reviewed", n.id, "Still current") : "";
    const sec = (title, list, hint, render, max) => `<div class="vg-list-h">${title} <span class="vg-count">${list.length}</span></div><p class="vg-muted vg-lens-note">${hint}</p>` +
      (list.slice(0, max).map(render).join("") || `<div class="vg-empty">None.</div>`) + (list.length > max ? `<div class="vg-empty">…and ${list.length - max} more.</div>` : "");
    return `<p class="vg-muted vg-lens-note"><b>${stale.length}</b> notes haven't changed in ${Q.stale_days}+ days. ${records.length} more are records (finished work, release notes, meetings, reports, dated logs): they're meant to stay as written, so they don't count. Work top to bottom; at 5 a day the first group clears in about ${plural(Math.max(1, Math.ceil(relied.length / 35)), "week")}.</p>` +
      sec("1 · Relied on", relied, "Four or more notes link here, so an out-of-date version misleads them. Still right → Still current (records a review date, no edit). Wrong → open and fix.",
        n => row(n, `${n.inlinks} links in · ${n.age}d since edit`, open(n) + ok(n)), 25) +
      sec("2 · Holding open tasks", tasks, "Old tasks rot faster than notes. Tick what's done; cancel the rest with [-] in the note.",
        n => row(n, `${plural(n.tasks, "open task")}${n.taskAge != null ? ` · oldest ${n.taskAge}d` : ""} · ${n.age}d since edit`, (opts.readTasks ? `<button class="vg-btn vg-btn-sm" data-sttasks="${esc(n.id)}">Tasks</button>` : "") + open(n), `<div class="vg-st-tasks"></div>`), 20) +
      sec("3 · Unconnected", islands, "Nothing links in or out. Archive what's finished; link the rest from its map or a related note.",
        n => row(n, `${n.words || 0} words · ${n.age}d since edit`, open(n) + (opts.moveNote ? actBtn("data-archive", n.id, "Archive") : "")), 20) +
      sec("4 · Everything else", rest, "Connected but not heavily relied on. Fine to leave; review when you're in the area.",
        n => row(n, `${n.inlinks} links in · ${n.age}d since edit`, open(n) + ok(n)), 15) +
      `<details class="vg-st-records"><summary class="vg-list-h">Records, exempt <span class="vg-count">${records.length}</span></summary>${records.slice(0, 40).map(n => row(n, `${n.age}d since edit`, open(n))).join("")}</details>`;
  }

  // Blind spots: things the vault knows that you don't see — named but never linked, topics gone quiet, unmapped topics,
  // islands (written but connected to nothing) and dead ends (link out, nothing links in)
  function lensBlind() {
    const ns = nodes.filter(n => !special(n) && !n.ghost);
    const said = (DATA.said_unlinked || []).filter(([id]) => byId[id]).slice(0, 12);
    const quiet = DATA.clusters.map(c => { const mem = ns.filter(n => n.cluster === c.id);
      return { c, size: mem.length, recent: mem.reduce((s, n) => s + (n.recent || 0), 0), age: Math.min(...mem.map(n => n.age || 0)) }; })
      .filter(x => x.size >= 5 && !x.recent).sort((a, b) => b.size - a.size);
    const unmapped = DATA.clusters.filter(c => !mocOf[c.id] && c.size >= 5);
    const islands = ns.filter(n => n.isolated && (n.words || 0) >= Q.stub_words).sort((a, b) => b.words - a.words);
    const deadEnds = ns.filter(n => !n.inlinks && (n.outlinks || 0) >= 3).sort((a, b) => b.outlinks - a.outlinks);
    const sec = (title, n, hint, rows, empty) => `<div class="vg-list-h">${title} <span class="vg-count">${n}</span></div><p class="vg-muted vg-lens-note">${hint}</p>${rows || `<div class="vg-empty">${empty}</div>`}`;
    return sec("Named, never linked", said.length, "Your dailies mention these by name without a link, so the graph can't see the connection.",
        said.map(([id, k]) => `<div class="vg-sugg">${noteRow(id, `named ${plural(k, "time")} without a link`)}${fixSlot(id, "unlinked-mentions")}</div>`).join(""), "Every mention is linked.") +
      sec("Topics gone quiet", quiet.length, `Topics of 5+ notes your dailies haven't touched in ${DATA.recent_days} days. Finished, or forgotten?`,
        quiet.map(x => `<button class="vg-item" data-cl="${x.c.id}"><span class="vg-dot" style="background:${colorOf(x.c.id)}"></span><span class="vg-item-main"><span>${esc(clusterName(x.c.id))}</span><span class="vg-item-sub">${x.size} notes · newest edit ${x.age}d ago</span></span></button>`).join(""), "Every topic came up recently.") +
      sec("Topics no map covers", unmapped.length, "Without a map, these are only reachable by search or by luck.",
        unmapped.map(c => `<div class="vg-sugg"><button class="vg-item" data-cl="${c.id}"><span class="vg-dot" style="background:${colorOf(c.id)}"></span><span class="vg-item-main"><span>${esc(clusterName(c.id))}</span><span class="vg-item-sub">${c.size} notes</span></span></button>${opts.writeNote ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-draftmap="${c.id}">${icon("plus", 12)} Draft a map</button></span>` : ""}</div>`).join(""), "Every sizeable topic has a map.") +
      sec("Islands", islands.length, "Real notes (not stubs) with no links in or out: written once, never found again.",
        islands.slice(0, 15).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.words} words · ${n.age}d since edit`)}${fixSlot(n.id, "orphan")}</div>`).join(""), "No unconnected notes.") +
      sec("Dead ends", deadEnds.length, "Notes that point at others but nothing points back at them: you can only arrive here by accident.",
        deadEnds.slice(0, 15).map(n => `<div class="vg-sugg">${noteRow(n.id, `${n.outlinks} links out · 0 in`)}${fixSlot(n.id, "orphan")}</div>`).join(""), "Everything that links out is linked to.");
  }

  // Adjacent possible (Stuart Kauffman): new ideas sit one step past what you already have. Notes two links from
  // what you're working on now that you haven't touched, plus random far-apart pairs to combine
  function lensAdjacent() {
    const ns = nodes.filter(n => !special(n) && !n.ghost), adj = {};
    links.forEach(l => { if (l.kind !== "link") return; (adj[l.s.id] = adj[l.s.id] || new Set()).add(l.t.id); (adj[l.t.id] = adj[l.t.id] || new Set()).add(l.s.id); });
    const active = ns.filter(n => (n.recent || 0) > 0 || (n.opens90 || 0) > 2), seen = new Set(active.map(n => n.id));
    active.forEach(n => (adj[n.id] || []).forEach(m => seen.add(m)));
    const reach = {};
    active.forEach(n => (adj[n.id] || []).forEach(m => (adj[m] || []).forEach(x => {
      if (seen.has(x) || !byId[x] || special(byId[x]) || byId[x].ghost) return;
      (reach[x] = reach[x] || { via: new Set(), from: new Set() }).via.add(m); reach[x].from.add(n.id); })));
    const edge = Object.entries(reach).map(([id, r]) => ({ n: byId[id], r })).sort((a, b) => b.r.from.size - a.r.from.size || (b.n.words || 0) - (a.n.words || 0));
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const top = c => ns.filter(n => n.cluster === c.id).sort(byImportance).slice(0, 5);
    const far = []; const cs = DATA.clusters.filter(c => c.size >= 3);
    for (let i = 0; i < 40 && far.length < 5 && cs.length > 1; i++) { const a = pick(cs), b = pick(cs);
      if (a.id !== b.id && !linkCount(a.id, b.id) && !far.some(f => f[0].id === a.id && f[1].id === b.id)) far.push([a, b, pick(top(a)), pick(top(b))]); }
    impMax = null;
    return `<p class="vg-muted vg-lens-note">The biologist Stuart Kauffman called it the <i>adjacent possible</i>: you can't jump to a far-off idea, but every idea you hold opens a ring of next ones. Here that ring is notes two links from the ${plural(active.length, "note")} you've been in lately${DATA.has_usage ? " (daily mentions or opens)" : ""}, which you haven't touched.</p>
      <div class="vg-list-h">One step past where you are <span class="vg-count">${edge.length}</span></div>
      ${edge.slice(0, 20).map(({ n, r }) => `<div class="vg-sugg">${noteRow(n.id, `via ${[...r.via].slice(0, 2).map(v => esc(byId[v].name)).join(", ")} · reached from ${plural(r.from.size, "active note")}`)}${opts.openNote ? `<span class="vg-sugg-acts">${actBtn("data-open", n.id, `${icon("open", 12)} Open`)}</span>` : ""}</div>`).join("") || `<div class="vg-empty">Nothing two steps out — link a few more notes from your dailies.</div>`}
      <div class="vg-list-h">Strange pairs</div>
      <p class="vg-muted vg-lens-note">Two central notes from topics that never link. Ask what one would say about the other; if there's an answer, that's a new note.</p>
      ${far.map(([a, b, x, y]) => `<div class="vg-sugg"><button class="vg-item" data-cl="${a.id},${b.id}"><span class="vg-item-main"><span>${esc(x.name)} × ${esc(y.name)}</span>
        <span class="vg-item-sub">${esc(shortName(a.id))} × ${esc(shortName(b.id))}</span></span></button>${opts.writeNote ? `<span class="vg-sugg-acts"><button class="vg-btn vg-btn-sm" data-bridge="${a.id},${b.id}">${icon("bridge", 12)} Draft bridge</button></span>` : ""}</div>`).join("") || `<div class="vg-empty">Every topic already links to every other.</div>`}
      <div class="vg-ins-actions"><button class="vg-btn" data-relens="adjacent">${icon("sparkles", 14)} Shuffle pairs</button></div>`;
  }

  function lensPath() {
    const cs = DATA.clusters.filter(c => c.size >= 4).sort((a, b) => b.size - a.size);
    if (!cs.length) return `<div class="vg-empty">No topics yet.</div>`;
    if (pathTopic == null || !cs.some(c => c.id === pathTopic)) pathTopic = cs[0].id;
    const m = mocOf[pathTopic], secs = readingPath(pathTopic);
    const line = id => { const n = byId[id]; return noteRow(id, `${n.words < Q.stub_words ? "short · " : ""}${n.age}d since edit${staleFor(n, Q.stale_days) ? " · may be out of date" : ""}`); };
    return `<div class="vg-rp-top"><select class="vg-rp-pick" aria-label="Topic">${cs.map(c => `<option value="${c.id}" ${c.id === pathTopic ? "selected" : ""}>${esc(clusterName(c.id))} (${c.size})</option>`).join("")}</select>
        ${opts.writeNote ? `<button class="vg-btn vg-btn-sm" data-savepath>${icon("file", 12)} Save as note</button>` : ""}</div>
      <p class="vg-muted vg-lens-note">Read top to bottom: the topic's map, then its most central notes, following links outward from the hub. Good for getting someone (or future you) up to speed.</p>
      ${m ? `<div class="vg-list-h">Map</div><div class="vg-sugg">${noteRow(m.id, "the topic's map of content")}</div>` : ""}
      ${secs.map(s => `<div class="vg-list-h">${s.h} <span class="vg-count">${s.ids.length}</span></div><ol class="vg-rp-list">${s.ids.map(id => `<li>${line(id)}</li>`).join("")}</ol>`).join("")}`;
  }
  function savePath() {
    const c = pathTopic, m = mocOf[c], secs = readingPath(c), title = `Reading Path — ${clusterName(c)}`;
    let k = 0;
    const md = `---\ncreated: ${today()}\ntags:\n  - type/guide\n---\n# ${title}\n\n> Generated by Vault Graph on ${today()}: the topic's map, then its most central notes, following links outward from the hub.\n\n` +
      (m ? `**Map:** ${mdLink(m.id)}\n\n` : "") + secs.map(s => `## ${s.h}\n\n${s.ids.map(id => `${++k}. ${mdLink(id)}`).join("\n")}`).join("\n\n") + "\n";
    write(`${FOLDERS.inbox}/${safeName(title)}.md`, md, "create", "Reading path");
  }

  // Code ↔ docs: git history (paths and dates only) against the files and components your notes name
  function lensCode() {
    const C = DATA.code; if (!C || !C.repos || !C.repos.length) return `<div class="vg-empty">No git repos found${C && C.roots && C.roots.length ? ` in ${esc(C.roots.join(" or "))}` : ""}.</div>`;
    // paths shown without the folders every area shares (a lone repo's name, its src/)
    const lead = (() => { const ps = (C.areas || []).map(a => a[0].split("/")); let k = 0;
      while (ps.length > 1 && ps.every(p => p.length > k + 1 && p[k] === ps[0][k])) k++; return k ? ps[0].slice(0, k).join("/") + "/" : ""; })();
    const short = p => (lead && p.startsWith(lead) ? p.slice(lead.length) : p);
    const docRow = (rel, sub) => { const n = byId[rel], name = rel.split("/").pop().replace(/\.md$/, "");
      return `<button class="vg-item" ${n ? `data-id="${esc(rel)}"` : opts.openNote ? `data-open="${esc(rel)}"` : ""}><span class="vg-dot" style="background:${n ? dotOf(rel) : "var(--vg-muted)"}"></span><span class="vg-item-main"><span>${esc(name)}</span><span class="vg-item-sub">${sub}</span></span></button>`; };
    const area = a => `<div class="vg-cd-area"><span class="vg-cd-path" title="${esc(a[0])}">${esc(short(a[0]))}</span><span class="vg-muted">${a[1]} commits · 90d · ${a[2]} · year · ${plural(a[4], "file")} · last ${shortDate(a[3])}</span></div>`;
    const isTest = p => /(^|\/)__tests__(\/|$)|\.test\.|\.spec\./.test(p);   // tests don't need a doc of their own
    const undoc = C.areas.filter(a => !a[5].length && !isTest(a[0])), covered = C.areas.filter(a => a[5].length).slice(0, 15);
    const hotFiles = (C.hot || []).filter(f => !f[4].length && !isTest(f[0])).slice(0, 15);
    return `<div class="vg-stats"><div class="vg-stat"><b>${C.docs}</b><span>notes name code</span></div><div class="vg-stat"><b>${undoc.length}</b><span>busy folders, no doc</span></div><div class="vg-stat"><b>${C.behind.length}</b><span>docs behind their code</span></div></div>
      <p class="vg-muted vg-lens-note">Git history for ${C.repos.map(esc).join(", ")} over the last ${C.days} days (file paths and dates only), matched against file names, paths and component names in your notes. A bare "route.js" only counts when it points at exactly one file.</p>
      <div class="vg-list-h">Changes often, no doc <span class="vg-count">${undoc.length}</span></div>
      ${undoc.slice(0, 20).map(area).join("") || `<div class="vg-empty">Every busy folder has at least one note.</div>`}
      ${hotFiles.length ? `<details class="vg-ft-more"><summary>Busiest files no note mentions <span class="vg-count">${hotFiles.length}</span></summary>${hotFiles.map(f => `<div class="vg-cd-area"><span class="vg-cd-path" title="${esc(f[0])}">${esc(short(f[0]))}</span><span class="vg-muted">${f[2]} commits · 90d · ${f[1]} · year · last ${shortDate(f[3])}</span></div>`).join("")}</details>` : ""}
      <div class="vg-list-h">Docs behind their code <span class="vg-count">${C.behind.length}</span></div>
      <p class="vg-muted vg-lens-note">Commits to the files a note names, made after the note was last edited. Release notes, scopes of work and dated notes are left out: they describe the code as it was. Edit dates come from file timestamps: a bulk edit (a tag migration, say) makes older docs look current.</p>
      ${C.behind.slice(0, 30).map(b => `<div class="vg-cd-doc">${docRow(b[0], `last edited ${shortDate(b[1])} · ${plural(b[2], "commit")} since`)}
        <div class="vg-cd-files">${b[3].map(r => `<span title="${esc(r[0])}">${esc(r[0].split("/").slice(-2).join("/"))} <b>+${r[1]}</b></span>`).join("")}</div></div>`).join("") || `<div class="vg-empty">No doc is behind its code.</div>`}
      <details class="vg-ft-more"><summary>Busiest folders and the notes that cover them <span class="vg-count">${covered.length}</span></summary>${covered.map(a => `${area(a)}<div class="vg-cd-covers">${a[5].slice(0, 6).map(r => docRow(r, "")).join("")}${a[5].length > 6 ? `<span class="vg-muted">+${a[5].length - 6} more</span>` : ""}</div>`).join("")}</details>`;
  }

  function wireLensExtras(body) {
    body.querySelectorAll("[data-sttasks]").forEach(d => { const box = d.closest(".vg-st-row").querySelector(".vg-st-tasks");
      d.onclick = e => { e.stopPropagation(); toggleTasks(d.dataset.sttasks, box); };
      if (openTasks.has(d.dataset.sttasks)) renderTasks(d.dataset.sttasks, box); });
    body.querySelectorAll("[data-archive]").forEach(d => d.onclick = async e => { e.stopPropagation(); d.disabled = true;
      if (await VGActions.run("archive", byId[d.dataset.archive], actionCtx(), e)) { const row = d.closest(".vg-sugg"); if (row) row.remove(); } else d.disabled = false; });
    const ftMark = (key, how) => { const [d] = key.split("|"); review.ft = { ...(review.ft || {}), [key]: { how, date: today(), t: key.slice(d.length + 1) } };
      logDiscovery(`${how === "done" ? "Marked done" : "Dropped"} a standup plan: ${key.slice(d.length + 1).slice(0, 60)}`); persistSoon(); refreshLens(); };
    body.querySelectorAll("[data-ftdone]").forEach(d => d.onclick = e => { e.stopPropagation(); ftMark(d.dataset.ftdone, "done"); });
    body.querySelectorAll("[data-ftdrop]").forEach(d => d.onclick = e => { e.stopPropagation(); ftMark(d.dataset.ftdrop, "dropped"); });
    body.querySelectorAll("[data-ftundo]").forEach(d => d.onclick = e => { e.stopPropagation(); const ft = { ...(review.ft || {}) }; delete ft[d.dataset.ftundo]; review.ft = ft; persistSoon(); refreshLens(); });
    body.querySelectorAll("[data-ftopen]").forEach(d => d.onclick = e => { e.stopPropagation(); opts.openNote(standupPath(d.dataset.ftopen), e.ctrlKey || e.metaKey); });
    body.querySelectorAll("[data-reviewed]").forEach(d => d.onclick = async e => { e.stopPropagation(); d.disabled = true;
      if (!await VGActions.run("current", byId[d.dataset.reviewed], actionCtx(), e)) d.disabled = false; });
    body.querySelectorAll("[data-ghost]").forEach(d => d.onclick = async e => { e.stopPropagation(); d.disabled = true;
      try { await createGhost(byId[d.dataset.ghost]); refreshLens(); } catch (err) { d.disabled = false; toast("Couldn't create the note", "warn"); } });
    body.querySelectorAll("[data-openboth]").forEach(d => d.onclick = e => { e.stopPropagation(); const [a, b] = d.dataset.openboth.split("|"); opts.openNote(a, false); opts.openNote(b, true); });
    body.querySelectorAll("[data-notdup]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [a, b] = d.dataset.notdup.split("|");
      if (!await confirmBox("Not duplicates", `Stop suggesting <b>${esc(byId[a].name)}</b> and <b>${esc(byId[b].name)}</b> as duplicates?`, "Not duplicates")) return;
      await opts.dismissPair(a, b, "similar"); DATA.near_dupes = (DATA.near_dupes || []).filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))); refreshLens(); });
    const pick = body.querySelector(".vg-rp-pick"); if (pick) pick.onchange = () => { pathTopic = +pick.value; refreshLens(); };
    const sp = body.querySelector("[data-savepath]"); if (sp) sp.onclick = () => savePath();
    const rv = body.querySelector("[data-rvskip]");
    if (rv) rv.onchange = () => { riverSkipTop = rv.checked; refreshLens(); };
    body.querySelectorAll("[data-addmap]").forEach(d => d.onclick = async e => { e.stopPropagation(); const [mid, id] = d.dataset.addmap.split("|");
      if (await addToMap(mid, [id], d)) refreshLens(); });
    body.querySelectorAll("[data-addall]").forEach(d => d.onclick = async e => { e.stopPropagation(); const m = mocs.find(x => x.id === d.dataset.addall); if (!m) return;
      const ids = m.clusters.flatMap(c => (m.missing[c] || []).filter(id => byId[id]));
      if (!await confirmBox("Add to map", `Add <b>${plural(ids.length, "note")}</b> to <b>${esc(m.title)}</b> under "Also in this topic"?`, "Add")) return;
      if (await addToMap(m.id, ids, d)) refreshLens(); });
    body.querySelectorAll("[data-draftmap]").forEach(d => d.onclick = e => { e.stopPropagation(); const c = +d.dataset.draftmap;
      writeMap(topicNotes(c).sort(byInfluence).map(n => n.id), clusterName(c)); });
    body.querySelectorAll("[data-fold]").forEach(d => d.onclick = e => { e.stopPropagation(); const f = d.dataset.fold;
      const ids = new Set(nodes.filter(n => !special(n) && folderOf(n.id) === f).map(n => n.id)); if (!lensBeside()) closeLens();
      setHighlight(ids, `folder · ${f}`); select(null); const lit = ids; fit(n => lit.has(n.id), 400); });
    body.querySelectorAll("[data-fp]").forEach(d => d.onclick = e => { e.stopPropagation();
      const box = body.querySelector(".vg-rg-detail"); if (!box) return;
      const folders = [...body.querySelectorAll(".vg-rg-arc")].map(x => x.dataset.fold), [i, j] = d.dataset.fp.split(",").map(Number), A = folders[i], B = folders[j];
      const ls = links.filter(l => l.kind === "link" && !special(l.s) && !special(l.t) && ((folderOf(l.s.id) === A && folderOf(l.t.id) === B) || (folderOf(l.s.id) === B && folderOf(l.t.id) === A)));
      box.innerHTML = `<div class="vg-card"><div class="vg-card-h"><span>${esc(A)} ↔ ${esc(B)}</span><span class="vg-muted vg-card-hint">${plural(ls.length, "link")}</span></div>${ls.slice(0, 40).map(l =>
        `<button class="vg-item" data-id="${esc(l.s.id)}"><span class="vg-item-main"><span>${esc(l.s.name)} → ${esc(l.t.name)}</span><span class="vg-item-sub">${esc(folderOf(l.s.id))} → ${esc(folderOf(l.t.id))}</span></span></button>`).join("")}${ls.length > 40 ? `<div class="vg-empty">…and ${ls.length - 40} more</div>` : ""}</div>`;
      wireLens(box); box.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }); });
  }

  // ---------------------------------------------------------------- food web: dependents and keystones
  // What depends on a note: everything above it in the web that links to it, and what links to those, and so on.
  // A keystone is a stale note many others depend on: the notes most worth keeping current.
  let depMemo = null;
  function dependents(id) {
    const F = mapCache.foodweb; if (!F) return new Set();
    if (depMemo && depMemo.F === F && depMemo.links === links.length && depMemo.m.has(id)) return depMemo.m.get(id);
    if (!depMemo || depMemo.F !== F || depMemo.links !== links.length) depMemo = { F, links: links.length, m: new Map() };
    const y = i => (F.pos.get(i) || [0, -1e9])[1], seen = new Set([id]), q = [id];
    while (q.length) { const x = q.shift(); for (const m of nb[x] || []) if (!seen.has(m) && byId[m] && !special(byId[m]) && !byId[m].isolated && y(m) < y(x) - 60) { seen.add(m); q.push(m); } }
    seen.delete(id); depMemo.m.set(id, seen); return seen;
  }
  const keystones = () => !mapCache.foodweb ? [] : nodes.filter(n => !special(n) && !n.ghost && !n.isolated && staleFor(n, Q.stale_days))
    .map(n => ({ n, deps: dependents(n.id).size })).filter(x => x.deps >= 3).sort((a, b) => b.deps - a.deps || b.n.age - a.n.age);

  // ---------------------------------------------------------------- radar triage: the oldest waiting tasks, one note at a time
  let triage = null;
  function startTriage() {
    const q = nodes.filter(n => !special(n) && !n.ghost && n.tasks > 0).sort((a, b) => (b.taskAge ?? b.age ?? 0) - (a.taskAge ?? a.age ?? 0)).map(n => n.id);
    if (!q.length) { toast("No open tasks", "ok"); return; }
    if (st.view !== "radar") setView("radar");
    triage = { q, i: 0 }; showTriage();
  }
  function showTriage() {
    const bar = $(".vg-triage"); if (!triage) { bar.hidden = true; return; }
    const id = triage.q[triage.i], n = byId[id]; bar.hidden = false;
    $(".vg-triage-text").textContent = `Triage ${triage.i + 1} / ${triage.q.length} · ${n.name} · oldest task ${n.taskAge ?? n.age} days`;
    select(id); centreOn(id, 1.6);
  }
  function stopTriage() { triage = null; $(".vg-triage").hidden = true; }
  $(".vg-triage-next").onclick = () => { if (!triage) return; triage.i = (triage.i + 1) % triage.q.length; showTriage(); };
  $(".vg-triage-prev").onclick = () => { if (!triage) return; triage.i = (triage.i - 1 + triage.q.length) % triage.q.length; showTriage(); };
  $(".vg-triage-stop").onclick = () => { stopTriage(); select(null); };

