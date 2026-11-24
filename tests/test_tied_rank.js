#!/usr/bin/env node
// Notes with equal influence share a rank, so the list shows "#33 most connecting" on several rows. A shared rank says "tied"
// (3D persona round, 0.6.242: "#33 most connecting" on many notes read as a mistake).
//   node tests/test_tied_rank.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(2000);
    // one row per distinct note: a note can appear in two cards, and that is not a tie
    const rows = await tab.ev(`(() => { const seen = new Set(), out = []; document.querySelectorAll("[data-panel=insights] .vg-item-sub").forEach(s => { if (!/most connecting/.test(s.textContent)) return; const it = s.closest("[data-id]"), k = it ? it.getAttribute("data-id") : s.textContent; if (seen.has(k)) return; seen.add(k); out.push(s.textContent); }); return out; })()`);
    check(rows.length > 3, "the Insights panel lists ranked notes (the test can't fail without them): " + rows.length);
    const ranks = rows.map(t => (t.match(/#(\d+)/) || [])[1]).filter(Boolean), count = {}; ranks.forEach(r => count[r] = (count[r] || 0) + 1);
    const tied = rows.filter(t => count[(t.match(/#(\d+)/) || [])[1]] > 1);
    check(tied.length > 0, "the sample has notes that share a rank (the test can't fail without them)");
    tied.forEach(t => check(/tied/i.test(t), "a shared rank says tied: " + t.slice(0, 60)));
    // (a row that looks unique may tie with a note below the 30 the panel lists, so only the shared ones are asserted)
  } finally { await tab.close(); }
  finish(fails, "shared ranks say tied");
})().catch(e => { console.error(e); process.exit(1); });
