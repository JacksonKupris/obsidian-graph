#!/usr/bin/env node
// The "Biggest gap" line on the graph names the same pair as the first row of the Biggest gaps list (Neural persona, 0.6.249:
// the line said Rental App and Infrastructure, the list started with Infrastructure and Plan · Marketing).
//   node tests/test_gap_toast_first.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    await tab.ev(`${D}.openView("neural")`); await sleep(1500);
    const today = await tab.ev(`(() => { const e = document.querySelector(".vg-today"); return e ? e.textContent : ""; })()`);
    const first = await tab.ev(`(() => { const e = document.querySelector("[data-panel=insights] .vg-gap"); return e ? e.textContent : ""; })()`);
    check(/Biggest gap/.test(today), "the graph shows a Biggest gap line (the test can't fail without it): " + today.slice(0, 60));
    check(first.length > 0, "the Insights list has gap rows (the test can't fail without them)");
    const pair = (today.match(/Biggest gap:\s*(.+?)\s*↔\s*(.+?)\s*·/) || []).slice(1, 3);
    check(pair.length === 2 && pair.every(n => first.includes(n)), `the line (${pair.join(" ↔ ")}) names the list's first pair: ${first.slice(0, 80)}`);
  } finally { await tab.close(); }
  finish(fails, "the Biggest gap line and the list agree");
})().catch(e => { console.error(e); process.exit(1); });
