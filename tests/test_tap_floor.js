#!/usr/bin/env node
// The row buttons and chips the lenses draw are at least 24 px tall on a desktop (view.css, --vg-hit-min).
// Found by audit:views: river, timeline, matrix, folders, ring, people and path drew 14-23 px controls. The rendered size is read
// from the page, so a lens that stops using the shared rule fails here.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
const LENS_FLOOR = ".vg-mx-name, .vg-tl-label, .vg-rv-chip, button.vg-fd-name, .vg-rp-pick, .vg-fd-bar button";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);   // the first-run tour sits over the lens, as in audit:views
    let seen = 0;
    for (const key of ["river", "timeline", "matrix", "folders", "ring", "people", "path"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify("lens:" + key)})`); await sleep(900);
      const r = await tab.ev(`(() => [...document.querySelectorAll(${JSON.stringify(LENS_FLOOR)})].filter(e => e.getBoundingClientRect().width > 0).map(e => ({ h: Math.round(e.getBoundingClientRect().height), c: String(e.className).split(" ")[0] })))()`);
      seen += r.length;
      const small = r.filter(x => x.h < 24);
      assert.strictEqual(small.length, 0, `${key}: controls under 24 px: ` + JSON.stringify(small.slice(0, 4)));
    }
    await tab.ev(`window.vaultGraph._debug.setView("neural")`); await sleep(900);
    const vis = await tab.ev(`[...document.querySelectorAll(".vg-visbtn")].filter(e => e.getBoundingClientRect().width > 0).map(e => Math.round(e.getBoundingClientRect().height))`);
    assert.ok(vis.length > 0, "the neural style buttons must be on the page");
    assert.ok(vis.every(h => h >= 24), "neural style buttons under 24 px: " + vis);
    assert.ok(seen > 10, "the lenses must have drawn controls to measure (saw " + seen + ")");
    console.log(`ok - lens row buttons and neural style buttons are 24 px or taller (${seen} lens controls measured)`);
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
