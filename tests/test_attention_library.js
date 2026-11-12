#!/usr/bin/env node
// The attention ring reaches the views the graphs library draws (slime mould, load paths, normal modes, light cones): the
// plugin hands the flagged notes to the library (handle.mark), which rings them and adds one legend item. The Show switch
// (Display tab, "Needs attention") is the same one the plugin's own views use, so turning it off clears these too.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
const rings = `[...document.querySelectorAll(".vg-lib .vgv-labels > div")].filter(e => e.style.display !== "none" && e.style.width).length`;
const legend = `[...document.querySelectorAll(".vg-lib .vgv-mark")].length`;
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const flagged = await tab.ev(`window.vaultGraph._debug.attention().length`);
    assert.ok(flagged > 0, "the sample vault must have flagged notes");
    const seen = [];
    for (const view of ["slime", "loadpaths", "modes", "cones"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(2000);
      const n = await tab.ev(rings);
      assert.ok(n > 0, view + ": flagged notes must be ringed by the library (saw " + n + " of " + flagged + " flagged)");
      assert.strictEqual(await tab.ev(legend), 1, view + ": one legend item explains the ring");
      seen.push(view + " " + n);
    }
    await tab.ev(`(() => { const cb = document.querySelector(".vg-l-attention"); cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(900);
    assert.strictEqual(await tab.ev(rings), 0, "with the switch off the library draws no ring");
    assert.strictEqual(await tab.ev(legend), 0, "and drops the legend item");
    console.log("ok - the attention ring reaches the library views (" + seen.join(", ") + "), and the switch clears it");
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
