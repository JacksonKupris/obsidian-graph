#!/usr/bin/env node
// The strip under the toolbar (Today: the biggest gap and its button) and the status pill ("49 notes · 6 maps") are two overlays on the same edge.
// They must not lie over each other, on a computer or a phone, whether or not the first-run tour is showing.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
(async () => {
  for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true]]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    try {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
      check(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`); await sleep(1500);
      const r = await tab.ev(`(() => { const box = s => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetWidth) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        return { today: box(".vg-today"), status: box(".vg-status"), legend: box(".vg-legend"), bar: box(".vg-toolbar") }; })()`);
      check(!!r.today, `${w}px: the page must show the Today strip, or this test reads nothing`);
      check(!!r.status, `${w}px: the page must show the status pill, or this test reads nothing`);
      check(!hit(r.today, r.status), `${w}px: the status pill lies over the Today strip: ${JSON.stringify([r.today, r.status])}`);
      check(!hit(r.today, r.bar), `${w}px: the Today strip lies over the toolbar`);
    } finally { await tab.close(); }
  }
  finish(fails, "the Today strip and the status pill do not overlap");
})();
