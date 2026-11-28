#!/usr/bin/env node
// The Neural legend says how far back "recent" reaches for the pulses (explainer persona: "pulse · recent activity" with no day window).
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const data = env.data(), days = data.recent_days;
  assert.ok(days > 0, "the sample has a recent window to name");
  const tab = await openPage({ html: env.pageWith("", data), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`window.vaultGraph._debug.openView("neural")`); await sleep(1500);
    const t = await tab.ev(`[...document.querySelectorAll(".vg-legend .vg-lg-item")].map(e => e.textContent).find(x => /pulse/.test(x)) || ""`);
    assert.ok(t, "the legend has a pulse entry (the test can't fail without it)");
    assert.ok(new RegExp(`${days} days`).test(t), "the pulse entry names the window (" + days + " days): " + t);
    console.log("PASS: the pulse legend names its day window");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
