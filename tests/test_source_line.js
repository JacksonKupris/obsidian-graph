#!/usr/bin/env node
// Where the numbers come from is said in the view's own toolbar, not only in the side panel's footer (3D explainer, 0.6.242):
// the "Analysed ..." badge carries the date, the daily notes read and the start of the window, the same words as the panel footer.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: false });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await sleep(1500);
    const r = await tab.ev(`(() => { const b = document.querySelector(".vg-badge"), f = document.querySelector(".vg-foot"); return { badge: b && b.getAttribute("title"), foot: f && f.textContent }; })()`);
    assert.ok(r.badge, "the Analysed badge has a tooltip");
    assert.ok(/daily note/.test(r.badge) && /read/.test(r.badge), "the badge says how many daily notes were read: " + r.badge);
    assert.ok(r.foot && r.foot.replace(/ +/g, " ").trim() === r.badge.replace(/ +/g, " ").trim(), "the badge and the panel footer say the same: " + JSON.stringify(r));
    console.log("PASS: the toolbar badge names the source, same words as the footer");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
