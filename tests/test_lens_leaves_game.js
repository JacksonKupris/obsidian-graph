#!/usr/bin/env node
// Opening a report from a game screen (Triage, Dungeon) leaves the game: the game's title and button no longer show beside the report (persona round 3, design).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const game of ["triage", "dungeon"]) {
      await ev(`${D}.openView("${game}")`); await sleep(600);
      check(await ev(`${D}.st.view === "${game}"`), `${game} opens (the check can't fail without it)`);
      await ev(`${D}.openView("lens:survival")`); await sleep(600);
      check(await ev(`!document.querySelector(".vg-lens").hidden`), `${game}: the report opens`);
      check(await ev(`${D}.st.view !== "${game}"`), `${game}: the game is left when a report opens (view is ${await ev(`${D}.st.view`)})`);
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "A report opened from a game leaves the game");
})();
