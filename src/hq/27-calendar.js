  // ---- Calendar: a month of work at a glance. A day's shade is how much got done; its marks are a journal and a standup. Pick a
  // day to see what got done, open its notes, or copy the list for a standup or an update.
  let calMonth = null, calDay = null;
  function calendarScreen() {
    const month = calMonth || day().slice(0, 7), C = VGRules.hqCalendar(DATA, STATE.review, month), title = new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const picked = calDay && calDay.startsWith(month) ? calDay : month === day().slice(0, 7) ? day() : null;
    const heads = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<span class="vg-hq-calhead">${d}</span>`).join("");
    const cells = "<span></span>".repeat(C.lead) + C.days.map(d => `<button class="vg-hq-calday${d.date === day() ? " is-today" : ""}${d.date === picked ? " is-picked" : ""}${d.date > day() ? " is-future" : ""}${C.peak && d.done / C.peak > 0.5 ? " is-hot" : ""}" data-calday="${d.date}" aria-pressed="${d.date === picked}" aria-label="${esc(new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { month: "long", day: "numeric" }))}: ${plural(d.done, "thing")} done"
      style="--hq-heat:${C.peak ? Math.round(d.done / C.peak * 100) : 0}%"><span>${d.n}</span>${d.done ? `<b>${d.done}</b>` : ""}<span class="vg-hq-marks">${d.journal ? '<i title="Journal"></i>' : ""}${d.standup ? '<i class="is-s" title="Standup"></i>' : ""}</span></button>`).join("");
    const summary = C.total ? `${plural(C.total, "thing")} done on ${plural(C.worked, "day")}${C.busiest ? ` · busiest ${shortDate(C.busiest.date)} (${C.busiest.done})` : ""}` : "Nothing marked done this month.";
    return `<h1 class="vg-hq-h1">Calendar</h1><div class="vg-hq-calbar"><button class="vg-hq-btn vg-hq-btn-sm" data-calmonth="-1" aria-label="Previous month">${icon("left", 14)}</button><b>${esc(title)}</b><button class="vg-hq-btn vg-hq-btn-sm" data-calmonth="1" aria-label="Next month">${icon("right", 14)}</button>${month !== day().slice(0, 7) ? '<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-calmonth="0">This month</button>' : ""}<span class="vg-hq-lede">${esc(summary)}</span></div>
      <div class="vg-hq-calwrap"><div class="vg-hq-cal">${heads}${cells}</div>${picked ? calendarDay(picked) : `<aside class="vg-hq-calpanel"><p class="vg-hq-lede">Pick a day.</p></aside>`}</div>`;
  }
  function calendarDay(date) {
    const done = VGRules.doneToday(DATA, STATE.review, date), h = hq() || {}, journal = VGRules.canonicalJournal(h, date), standup = VGRules.canonicalDailyPath(h.standups, date, "standup"), open = journal ? (journal.tasks || []).filter(t => t.mark === " ").length : 0, minutes = VGRules.sessionMinutes(STATE.review, date);
    const facts = [plural(done.length, "thing") + " done", ...(open ? [`${open} still open in its journal`] : []), ...(minutes ? [`${VGRules.minutesWords(minutes)} focused`] : [])].join(" · ");
    return `<aside class="vg-hq-calpanel" aria-label="${esc(date)}"><h2>${esc(new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }))}</h2><p class="vg-hq-lede">${esc(facts)}</p>
      <div class="vg-hq-row">${journal && api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(journal.path)}">Open journal</button>` : !journal && api.openDaily && date <= day() ? `<button class="vg-hq-btn vg-hq-btn-sm" data-weekday="${esc(date)}">Create journal</button>` : ""}${standup && api.openNote ? `<button class="vg-hq-btn vg-hq-btn-sm" data-open="${esc(standup)}">Open standup</button>` : ""}${done.length ? `<button class="vg-hq-btn vg-hq-btn-sm vg-hq-btn-ghost" data-calcopy="${esc(date)}">Copy the list</button>` : ""}</div>
      ${done.length ? `<ul class="vg-hq-callist">${done.map(d => `<li>${icon("check", 14)}<span>${esc(d.text)}</span></li>`).join("")}</ul>` : ""}</aside>`;
  }
  async function calendarCopy(date) {
    const text = VGRules.doneToday(DATA, STATE.review, date).map(d => `- ${d.text}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Copied"); } catch (e) { toast("Couldn't copy to the clipboard", null, true); }
  }

