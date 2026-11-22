#!/usr/bin/env node
// A view with nothing to show points to a next step (persona pass 2026-11-21: Timeline, Topic river, Dungeon, Triage, Survivors,
// Wikirace, Context notes, Map tree, People by topic ended in a sentence and nothing to press).
// A vault with no dailies and no dated history; every lens that renders no controls of its own must carry a button.
//   node tests/test_empty_next.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const d = JSON.parse(JSON.stringify(env.data()));
  Object.assign(d, { dailies_used: 0, series: [], said_unlinked: [], pairs: [], gaps: [], timeline: { weeks: [], clusters: {}, notes: {} }, strand: { days: [], paths: [], ids: [], rows: [] }, mocs: [], tasks: [] });
  const tab = await openPage({ html: env.pageWith("", d) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const keys = await tab.ev(`${D}.scenes ? 0 : 0`) , lenses = await tab.ev(`[...document.querySelectorAll("select option")].map(o => o.value).filter(v => /^lens:/.test(v))`);
    check(lenses.length > 10, "found the lens list (the test can't fail without it): " + lenses.length);
    const bare = [];
    for (const v of lenses) {
      await tab.ev(`${D}.openView(${JSON.stringify(v)})`); await sleep(350);
      const r = await tab.ev(`(() => { const b = document.querySelector(".vg-lens-body"); if (!b || document.querySelector(".vg-lens").hidden) return null; return { text: b.textContent.trim().length, ctl: b.querySelectorAll("button, a, input, select, summary").length }; })()`);
      if (process.env.VG_DEBUG) console.log(v, JSON.stringify(r)); if (r && r.text > 0 && r.text < 400 && r.ctl === 0) bare.push(v);
      await tab.ev(`${D}.goBack ? ${D}.goBack() : 0`);
    }
    check(!bare.length, "these views end in a sentence with nothing to press: " + bare.join(", "));
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "empty views point to a next step");
})();
