#!/usr/bin/env node
// On a phone the View box shows the whole name of the open view (persona round 2: "Attenti", "Topic r", "Timelir") and the toolbar still fits.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    for (const width of [360, 390]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(500);
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(e => e.remove())`);
      for (const v of ["lens:attention", "lens:river", "lens:maptree", "lens:timeline"]) {
        await tab.ev(`${D}.openView(${JSON.stringify(v)})`); await sleep(300);
        const r = await tab.ev(`(() => { const s = document.querySelector(".vg-viewsel"), cs = getComputedStyle(s), c = document.createElement("canvas").getContext("2d"); c.font = cs.fontSize + " " + cs.fontFamily;
          const label = s.options[s.selectedIndex].text, need = c.measureText(label).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 18;
          const bar = s.closest(".vg-toolbar, .vg-bar, .vg-top") || s.parentElement.parentElement; return { label, need: Math.round(need), have: Math.round(s.getBoundingClientRect().width), over: document.documentElement.scrollWidth > innerWidth, right: Math.round(s.getBoundingClientRect().right) }; })()`);
        check(r.have >= r.need, `${width}px: the View box is ${r.have}px but "${r.label}" needs ${r.need}px`);
        check(!r.over && r.right <= width, `${width}px: the toolbar spills past the screen (${JSON.stringify(r)})`);
      }
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the phone View box shows the whole name");
})();
