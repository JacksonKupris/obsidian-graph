#!/usr/bin/env node
// One gap list: the stat tile, the Biggest gaps card and the Topic matrix name the same pairs (3D persona round, 0.6.242: the tile said 8,
// the card 5 + "Show 3 gaps", the matrix listed 6 and coloured 10 cells red, one of them a pair no list named).
//   node tests/test_gap_counts.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const data = env.data(), gaps = data.gaps || [];
  const shown = new Set(data.clusters.filter(c => c.size >= 5).map(c => c.id));
  const want = gaps.filter(g => shown.has(g.a) && shown.has(g.b) && g.comentions > 0).map(g => Math.min(g.a, g.b) + "|" + Math.max(g.a, g.b)).sort();
  check(want.length > 0, "the sample has gaps between topics the matrix shows (the test can't fail without them)");
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(2000);
    await tab.ev(`${D}.openView("lens:matrix")`); await sleep(1500);
    const red = await tab.ev(`(() => { const s = new Set(); document.querySelectorAll(".vg-mx-cell").forEach(b => { if (!/vg-gap/.test(b.getAttribute("style") || "")) return; const [a, c] = b.dataset.cell.split(",").map(Number); s.add(Math.min(a, c) + "|" + Math.max(a, c)); }); return [...s].sort(); })()`);
    check(JSON.stringify(red) === JSON.stringify(want), "red cells are exactly the analysis's gaps: red " + JSON.stringify(red) + " vs gaps " + JSON.stringify(want));
    const listed = await tab.ev(`document.querySelectorAll(".vg-lens-body .vg-gaprow").length`);
    check(listed === want.length, `the matrix's Biggest gaps lists every gap it colours (${listed} vs ${want.length})`);
  } finally { await tab.close(); }
  finish(fails, "stat, card and matrix agree on the gaps");
})().catch(e => { console.error(e); process.exit(1); });
