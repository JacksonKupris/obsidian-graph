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
    await idle.close();
    const busy = await load();
    await busy.ev(`${D}.openView("lens:stale")`);
    await sleep(3000);
    check(await busy.ev(`!document.querySelector(".vg-tour")`), "the tour should not open over a report the person already chose");
    await busy.close();
  } catch (e) { fails.push("crashed: " + e.message); }
  finish(fails, "the tour starts at step 1 and not over work already begun");
})();
