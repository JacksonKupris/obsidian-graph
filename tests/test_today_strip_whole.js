#!/usr/bin/env node
// The Biggest gap line shows its whole sentence without a tap, on a phone and on a desktop: it used to be cut after the pair's names
// ("Rental App ↔ Infrastruct…") so the evidence ("named together in 7 daily notes") never showed (three personas, two rounds).
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  for (const [w, h, mobile] of [[390, 844, true], [1280, 800, false]]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    try {
      assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(500);
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
      for (const view of ["3d", "neural", "2d"]) {
        await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
        const r = await tab.ev(`(() => { const t = document.querySelector(".vg-today-text"); if (!t || t.closest("[hidden]")) return null; t.closest(".vg-today").classList.remove("is-open");
          return { full: t.textContent, clippedX: t.scrollWidth > t.clientWidth + 1, clippedY: t.scrollHeight > t.clientHeight + 1 }; })()`);
        assert.ok(r && /Biggest gap/.test(r.full), w + " " + view + ": the strip is showing");
        assert.ok(!r.clippedX && !r.clippedY, w + " " + view + ": the whole sentence shows without a tap: " + JSON.stringify(r));
      }
    } finally { await tab.close(); }
  }
  console.log("PASS: the Biggest gap sentence shows whole at phone and desktop width");
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
