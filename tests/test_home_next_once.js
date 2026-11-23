#!/usr/bin/env node
// Home's Do next tile is the next step, so the header's Next pill does not say it again there; every other screen keeps the pill.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  const show = s => tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(s)}); })()`).then(() => sleep(250));
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`); await sleep(250);   // the page's own mount has the note actions the headless remount lacks
    check(await tab.ev(`!document.querySelector(".vg-hq-nextchip")`), "Home shows the Next pill as well as the Do next tile");
    check(await tab.ev(`!!document.querySelector(".vg-hq-tile [data-act='main']")`), "the Do next tile keeps its action");
    for (const s of ["today", "needs", "people", "projects"]) { await show(s); check(await tab.ev(`!!document.querySelector(".vg-hq-nextchip")`), `${s} keeps the Next pill`); }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Home says the next step once; other screens keep the pill", "home next once");
})();
