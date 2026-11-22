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
      // Escape with the box itself focused, as after choosing a view from it
      await ev(`(() => { const s = document.querySelector(".vg-viewsel"); s.focus(); s.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })()`); await sleep(300);
      check(await ev(`document.querySelector(".vg-lens").hidden`), `Escape in the View box should close ${k}`);
      check(await label() === graphName, `after ${k} closes the box should read "${graphName}" again (got "${await label()}")`);
    }
    await ev(`${D}.openView("lens:stale")`); await sleep(400); await ev(`document.querySelector(".vg-lens-close").click()`); await sleep(300);
    check(await label() === graphName, `closing with the close button should name the graph again (got "${await label()}")`);
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the View box names the open report and the graph again after it closes");
})();
