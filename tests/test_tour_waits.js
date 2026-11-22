#!/usr/bin/env node
// The first-run tour does not start over something the person already began: a click anywhere (a stat card, a panel) or an open search (persona round 3).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`(() => { const c = document.querySelector(".vg-side .ds-card, .vg-side button"); c && c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); c && c.click(); })()`);
    await sleep(3200);
    check(await ev(`!document.querySelector(".vg-tour, .vg-tour-card")`), "the tour started after the person had already clicked something");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "The tour waits for a quiet start");
})();
