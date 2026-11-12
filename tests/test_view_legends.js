#!/usr/bin/env node
// Every view says what it shows: a hint in the registry, and a legend on screen for each canvas view (cas9-lib, genome-lib,
// survivors, triage and wikirace had none). Reads the real page, one view at a time, so a new view without a legend fails here.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    const D = "window.vaultGraph._debug";
    const views = await tab.ev(`${D}.allViews()`);
    assert.ok(views.length > 40, "the registry must list the views (saw " + views.length + ")");
    const noHint = views.filter(v => !v.hint || v.hint.length < 9).map(v => v.key);
    assert.deepStrictEqual(noHint, [], "views with no hint: " + noHint);
    const bare = []; let checked = 0;
    for (const v of views.filter(v => v.kind !== "lens")) {
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove()); ${D}.setView(${JSON.stringify(v.key)})`); await sleep(v.key.endsWith("-lib") ? 1900 : 500);
      await tab.ev(`${D}.drawNow && ${D}.drawNow()`); await sleep(100);
      const text = await tab.ev(`((document.querySelector(".vg-legend") || {}).textContent || "").trim()`);
      checked++; if (!text) bare.push(v.key);
    }
    assert.ok(checked > 20, "the canvas views must have been opened (checked " + checked + ")");
    assert.deepStrictEqual(bare, [], "canvas views with an empty legend: " + bare);
    console.log(`ok - every view has a hint and all ${checked} canvas views show a legend`);
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
