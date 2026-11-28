#!/usr/bin/env node
// Neural lobe captions do not sit under a ring badge: a number badge is drawn over the captions, so the captions steer around it
// (bewildered persona, phone: "captions run under the rings and can't be read").
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  let seen = 0;
  for (const [w, h, mobile] of [[390, 780, true], [1280, 800, false]]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    try {
      assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
      await tab.ev(`window.vaultGraph._debug.openView("neural")`); await sleep(2500);
      const r = await tab.ev(`(() => { const D = window.vaultGraph._debug, B = D.ringBadges(), S = D.lobeSpots();
        return { badges: B.length, captions: S.length, hits: S.filter(([x, y, w, h]) => B.some(b => b.x + b.r - 6 > x && b.x - b.r + 6 < x + w && b.y + b.r - 6 > y && b.y - b.r + 6 < y + h)) }; })()`);
      assert.ok(r.badges > 0 && r.captions > 0, `${w}px: the test needs badges and captions on screen (${JSON.stringify(r)})`);
      assert.strictEqual(r.hits.length, 0, `${w}px: ${JSON.stringify(r.hits)} of ${r.captions} lobe captions sit under a ring badge`);
      seen++;
    } finally { await tab.close(); }
  }
  assert.strictEqual(seen, 2);
  console.log("PASS: Neural lobe captions steer around ring badges");
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
