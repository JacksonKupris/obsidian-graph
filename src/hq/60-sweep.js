  // ---- Sweep: the carried-over tasks a day at a time, oldest first: Done (finished some time ago, so it doesn't go in
  // today's standup), Cancel, or Keep (stays open; gone from the sweep until you come back to it)
  const SWEEP_OLD = 14;   // days: a day this old is marked
  let sweepBy = "day";   // or "section": the journal heading it's under
  const subsHtml = it => it.subs ? VGParts.more({ cls: "vg-hq-subs", label: plural(it.subs.length, "subtask"), body: `<ul>${it.subs.map(x => `<li>${esc(VGRules.plainTask(x.text))}</li>`).join("")}</ul>` }) : "";
  const sectionOf = it => VGRules.plainTask(it.section || "") || "No heading";
  function sweepScreen() {
    const all = ofKind("carried").filter(it => !kept.has(it.key)), left = all.filter(it => it.underDone), items = all.filter(it => !it.underDone), days = [...new Set(items.map(it => it.date))].sort();
    const head = `<button class="vg-hq-btn vg-hq-btn-ghost" data-go="today">${icon("left", 14)} Today</button><h1 class="vg-hq-h1">Sweep carried over</h1>`;
    if (needsWalk && all.length) return head + walkHtml(all.slice().sort((a, b) => b.age - a.age), it => `<button class="vg-hq-btn vg-hq-btn-primary" data-one="x" data-key="${esc(it.key)}">Done</button><button class="vg-hq-btn" data-one="-" data-key="${esc(it.key)}">Cancel</button>${api.moveTasks ? `<button class="vg-hq-btn" data-one="move" data-key="${esc(it.key)}">Move…</button>` : ""}<button class="vg-hq-btn" data-one="keep" data-key="${esc(it.key)}">Keep</button>${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-open="${esc(it.path)}">Open</button>` : ""}`);
    if (!all.length) return head + empty(kept.size ? `Swept. ${plural(kept.size, "task")} kept open.` : "No tasks carried over.", [["Today", 'data-go="today"'], ["Home", 'data-go="home"']]);
    const moveBtn = (small, attrs) => api.moveTasks ? `<button class="vg-hq-btn vg-hq-btn-sm${small}" ${attrs}>Move…</button>` : "";
    const row = it => `<div class="vg-hq-item" data-key="${esc(it.key)}"><div class="vg-hq-txt"><b>${esc(it.title)}</b>${it.under ? `<small>Under ${esc(it.under)}</small>` : ""}${it.delegated ? `<small>delegated to ${esc(it.delegated)}</small>` : ""}${sweepBy === "section" || it.underDone ? `<small>${esc(it.date)} · ${plural(it.age, "day")} ago</small>` : ""}${subsHtml(it)}</div><div class="vg-hq-acts">
          <button class="vg-hq-btn vg-hq-btn-sm" data-one="x" data-key="${esc(it.key)}">Done</button><button class="vg-hq-btn vg-hq-btn-sm" data-one="-" data-key="${esc(it.key)}">Cancel</button>${moveBtn("", `data-one="move" data-key="${esc(it.key)}"`)}
          <button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-one="keep" data-key="${esc(it.key)}">Keep</button>${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-open="${esc(it.path)}">Open</button>` : ""}</div></div>`;
    const group = (its, label, attr, old) => `<section class="vg-hq-sec vg-hq-sweep" ${attr}><h3><span>${label} · ${plural(its.length, "task")}${old ? ' <em class="vg-hq-old">2+ weeks</em>' : ""}</span>
        <span class="vg-hq-acts"><button class="vg-hq-btn vg-hq-btn-sm" data-batch="x" ${attr}>Done all</button><button class="vg-hq-btn vg-hq-btn-sm" data-batch="-" ${attr}>Cancel all</button>${moveBtn("", `data-batch="move" ${attr}`)}<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-batch="keep" ${attr}>Keep all</button></span></h3>` + its.map(row).join("") + `</section>`;
    const byDay = d => { const its = items.filter(it => it.date === d), age = its[0].age; return group(its, `${esc(VGShared.noon(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))} · ${plural(age, "day")} ago`, `data-day="${esc(d)}"`, age >= SWEEP_OLD); };
    const sections = [...new Set(items.map(sectionOf))].map(sec => { const its = items.filter(it => sectionOf(it) === sec).sort((x, y) => y.age - x.age); return { sec, its }; }).sort((x, y) => y.its.length - x.its.length);
    const bySection = ({ sec, its }) => group(its, esc(sec), `data-section="${esc(sec)}"`, its[0].age >= SWEEP_OLD);
    const leftGroup = left.length ? group(left.slice().sort((x, y) => y.age - x.age), "Left open under a finished task", 'data-leftover="1"', false) : "";
    const old = all.filter(it => it.age > 30).length, subs = all.reduce((n, it) => n + (it.subs || []).length, 0);
    const by = (k, words) => `<button class="vg-hq-filter${sweepBy === k ? " is-on" : ""}" data-sweepby="${k}" aria-pressed="${sweepBy === k}">${words}</button>`;
    const repeats = new Map();
    items.forEach(it => { const key = duplicateKey(it); if (!repeats.has(key)) repeats.set(key, []); repeats.get(key).push(it); });
    const duplicates = [...repeats.values()].filter(g => g.length > 1);
    const review = duplicates.length ? VGParts.more({ cls: "vg-hq-duplicates", label: `Review ${plural(duplicates.length, "repeated wording group")} · no tasks merged`, body: duplicates.map(g =>
      `<div class="vg-hq-txt"><b>${esc(g[0].title)}</b>${g.map(it => `<p>${api.openNote ? `<button class="vg-hq-inline-link" data-open="${esc(it.path)}">${esc(it.path)}</button>` : esc(it.path)} · line ${it.line + 1}</p>`).join("")}</div>`).join("") }) : "";
    return head + `<p class="vg-hq-lede">${plural(all.length, "task")}, ${old} older than 30 days.${subs ? ` ${plural(subs, "subtask")} go with their tasks.` : ""}</p><div class="vg-hq-filters" role="group" aria-label="Group by">${by("day", "By day, oldest first")}${by("section", "By heading, largest first")}<button class="vg-hq-filter" data-walk="on">One at a time</button></div>${review}${leftGroup}` + (sweepBy === "day" ? days.map(byDay) : sections.map(bySection)).join("");
  }
  async function sweep(how, list, btn, from) {
    if (!list.length) return;
    if (how === "keep") { list.forEach(it => kept.add(it.key)); render(); return; }
    let to = null, title = "";
    if (how === "move") { const projects = projectsToAdd(); to = await chooseFrom(`Move ${plural(list.length, "task")} to which project?`, "Filter projects", "No project matches.", projects.map(p => ({ value: p.path, label: p.title, sub: VGRules.statusWords(p.status) }))); if (to === null) return; title = (projects.find(p => p.path === to) || {}).title || to; }
    if (btn) btn.disabled = true;
    const ok = await (how === "move" ? VGActions.runMove(list, to, title, ctx()) : VGActions.runBatch(list, how, ctx(), from));
    if (ok) { list.forEach(it => gone.add(it.key)); relist(); render(); } else if (btn && btn.isConnected) btn.disabled = false;
  }

  // ---- Recent changes: everything the plugin changed that can still be undone, newest first. The message's Undo goes in seconds; this stays.
  const whenWords = t => { if (!t) return ""; const d = new Date(t), same = VGRules.localDay(d) === day(); return same ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
  function changesScreen() {
    const list = api.recentChanges ? api.recentChanges() : [], head = `<h1 class="vg-hq-h1">Recent changes</h1>`;
    if (!list.length) return head + empty("Nothing to undo.", [["Today", 'data-go="today"'], ["Home", 'data-go="home"']]);
    return `${head}<p class="vg-hq-lede">The last ${plural(list.length, "change")}, newest first. A note edited by hand since can't be undone from here.</p><section class="vg-hq-sec">${list.map(c => `<div class="vg-hq-item"><div class="vg-hq-txt"><b>${esc(c.label || `Changed ${c.files.map(nameOf).slice(0, 2).join(", ")}`)}</b><small>${esc(whenWords(c.when))} · ${c.files.slice(0, 3).map(f => esc(nameOf(f))).join(", ")}${c.files.length > 3 ? ` and ${c.files.length - 3} more` : ""}</small></div><div class="vg-hq-acts"><button class="vg-hq-btn vg-hq-btn-sm" data-changeundo="${c.id}">Undo</button></div></div>`).join("")}</section>`;
  }
  async function undoChange(id, btn) { btn.disabled = true; try { await api.undo(id); toast("Undone"); relist(); render(); } catch (err) { btn.disabled = false; toast(`Couldn't undo: ${(err && err.message) || err}`, null, true); } }
  // ---- Report rows: each row of the report to tick (apply) or skip, in the report itself
  const rowKey = r => `${r.path}|${r.line}`;
  function rowsScreen() {
    const rep = ((hq() || {}).reports || []).find(r => r.path === rowsPath);
    const head = `<button class="vg-hq-btn vg-hq-btn-ghost" data-go="needs">${icon("left", 14)} Needs you</button>${api.openNote && rep ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-open="${esc(rep.path)}">Open source report</button>` : ""}`;
    if (!rep) return head + empty("That report isn't there any more.", [["Needs you", 'data-go="needs"']]);
    const rows = (rep.rows || []).map(r => ({ ...r, path: rep.path })).filter(r => !gone.has(rowKey(r)));
    const sections = [...new Set(rows.map(r => r.section))];
    return head + `<h1 class="vg-hq-h1">${esc(rep.name)}</h1><p class="vg-hq-lede">${rows.length ? `${plural(rows.length, "row")} to tick or skip. Ticked rows are applied by the gardener.` : "Every row is ticked or skipped."}</p>` +
      (rows.length ? sections.map(sec => `<section class="vg-hq-sec"><h3>${esc(sec || rep.name)}<span>${rows.filter(r => r.section === sec).length}</span></h3>` + rows.filter(r => r.section === sec).map(r =>
        `<div class="vg-hq-item"><div class="vg-hq-txt">${r.context ? `<small>${esc(VGRules.plainRowFull(r.context))}</small>` : ""}<b>${esc(VGRules.plainRowFull(r.text))}</b><small>Source report: ${esc(rep.path)}</small></div><div class="vg-hq-acts">
          <button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-primary" data-row="x" data-rline="${r.line}">Tick</button><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-row="-" data-rline="${r.line}">Skip</button></div></div>`).join("") + `</section>`).join("")
        : empty("Every row is ticked or skipped.", [["Needs you", 'data-go="needs"'], ...(api.openNote ? [["Open the report", `data-open="${esc(rep.path)}"`]] : [])]));
  }
  async function tickRow(line, mark, btn) {
    const rep = ((hq() || {}).reports || []).find(r => r.path === rowsPath), row = rep && (rep.rows || []).find(r => r.line === line);
    if (!row) return;
    if (btn) btn.disabled = true;
    const r = { ...row, path: rep.path };
    if (await VGActions.runRow(r, mark, ctx())) { gone.add(rowKey(r)); relist(); render(); } else if (btn && btn.isConnected) btn.disabled = false;
  }

