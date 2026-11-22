#!/usr/bin/env node
// Escape closes the top layer: the time-lapse stops, and a map row's highlight clears (persona round 3, keyboard and skeptic).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  const esc = () => ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }))`); await sleep(500);
    const running = await ev(`!!document.querySelector(".vg-timebtn.is-on, .vg-timebtn[aria-pressed=true], .vg-timebar:not([hidden])")`);
    check(running, "T starts the time-lapse (found no running marker)");
    await esc(); await sleep(400);
    const still = await ev(`!!document.querySelector(".vg-timebtn.is-on, .vg-timebtn[aria-pressed=true], .vg-timebar:not([hidden])")`);
    check(!still, "Escape should stop the time-lapse");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Escape stops the time-lapse");
})();
