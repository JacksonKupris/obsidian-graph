#!/usr/bin/env node
// The first-run tour offers itself to someone who has not started yet. It does not open over a report they chose, and it starts at step 1.
// Found by the persona pass 2026-11-21: it opened at "3 / 6" over the page after the person had already picked a view.
//   node tests/test_tour_start.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
async function load(extra) {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
  return tab;
}
(async () => {
  try {
    const idle = await load();
    await sleep(3000);
    const count = await idle.ev(`(() => { const c = document.querySelector(".vg-tour-count"); return c ? c.textContent.trim() : ""; })()`);
    check(/^1 \/ \d+$/.test(count), `an untouched page should offer the tour from step 1 (got "${count}"); the next check can't fail without it`);
    // the counter numbers the cards that are shown: 1 / N, 2 / N ... N / N with none skipped (persona round 2: 1/6, 3/6, 4/6 ...)
    const seen = [];
    for (let i = 0; i < 10; i++) {
      const c = await idle.ev(`(() => { const c = document.querySelector(".vg-tour-count"); return c ? c.textContent.trim() : ""; })()`);
      if (!c) break; seen.push(c);
      await idle.ev(`document.querySelector('.vg-tour [data-t="next"]').click()`); await sleep(150);
    }
    const nums = seen.map(c => c.split(" / ").map(Number)), total = nums.length && nums[0][1];
    check(nums.length >= 3 && nums.every(([a, b], i) => a === i + 1 && b === nums.length), "the tour counter should run 1..N over the cards shown: " + seen.join(", "));
    await idle.close();
    const busy = await load();
    await busy.ev(`${D}.openView("lens:stale")`);
    await sleep(3000);
    check(await busy.ev(`!document.querySelector(".vg-tour")`), "the tour should not open over a report the person already chose");
    await busy.close();
  } catch (e) { fails.push("crashed: " + e.message); }
  finish(fails, "the tour starts at step 1 and not over work already begun");
})();
