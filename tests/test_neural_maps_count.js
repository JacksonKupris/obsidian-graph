#!/usr/bin/env node
// Neural view: the header's MAPS count is the same number the status line gives as "N maps" (bewildered persona, 0.6.249: MAPS 4 beside 6 maps).
//   node tests/test_neural_maps_count.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    await tab.ev(`${D}.openView("neural")`); await sleep(1500);
    const hdr = await tab.ev(`[...document.querySelectorAll("span")].filter(s => /LOBES/.test(s.textContent) && s.children.length === 0).map(s => s.textContent).join(" ")`);
    const bar = await tab.ev(`(document.querySelector(".vg-status") || {}).textContent || ""`);
    const head = (hdr.match(/MAPS\s*(\d+)/) || [])[1], stat = (bar.match(/(\d+) maps?\b/i) || [])[1];
    check(!!head, "the Neural header shows MAPS n (the test can't fail without it)");
    check(!!stat, "the status line shows N maps (the test can't fail without it)");
    check(head === stat, `header MAPS ${head} vs status ${stat} maps`);
  } finally { await tab.close(); }
  finish(fails, "the header and the status count the same maps");
})().catch(e => { console.error(e); process.exit(1); });
