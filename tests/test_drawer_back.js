#!/usr/bin/env node
// On a phone, opening a detail from the side panel (a card, a note row) hides the panel; Escape or Back returns to the panel,
// not to the bare graph (persona round 2: "Back returns to the exact previous screen").
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(500);
    const esc = async () => { await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`); await ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300); };
    const open = () => ev(`document.querySelector(".vg-root").classList.contains("vg-side-open")`);
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const [name, act] of [["a stat card", `document.querySelector('[data-stat="unlinked"]').click()`], ["a note row", `document.querySelector(".vg-side [data-id]").click()`]]) {
      await ev(`(() => { const r = document.querySelector(".vg-root"); if (!r.classList.contains("vg-side-open")) document.querySelector(".vg-toggle").click(); })()`); await sleep(250);
      check(await open(), "the side panel should be open to start");
      await ev(act); await sleep(500);
      check(!await open(), `${name} should hide the panel while its detail shows`);
      await esc();
      check(await open(), `Escape after ${name} should bring the panel back`);
      await esc();   // a second Escape closes the panel itself
      check(!await open(), `a second Escape should close the panel (${name})`);
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Back from a detail returns to the side panel");
})();
