#!/usr/bin/env node
// The "needs attention" legend entry says what the ring's number counts and what its colours mean, in words on screen (not only in a
// hover tooltip, which a phone never shows). Three personas on the 3D view: "the numbers on the rings are never defined".
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const view of ["2d", "3d", "neural"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
      const t = await tab.ev(`(() => { const e = document.querySelector(".vg-legend .vg-lg-attn-set"); return e ? e.textContent.replace(/\\s+/g, " ").trim() : null; })()`);
      assert.ok(t, view + ": the legend carries the needs-attention entry");
      assert.ok(/number/i.test(t) && /notes?/i.test(t), view + ': the entry says what the number counts, in its visible text: "' + t + '"');
      assert.ok(/colou?r/i.test(t), view + ': the entry says the colour is the reason, in its visible text: "' + t + '"');
    }
    console.log("PASS: the ring legend says what its number and colours mean");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
