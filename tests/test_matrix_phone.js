#!/usr/bin/env node
// Topic matrix on a phone: the row names don't eat the screen, the row names stay while it scrolls, and a cue says there are more columns (persona round 3, phone).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await ev(`window.vaultGraph._debug.openView("lens:matrix")`); await sleep(1500);
    const r = await ev(`(() => { const w = document.querySelector(".vg-mx-wrap"); if (!w) return null; const wr = w.getBoundingClientRect();
      const row = document.querySelector(".vg-mx-row"), cols = [...document.querySelectorAll(".vg-mx-cell")].filter(c => { const b = c.getBoundingClientRect(); return b.right <= wr.right + 1 && b.left >= wr.left; });
      return { scrolls: w.scrollWidth > w.clientWidth + 2, rowW: Math.round(row.getBoundingClientRect().width), sticky: getComputedStyle(row).position, edge: /gradient/.test(getComputedStyle(w).backgroundImage), firstRowCells: new Set(cols.map(c => Math.round(c.getBoundingClientRect().left))).size }; })()`);
    check(!!r, "the matrix opens");
    if (r) {
      check(r.rowW <= 140, "row names should take at most 140 px on a phone (got " + r.rowW + ")");
      check(r.sticky === "sticky", "row names stay while the columns scroll (got " + r.sticky + ")");
      check(r.edge, "the scrolling area has an edge cue for more columns");
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Topic matrix reads on a phone");
})();
