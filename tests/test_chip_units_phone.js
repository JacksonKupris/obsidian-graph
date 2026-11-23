#!/usr/bin/env node
// The strip chips say the same words at phone width as on desktop ("7 items", "1 active"), not a bare number, and nothing is cut off.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  const read = () => tab.ev(`[...document.querySelectorAll(".vg-hq-chip")].map(c => ({ shown: [...c.querySelectorAll("b, em, small")].filter(e => getComputedStyle(e).display !== "none").map(e => e.textContent.trim()).join(" "), sub: c.querySelector("small").textContent.trim(), cut: c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll("b, em, small")].some(e => getComputedStyle(e).display !== "none" && e.scrollWidth > e.clientWidth + 1) }))`);
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const [w, h] of [[1280, 800], [390, 844], [360, 740], [320, 640]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("home"); })()`);
      await sleep(300);
      const chips = await read();
      check(chips.length >= 2, `${w}px: the strip has chips to check`);
      for (const c of chips) {
        check(c.shown.includes(c.sub), `${w}px: "${c.shown}" leaves out "${c.sub}"`);
        check(!c.cut, `${w}px: "${c.shown}" is cut off`);
      }
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the strip chips keep their words on a phone", "chip units phone");
})();
