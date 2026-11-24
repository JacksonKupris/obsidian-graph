#!/usr/bin/env node
// A stat tile that opens another view says so (3D persona round, 0.6.242: "Show 3 gaps" switched to the topic matrix without saying).
//   node tests/test_tile_names_view.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(2000);
    const t = await tab.ev(`(() => { const o = {}; document.querySelectorAll("[data-stat]").forEach(b => o[b.dataset.stat] = b.getAttribute("title") || ""); return o; })()`);
    check(t.gaps !== undefined && t.unlinked !== undefined, "the gaps and unlinked tiles exist (the test can't fail without them): " + JSON.stringify(t));
    check(/matrix/i.test(t.gaps || ""), "the gaps tile says it opens the topic matrix: " + JSON.stringify(t.gaps));
    check(/list/i.test(t.unlinked || ""), "the unlinked tile says it opens a list: " + JSON.stringify(t.unlinked));
  } finally { await tab.close(); }
  finish(fails, "tiles that open a view name it");
})().catch(e => { console.error(e); process.exit(1); });
