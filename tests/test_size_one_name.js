#!/usr/bin/env node
// A node's size has one name on every screen: "influence" (the dropdown, the sidebar and the note card already say it). The legend used to say
// "routes through it" and the 3D help card "How many routes...", so one number had two names (explainer persona, two rounds).
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
      const legend = await tab.ev(`(() => { const e = document.querySelector(".vg-legend"); return e ? e.textContent.replace(/\\s+/g, " ").trim() : ""; })()`);
      assert.ok(/most connecting/i.test(legend), view + ': the legend names the size "most connecting": "' + legend + '"');
      assert.ok(!/routes through it/i.test(legend), view + ": the legend has no second name for it: " + legend);
    }
    await tab.ev(`window.vaultGraph._debug.openView("3d")`); await sleep(800);
    await tab.ev(`(() => { const b = document.querySelector(".vg-viewhelp"); if (b) b.click(); })()`); await sleep(400);
    const card = await tab.ev(`(() => { const e = document.querySelector(".vg-viewcard"); return e ? e.textContent.replace(/\\s+/g, " ") : ""; })()`);
    assert.ok(/Size[^.]*most connecting/i.test(card), 'the 3D help card says size is "most connecting": ' + card);
    console.log("PASS: size is called influence in the legend and the help card");
  } finally { await tab.close(); }
})().catch(e => { console.error("FAIL: " + e.message); process.exit(1); });
