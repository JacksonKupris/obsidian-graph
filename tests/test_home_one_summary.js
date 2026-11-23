#!/usr/bin/env node
// Home shows the Needs you and Projects counts once, in the strip chips under the header, not again as cards below.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const [w, h] of [[1280, 800], [390, 844]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("home"); })()`);
      await sleep(300);
      const r = await tab.ev(`({ cards: document.querySelectorAll(".vg-hq-tiles .ds-card").length, chips: [...document.querySelectorAll(".vg-hq-chip")].map(c => c.innerText.trim().replace(/\\s+/g, " ")), tile: !!document.querySelector(".vg-hq-tiles .vg-hq-tile") })`);
      check(r.cards === 0, `${w}px: Home repeats the Needs you / Projects counts as ${r.cards} cards under the strip chips`);
      check(r.chips.some(t => /^Needs you.*\d/.test(t)) && r.chips.some(t => /^Projects.*\d/.test(t)), `${w}px: the strip chips keep the counts: ${JSON.stringify(r.chips)}`);
      check(r.tile, `${w}px: the Do next tile stays`);
    }
    await tab.ev(`document.querySelector('.vg-hq-chip[data-go="needs"]').click()`); await sleep(200);
    check(await tab.ev(`window.vaultHQ.screen()`) === "needs", "the Needs you chip opens Needs you");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Home shows each count once, in the strip chips", "home one summary");
})();
