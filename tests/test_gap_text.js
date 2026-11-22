#!/usr/bin/env node
// A "gap" is two topics talked about together but barely linked. Every place that lists gaps says so the same way (VGShared.gapWhy),
// and the matrix's "Biggest gaps" never lists a pair nobody has talked about together.
// Found by the persona pass 2026-11-21: "0 co-mentions · only 21 links" was listed as a gap for the best-linked pair on the real vault.
//   node tests/test_gap_text.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`${D}.openView("lens:matrix")`); await sleep(600);
    const rows = await tab.ev(`[...document.querySelectorAll(".vg-lens-body .vg-gaprow .vg-item-sub")].map(x => x.textContent)`);
    check(rows.length > 0, "the matrix should list at least one gap on this data (the check can't fail without one)");
    for (const t of rows) {
      check(!/^0 co-mentions/.test(t), `a gap needs co-mentions, got "${t}"`);
      const m = /^(\d+) co-mentions in your dailies, (only )?(\d+) links?$/.exec(t);
      check(!!m, `gap text should come from one rule (got "${t}")`);
      if (m) check(!!m[2] === (Number(m[3]) < Number(m[1])), `"only" belongs with fewer links than co-mentions (got "${t}")`);
    }
    // matrix columns are numbered like the rows, never "C<id>" (persona pass: columns read C0..C8)
    const cols = await tab.ev(`[...document.querySelectorAll(".vg-mx-col")].map(x => x.textContent)`), rowsN = await tab.ev(`[...document.querySelectorAll(".vg-mx-name")].map(x => x.textContent)`);
    check(cols.length > 1 && cols.every((c, i) => c === String(i + 1)), "matrix columns should be numbered 1, 2, 3: " + cols);
    check(rowsN.every((r, i) => r.startsWith(String(i + 1) + " ")), "each row name starts with its number: " + rowsN);
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "gap text follows one rule and the matrix lists only talked-about pairs");
})();
