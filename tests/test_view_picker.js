#!/usr/bin/env node
// The View box names the view you are in. A report (lens) sits over the graph, so while one is open the box names the report,
// not the graph under it; closing the report (button or Escape, even with the box focused) names the graph again.
// Found by the persona pass 2026-11-21: first-timer, phone, keyboard and power user all saw "Graph" while a report was open.
//   node tests/test_view_picker.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const D = "window.vaultGraph._debug", ev = e => tab.ev(e);
  const label = () => ev(`(() => { const s = document.querySelector(".vg-viewsel"); return s.selectedOptions[0] ? s.selectedOptions[0].textContent : "(none)"; })()`);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`);
    const graphName = await label();
    check(graphName !== "(none)" && graphName !== "View", `the box should name the starting view (got ${graphName})`);
    for (const k of ["lens:matrix", "lens:stale"]) {
      await ev(`${D}.openView(${JSON.stringify(k)})`); await sleep(500);
      const title = await ev(`document.querySelector(".vg-lens-title").textContent`);
      check(await ev(`!document.querySelector(".vg-lens").hidden`), `${k} should be open (the test can't fail without it)`);
      check(await label() === title, `with ${k} open the box should read "${title}" (got "${await label()}")`);
      await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);   // a late-starting tour takes Escape for itself
      // Escape with the box itself focused, as after choosing a view from it
      await ev(`(() => { const s = document.querySelector(".vg-viewsel"); s.focus(); s.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })()`); await sleep(300);
      check(await ev(`document.querySelector(".vg-lens").hidden`), `Escape in the View box should close ${k}`);
      check(await label() === graphName, `after ${k} closes the box should read "${graphName}" again (got "${await label()}")`);
    }
    await ev(`${D}.openView("lens:stale")`); await sleep(400); await ev(`document.querySelector(".vg-lens-close").click()`); await sleep(300);
    check(await label() === graphName, `closing with the close button should name the graph again (got "${await label()}")`);
    // picking a picture view from the box while a report is open leaves the report behind (persona round 2: it stayed over Radar, Dungeon and Heat clock)
    for (const v of ["subway", "radar"]) {
      await ev(`${D}.openView("lens:matrix")`); await sleep(400);
      check(await ev(`!document.querySelector(".vg-lens").hidden`), "the report should be open before picking " + v);
      await ev(`(() => { const s = document.querySelector(".vg-viewsel"); const o = [...s.options].find(o => o.value === "${v}"); if (!o) return; s.value = o.value; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(500);
      check(await ev(`document.querySelector(".vg-lens").hidden`), "picking " + v + " from the View box should close the open report");
      check(await ev(`document.querySelector(".vg-viewsel").selectedOptions[0].value === "${v}"`), "the box should name " + v);
    }
    // the M shortcut opens the box and must not type "m" into it (persona round 2: it jumped to the first view starting with M)
    await ev(`${D}.openView("2d")`); await sleep(300);
    const before = await ev(`document.querySelector(".vg-viewsel").value`);
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove()); document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
    const prevented = await ev(`(() => { const e = new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }); (document.querySelector(".vg-canvas, canvas") || document.body).dispatchEvent(e); return e.defaultPrevented; })()`); await sleep(200);
    check(prevented, "the M shortcut should stop the key from also being typed into the View box");
    check(await ev(`document.querySelector(".vg-viewsel").value`) === before, "M should leave the view unchanged");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the View box names the open report and the graph again after it closes");
})();
