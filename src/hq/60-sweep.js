  // ---- Sweep: the carried-over tasks a day at a time, oldest first: Done (finished some time ago, so it doesn't go in
  // today's standup), Cancel, or Keep (stays open; gone from the sweep until you come back to it)
  const SWEEP_OLD = 14;   // days: a day this old is marked
  function sweepScreen() {
    const items = ofKind("carried").filter(it => !kept.has(it.key)), days = [...new Set(items.map(it => it.date))].sort();
    const head = `<button class="vg-hq-btn vg-hq-btn-ghost" data-go="today">${icon("left", 14)} Today</button><h1 class="vg-hq-h1">Sweep carried over</h1>`;
    if (!items.length) return head + empty(kept.size ? `Swept. ${plural(kept.size, "task")} kept open.` : "No tasks carried over.", [["Today", 'data-go="today"'], ["Home", 'data-go="home"']]);
    const group = d => { const its = items.filter(it => it.date === d), age = its[0].age;
      return `<section class="vg-hq-sec vg-hq-sweep" data-day="${esc(d)}"><h3><span>${esc(new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))} · ${plural(its.length, "task")} · ${plural(age, "day")} ago${age >= SWEEP_OLD ? ' <em class="vg-hq-old">2+ weeks</em>' : ""}</span>
        <span class="vg-hq-acts"><button class="vg-hq-btn vg-hq-btn-sm" data-batch="x" data-day="${esc(d)}">Done all</button><button class="vg-hq-btn vg-hq-btn-sm" data-batch="-" data-day="${esc(d)}">Cancel all</button><button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-batch="keep" data-day="${esc(d)}">Keep all</button></span></h3>` +
        its.map(it => `<div class="vg-hq-item" data-key="${esc(it.key)}"><div class="vg-hq-txt"><b>${esc(it.title)}</b>${it.delegated ? `<small>delegated to ${esc(it.delegated)}</small>` : ""}</div><div class="vg-hq-acts">
          <button class="vg-hq-btn vg-hq-btn-sm" data-one="x" data-key="${esc(it.key)}">Done</button><button class="vg-hq-btn vg-hq-btn-sm" data-one="-" data-key="${esc(it.key)}">Cancel</button>
          <button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-one="keep" data-key="${esc(it.key)}">Keep</button>${api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-open="${esc(it.path)}">Open</button>` : ""}</div></div>`).join("") + `</section>`; };
    const repeats = new Map();
    items.forEach(it => { const key = duplicateKey(it); if (!repeats.has(key)) repeats.set(key, []); repeats.get(key).push(it); });
    const duplicates = [...repeats.values()].filter(g => g.length > 1);
    const review = duplicates.length ? `<details class="vg-hq-duplicates"><summary>Review ${plural(duplicates.length, "repeated wording group")} · no tasks merged</summary>${duplicates.map(g =>
      `<div class="vg-hq-txt"><b>${esc(g[0].title)}</b>${g.map(it => `<p>${api.openNote ? `<button class="vg-hq-inline-link" data-open="${esc(it.path)}">${esc(it.path)}</button>` : esc(it.path)} · line ${it.line + 1}</p>`).join("")}</div>`).join("")}</details>` : "";
    return head + `<p class="vg-hq-lede">${plural(items.length, "task")} from ${plural(days.length, "day")}, oldest first.</p>${review}` + days.map(group).join("");
  }
  async function sweep(how, list, btn, from) {
    if (!list.length) return;
    if (how === "keep") { list.forEach(it => kept.add(it.key)); render(); return; }
    if (btn) btn.disabled = true;
    const ok = await VGActions.runBatch(list, how, ctx(), from);
    if (ok) { list.forEach(it => gone.add(it.key)); relist(); render(); } else if (btn && btn.isConnected) btn.disabled = false;
  }

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

