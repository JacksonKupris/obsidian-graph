#!/usr/bin/env node
// "How to read this" closes with Escape like every other layer (bewildered persona: Escape did not close it). The button's aria-expanded follows.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    let seen = 0;
    for (const view of ["3d", "neural"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1000);
      const has = await tab.ev(`(() => { const b = document.querySelector(".vg-viewhelp"); if (!b || b.hidden) return false; b.click(); return !document.querySelector(".vg-viewcard").hidden; })()`);
      if (!has) continue;
      seen++;
      await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
      const r = await tab.ev(`JSON.stringify({ hidden: document.querySelector(".vg-viewcard").hidden, ex: document.querySelector(".vg-viewhelp").getAttribute("aria-expanded") })`);
      assert.deepStrictEqual(JSON.parse(r), { hidden: true, ex: "false" }, view + ": Escape closes the card and the button says so: " + r);
    }
    assert.ok(seen >= 1, "at least one view showed the help card");
    console.log("PASS: Escape closes How to read this (" + seen + " views)");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
