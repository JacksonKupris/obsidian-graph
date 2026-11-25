#!/usr/bin/env node
// On a phone the "How to read this" card sits clear of the ? button that opens it and of the bottom screen-style bar, in every view that has one.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
    let seen = 0;
    for (const view of ["neural", "3d", "2d", "subway"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1200);
      const r = await tab.ev(`(() => { const b = document.querySelector(".vg-viewhelp"); if (!b || b.hidden) return null; b.click(); const c = document.querySelector(".vg-viewcard"); if (!c || c.hidden) return { noCard: true };
        const q = s => { const e = document.querySelector(s); if (!e || e.hidden || getComputedStyle(e).display === "none") return null; const x = e.getBoundingClientRect(); return x.height ? x : null; };
        const k = c.getBoundingClientRect(), hit = [".vg-viewhelp", ".vg-vision"].map(s => [s, q(s)]).filter(([, x]) => x && x.left < k.right && x.right > k.left && x.top < k.bottom - 1 && x.bottom > k.top + 1).map(([s]) => s);
        b.click(); return { hit, bottom: Math.round(k.bottom) }; })()`);
      if (!r) continue;
      seen++;
      assert.ok(!r.noCard, view + ": the ? button opens the card");
      assert.ok(!r.hit.length, view + ": the help card covers " + r.hit.join(", ") + " (its bottom is at " + r.bottom + ")");
    }
    assert.ok(seen >= 2, "the test has to see the help card in at least two views, saw " + seen);
    console.log("PASS: the help card is clear of the ? button and the screen-style bar on a phone");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
