#!/usr/bin/env node
// A lens that fails to load shows the reason and a button that tries it again, not a dead end.
// Found by audit:views (next): the failure message had no button. The lens's load() is made to fail on the real page.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const had = await tab.ev(`(() => { const L = window.vaultGraph._debug.lensDefs(); L.drift.__load = L.drift.load; L.drift.load = () => Promise.reject(new Error("boom")); return typeof L.drift.__load; })()`);
    assert.strictEqual(had, "function", "the Version drift lens must have a load() to fail");
    await tab.ev(`window.vaultGraph._debug.openView("lens:drift")`); await sleep(600);
    const failed = await tab.ev(`(() => { const e = document.querySelector(".vg-lens-body .vg-empty"); return e && { text: e.textContent, next: document.querySelectorAll(".vg-lens-body .vg-empty-next button").length }; })()`);
    assert.ok(failed && /didn't load: boom/.test(failed.text), "the failure and its reason must show: " + JSON.stringify(failed));
    assert.ok(failed.next >= 1, "the failure must offer a button");
    await tab.ev(`(() => { const L = window.vaultGraph._debug.lensDefs(); L.drift.load = L.drift.__load; })()`);
    await tab.ev(`document.querySelector(".vg-lens-body [data-relens]").click()`); await sleep(900);
    const after = await tab.ev(`document.querySelector(".vg-lens-body").textContent`);
    assert.ok(!/didn't load/.test(after) && !/^Loading…/.test(after.trim()), "the button must try the lens again: " + after.slice(0, 80));
    console.log("ok - a lens that fails to load shows why and offers to try again");
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
