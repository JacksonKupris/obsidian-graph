#!/usr/bin/env node
// The one time-lapse in every view: it opens from the toolbar's tool, plays, pauses, the slider jumps to any point, and
// at that point no view draws a note that didn't exist yet; the end is the whole vault, and Close comes back to now.
//   node tests/test_timelapse.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.page() });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug", q = s => `document.querySelector(${JSON.stringify(s)})`;
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove())`);
    check(await tab.ev(`!${q(".vg-replaybtn")} && !${q(".vg-replay")}`), "there's still a second control");
    // on one view: opening plays
    // a library view draws on its own canvas and has no layout here to count (its time-lapse is a separate item, listed in the plan note)
    const views = await tab.ev(`${D}.views().filter(v => !(${D}.scenes()[v] || {}).game && !(${D}.scenes()[v] || {}).lib)`);
    const key = k => tab.ev(`${q(".vg-root")}.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
    await key("t"); await sleep(50);
    check(await tab.ev(`!${q(".vg-timebar")}.hidden`), "T didn't open the bar"); check(await tab.ev(`!!${D}.replay() && ${D}.replay().playing`), "opening didn't play");
    await tab.ev(`${q(".vg-time-play")}.click()`); check(await tab.ev(`!${D}.replay().playing`), "the button didn't pause");
    await tab.ev(`${q(".vg-time-close")}.click()`); check(await tab.ev(`!${D}.replay() && ${q(".vg-timebar")}.hidden`), "Close didn't close");
    // on every view: part way through, nothing newer than that point is drawn; at the end, everything is back
    const out = [], counts = n => `(${D}.drawNow(), [...${D}.P.keys()].filter(id => ${D}.P.get(id).a > 0.15).length)`;
    for (const v of views) {
      await tab.ev(`${D}.setView(${JSON.stringify(v)})`); await sleep(1100);
      const full = await tab.ev(counts());
      await tab.ev(`${q(".vg-maptime")}.click()`);
      const res = await tab.ev(`(() => { const r = ${q(".vg-timebar input")}, R = ${D}.replay(); if (!R) return { noReplay: true };
        ${q(".vg-time-play")}.click(); r.value = Math.floor(R.order.length * 0.3); r.dispatchEvent(new Event("input"));
        ${D}.drawNow(); const shown = new Set(R.order.slice(0, R.k)), drawn = [...${D}.P.keys()].filter(id => ${D}.P.get(id).a > 0.15); return { future: drawn.filter(id => !shown.has(id) && !(${D}.nodes.find(n => n.id === id) || {}).ghost).length, drawn: drawn.length, at: ${D}.st.timeAt, label: ${q(".vg-time-label")}.textContent }; })()`);
      if (res.noReplay) { out.push(`${v}: didn't open`); continue; }
      if (res.future) out.push(`${v}: draws ${res.future} notes from the future`);
      if (full > 20 && res.drawn >= full) out.push(`${v}: draws ${res.drawn} of ${full} at 30%: time changes nothing`);
      if (!res.at) out.push(`${v}: no date at 30%`);
      const end = await tab.ev(`(() => { const r = ${q(".vg-timebar input")}; r.value = r.max; r.dispatchEvent(new Event("input")); ${D}.drawNow(); return { label: ${q(".vg-time-label")}.textContent, at: ${D}.st.timeAt }; })()`);
      if (end.at || !/^Now/.test(end.label)) out.push(`${v}: the end isn't now (${end.label})`);
      await tab.ev(`${q(".vg-time-close")}.click()`); await sleep(20);
      const back = await tab.ev(counts());
      if (back < full) out.push(`${v}: after Close draws ${back} of ${full}`);
    }
    out.forEach(x => fails.push(x));
    // closing while a view is still changing: the layout catches up when the change lands, not stuck in the past
    await tab.ev(`${D}.setView("2d")`); await sleep(300);
    const fullRings = await tab.ev(`(() => { ${D}.setView("weather"); const r = ${q(".vg-timebar input")}; ${q(".vg-maptime")}.click(); ${q(".vg-time-play")}.click(); r.value = 40; r.dispatchEvent(new Event("input")); ${q(".vg-time-close")}.click(); return ${D}.nodes.filter(n => n.born).length; })()`);
    await sleep(1500); const ringsBack = await tab.ev(counts());
    check(ringsBack > fullRings * 0.5, `closing during a view change left weather drawing ${ringsBack} of about ${fullRings}`);
    // the game can't be time-lapsed, and going into it closes the bar
    await tab.ev(`${q(".vg-maptime")}.click(); ${D}.setView("dungeon")`); await sleep(50);
    check(await tab.ev(`!${D}.replay() && ${q(".vg-timebar")}.hidden`), "the game view left the time-lapse open"); await tab.ev(`${D}.setView("2d")`);
    const errs = await tab.ev("window.__errs");
    check(!errs.length, "page errors: " + errs.join("; "));
    console.log(`  time-lapse: ${views.length} views`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "time-lapse: one control, every view, nothing from the future, Close comes back to now", "time-lapse");
})();
