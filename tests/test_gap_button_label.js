#!/usr/bin/env node
// The Biggest gap strip's button says what it shows: "Show both topics", not a bare "Show both" (bewildered persona: both of what?).
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 1, mobile: true });
    await tab.ev(`window.vaultGraph._debug.openView("neural")`); await sleep(1500);
    const r = await tab.ev(`(() => { const s = document.querySelector(".vg-today"), b = document.querySelector(".vg-today-act"); return s && !s.hidden && b ? { label: b.textContent, text: s.textContent, right: b.getBoundingClientRect().right, w: innerWidth } : null; })()`);
    assert.ok(r && /Biggest gap/.test(r.text), "the sample has a biggest-gap strip (the test can't fail without it)");
    assert.strictEqual(r.label, "Show both topics");
    assert.ok(r.right <= r.w, "the longer button still fits a phone: " + r.right + " of " + r.w);
    console.log("PASS: the gap button says it shows both topics");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
