#!/usr/bin/env node
// The Insights "Since last run" card with no earlier snapshot is not a dead end: it says what is missing and offers the
// Timeline, and the button works from the side panel. Found by audit:views, which saw the same bare message in every view.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const data = env.data(); data.changes = {};   // no snapshot to compare with
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`window.vaultGraph._debug.setView("2d")`); await sleep(500);
    await tab.ev(`(document.querySelector('.vg-tab[data-tab="insights"]') || {click(){}}).click()`); await sleep(300);
    const card = await tab.ev(`(() => { const e = [...document.querySelectorAll('.vg-panel[data-panel="insights"] .vg-card')].find(c => /Since last run/.test(c.textContent)); if (!e) return null;
      return { text: e.querySelector(".vg-empty") ? e.querySelector(".vg-empty").textContent : "", buttons: [...e.querySelectorAll(".vg-empty-next button")].map(b => b.dataset.relens || b.dataset.next) }; })()`);
    assert.ok(card, "the Since last run card must be there");
    assert.ok(!/snapshot saved today/i.test(card.text) && card.text.length > 0, "the empty state says what is missing: " + card.text);
    assert.ok(card.buttons.includes("timeline"), "the empty state offers the Timeline: " + JSON.stringify(card.buttons));
    await tab.ev(`document.querySelector('.vg-panel[data-panel="insights"] .vg-empty-next [data-relens="timeline"]').click()`); await sleep(600);
    assert.ok(await tab.ev(`!!document.querySelector(".vg-lens:not([hidden])")`), "the button must open the Timeline lens");
    console.log("ok - Insights with no earlier snapshot offers the Timeline, and it opens");
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
