#!/usr/bin/env node
// A narrow pane is not only a phone: an Obsidian side pane or a small window is 360-460 px wide on a computer, where the page is not
// flagged as mobile. The toolbar has to fit there too: nothing runs past the pane's right edge.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  for (const w of [460, 390, 360]) {
    const tab = await openPage({ html: env.pageWith(""), mobile: false });
    try {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: 844, deviceScaleFactor: 2, mobile: false });
      check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
      await sleep(1200);
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
      const r = await tab.ev(`(() => { const W = document.querySelector(".vg-root").getBoundingClientRect().width, all = [...document.querySelectorAll(".vg-toolbar button, .vg-toolbar select")].filter(e => !e.closest("[hidden]") && e.getBoundingClientRect().width > 0);
        return { W, n: all.length, past: all.filter(e => e.getBoundingClientRect().right > W + 1).map(e => (e.getAttribute("aria-label") || e.className).toString().slice(0, 24) + " ends at " + Math.round(e.getBoundingClientRect().right)) }; })()`);
      check(r.n >= 3, `${w}px: the toolbar must have its controls (${r.n})`);
      check(!r.past.length, `${w}px wide pane (not flagged mobile): the toolbar runs past the edge: ${r.past.join(", ")}`);
    } finally { await tab.close(); }
  }
  finish(fails, "the toolbar fits a narrow pane on a computer");
})();
