#!/usr/bin/env node
// On a phone, the legend is not lost: every canvas view that has one shows a Key button, the button opens the legend, a second
// tap and Escape close it. (The legend used to be hidden under 460 px wide, so a phone had no key to what the colours mean.)
// Neural and Cosmos draw their own labels and hide the legend on every screen; they are the only exceptions.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const OWN_LABELS = ["neural", "cosmos"];
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true }), D = "window.vaultGraph._debug";
  try {
    check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    const views = (await tab.ev(`${D}.allViews()`)).filter(v => v.kind !== "lens" && !OWN_LABELS.includes(v.key));
    check(views.length > 20, "the sweep must find the canvas views: " + views.length);
    const state = () => tab.ev(`(() => { const l = document.querySelector(".vg-legend"), k = document.querySelector(".vg-legend-key");
      const seen = e => { if (!e) return false; const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== "none" && cs.visibility !== "hidden" && b.width > 8 && b.height > 8 && b.right <= innerWidth + 1; };
      return { legend: seen(l), key: seen(k), text: ((l || {}).textContent || "").trim().length }; })()`);
    for (const v of views) {
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove()); ${D}.setView(${JSON.stringify(v.key)})`); await sleep(v.key.endsWith("-lib") ? 1900 : 500);
      await tab.ev(`${D}.drawNow && ${D}.drawNow()`); await sleep(100);
      let s = await state(); if (!s.text) continue;   // test_view_legends.js holds every view to having one
      if (!s.legend) {
        check(s.key, `${v.key}: the legend is hidden on a phone and there is no Key button`);
        if (!s.key) continue;
        await tab.ev(`document.querySelector(".vg-legend-key").click()`); await sleep(200);
        check((await state()).legend, `${v.key}: the Key button doesn't open the legend`);
        await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(200);
        check(!(await state()).legend, `${v.key}: Escape doesn't close the legend`);
      }
    }
  } finally { await tab.close(); }
  finish(fails, "On a phone every canvas view's legend opens from a Key button and Escape closes it");
})();
