#!/usr/bin/env node
// A narrowed graph (Show both topics, a lit set of notes) has a visible Clear in the status line. Before, the only way out was Escape, which a
// person on a phone doesn't have (3D persona round, 0.6.229: "no clear-filter control after Show both").
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  for (const mobile of [false, true]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    const tag = mobile ? "phone" : "desktop";
    try {
      if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
      await tab.ev(`document.querySelectorAll(".vg-tour").forEach(e => e.remove())`);
      check(!await tab.ev(`!!document.querySelector(".vg-status [data-clear]")`), `${tag}: no Clear while nothing is narrowed`);
      await tab.ev(`window.vaultGraph._debug.focusClusters(DATA.clusters.slice(0, 2).map(c => c.id))`); await sleep(500);
      check(await tab.ev(`!!document.querySelector(".vg-status [data-clear]")`), `${tag}: a narrowed graph shows Clear (the check can't pass if the graph isn't narrowed)`);
      const h = await tab.ev(`Math.round(document.querySelector(".vg-status [data-clear]").getBoundingClientRect().height)`);
      check(h >= (mobile ? 36 : 24), `${tag}: Clear is big enough to hit (${h}px)`);
      await tab.ev(`document.querySelector(".vg-status [data-clear]").click()`); await sleep(400);
      check(!await tab.ev(`!!document.querySelector(".vg-status [data-clear]")`), `${tag}: Clear removes the narrowing and itself`);
      check(!await tab.ev(`/↔/.test(document.querySelector(".vg-status").textContent)`), `${tag}: the status no longer names the two topics`);
    } catch (e) { fails.push(tag + " crashed: " + e.message); }
    await tab.close();
  }
  finish(fails, "a narrowed graph has a visible Clear");
})();
