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
      // the very first frame after the view turns: the badges have moved, and the captions of that frame must already clear them
      const turned = await tab.ev(`(() => { const D = window.vaultGraph._debug, over = ([x, y, w, h]) => D.ringBadges().some(b => b.x + b.r - 6 > x && b.x - b.r + 6 < x + w && b.y + b.r - 6 > y && b.y - b.r + 6 < y + h);
        const bad = []; for (let i = 1; i <= 24; i++) { D.cam.yaw += 0.5; D.drawNow(); const n = D.lobeSpots().filter(over).length; if (n) bad.push([i, n]); } return bad; })()`);
      assert.deepStrictEqual(turned, [], `${w}px: captions under a badge on the first frame after a turn [turn, captions]`);
      // rings switched off: no unseen badge stays behind to block a caption or catch a tap
      const off = await tab.ev(`(() => { const D = window.vaultGraph._debug; D.st.layers.attention = false; D.drawNow(); D.drawNow(); const n = D.ringBadges().length; D.st.layers.attention = true; return n; })()`);
      assert.strictEqual(off, 0, `${w}px: hidden rings left ${off} badges behind`);
      seen++;
    } finally { await tab.close(); }
  }
  assert.strictEqual(seen, 2);
  console.log("PASS: Neural lobe captions steer around ring badges");
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
