  // ---- Focus session: the "Do" of the day's loop. One item, a timer, what your notes know about it, and what's next. The time
  // goes in the shared file (review.sessions) and shows in Wrap up. A session keeps running while you look elsewhere in HQ.
  const SESSION_LENGTHS = [15, 25, 45];
  let session = null, sessionTick = null, sessionLength = 25;
  const sessionMs = () => (session ? session.spent + (session.since ? Date.now() - session.since : 0) : 0);
  const clockOf = ms => { const s = Math.floor(Math.abs(ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  // what the timer reads: time left, then how far over
  const sessionClock = () => { const left = session.length * 60000 - sessionMs(); return left >= 0 ? clockOf(left + 999) : `+${clockOf(left)}`; };
  function sessionPaint() {
    if (!session) return;
    const t = el.querySelector(".vg-hq-timer b"), bar = el.querySelector(".vg-hq-timerbar i"), left = session.length * 60000 - sessionMs(), step = el.querySelector("[data-go='session'] small");
    if (t) t.textContent = sessionClock();
    if (bar) bar.style.width = `${Math.min(100, sessionMs() / (session.length * 60000) * 100)}%`;
    if (step) step.textContent = `${session.since ? "On" : "Paused"} · ${sessionClock()}`;
    if (left < 0 && !session.over) { session.over = true; toast(`${session.length} minutes are up`); if (cur === "session") render(); }
  }
  function sessionStart(key) {
    compute();
    const it = BY_KEY.get(key) || (session && BY_KEY.get(session.key)) || doNext();
    if (session && it && session.key !== it.key) sessionLog();
    if (it && (!session || session.key !== it.key)) session = { key: it.key, title: it.title, length: sessionLength, spent: 0, logged: 0, since: Date.now(), over: false };
    clearInterval(sessionTick); sessionTick = setInterval(sessionPaint, 1000);
    setScreen("session");
  }
  // whole minutes not yet on record, in the shared file
  function sessionLog() {
    if (!session || !api.hqSession) return;
    const minutes = Math.floor(sessionMs() / 60000) - session.logged; if (minutes < 1) return;
    session.logged += minutes;
    const it = BY_KEY.get(session.key), th = it && threads().find(t => t.items.includes(it)), project = th && th.project ? th.project.path : (it && it.kind === "approval" ? it.path : null);
    const review = STATE.review || {};
    STATE = { ...STATE, review: { ...review, sessions: VGRules.sessionAdded(review, day(), minutes), ...(project ? { sessionFor: { ...(review.sessionFor || {}), [project]: VGRules.projectMinutes(review, project) + minutes } } : {}) } };
    api.hqSession(day(), minutes, project);
  }
  function sessionEnd() { const spent = sessionMs(); sessionLog(); session = null; clearInterval(sessionTick); sessionTick = null; const whole = Math.floor(spent / 60000); toast(whole ? `Focused ${VGRules.minutesWords(whole)}` : "Session ended"); setScreen("today"); }
  // what comes after this item: the rest of today's focus, then the next thing today
  const sessionUpNext = () => { const here = session && session.key, list = [...focus(), ...ofGroup("today")]; return [...new Set(list)].filter(it => it.key !== here); };
  function sessionNext() {
    if (!session) return;
    const next = sessionUpNext()[0];
    if (!next) { sessionEnd(); return; }
    sessionLog(); session = { key: next.key, title: next.title, length: sessionLength, spent: 0, logged: 0, since: Date.now(), over: false }; render();
  }
  function sessionPause() { if (!session) return; if (session.since) { session.spent += Date.now() - session.since; session.since = null; } else session.since = Date.now(); render(); }
  function sessionSetLength(mins) { sessionLength = mins; if (session) { session.length = mins; session.over = false; } render(); }
  const sessionButton = (it, big) => api.hqSession && it && it.group === "today" ? `<button class="vg-hq-btn${big ? "" : " vg-hq-btn-sm"} vg-hq-focusbtn" data-session="${esc(it.key)}" title="Work on this with a timer (s)">${icon("clock", 14)} Focus</button>` : "";
  function sessionScreen() {
    const it = session && BY_KEY.get(session.key);
    if (session && !it) { const next = sessionUpNext()[0]; if (next) { sessionLog(); session = { key: next.key, title: next.title, length: sessionLength, spent: 0, logged: 0, since: Date.now(), over: false }; return sessionScreen(); } }
    if (!it) { const first = doNext(); return `<h1 class="vg-hq-h1">Focus</h1>` + (first ? `<div class="vg-hq-row">${sessionButton(first, true)}</div><p class="vg-hq-lede">Next up: ${esc(first.title)}</p>` : empty("Nothing open to focus on.", [["Today", 'data-go="today"'], ...(api.openDaily ? [["Open today's journal", "data-daily"]] : [])])); }
    const up = sessionUpNext().slice(0, 3), paused = !session.since;
    return `<section class="vg-hq-session" data-key="${esc(it.key)}"><div class="vg-hq-eyebrow">${paused ? "Paused" : "Focus"}</div>
      <h1 class="vg-hq-session-title">${esc(it.title)}</h1>${it.why ? `<p class="vg-hq-lede">${esc(it.why)}</p>` : ""}
      <div class="vg-hq-timer${paused ? " is-paused" : ""}${session.over ? " is-over" : ""}" role="timer" aria-label="Time left"><b>${sessionClock()}</b></div>
      <div class="vg-hq-timerbar"><i style="width:${Math.min(100, sessionMs() / (session.length * 60000) * 100)}%"></i></div>
      <div class="vg-hq-session-ctl"><button class="vg-hq-btn" data-sessionctl="pause">${paused ? "Resume" : "Pause"}</button>
        <span class="vg-hq-seg" role="group" aria-label="Length">${SESSION_LENGTHS.map(m => `<button class="vg-hq-filter${session.length === m ? " is-on" : ""}" data-sesslen="${m}" aria-pressed="${session.length === m}">${m}m</button>`).join("")}</span>
        <button class="vg-hq-btn vg-hq-btn-ghost" data-sessionctl="end">End session</button></div>
      <div class="vg-hq-next vg-hq-item vg-hq-session-acts" data-key="${esc(it.key)}"><div class="vg-hq-row">${starButton(it)}${buttons(it, true)}${up.length ? `<button class="vg-hq-btn vg-hq-btn-ghost" data-sessionctl="next">Skip to next</button>` : ""}</div></div>
      ${contextPanel(it, true)}
      ${up.length ? `<section class="vg-hq-sec"><h3>Up next<span>${sessionUpNext().length}</span></h3>${up.map(n => `<button class="vg-hq-link" data-session="${esc(n.key)}">${esc(n.title)}<small>${esc(n.why || "")}</small></button>`).join("")}</section>` : ""}</section>`;
  }

