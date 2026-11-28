#!/usr/bin/env node
// Back returns to the exact place: a screen scrolled down, a sub-screen opened, Back (Escape) lands at the same scroll.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const [w, h, label] of [[1280, 800, "desktop"], [390, 780, "phone"]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
      for (const screen of ["today", "needs", "people"]) {
        await tab.ev(`window.vaultHQ.setScreen("${screen}")`); await sleep(400);
        await tab.ev(`(() => { const m = document.querySelector(".vg-hq-main"); m.style.scrollBehavior = "auto"; m.scrollTop = 250; })()`); await sleep(300);
        const top = await tab.ev(`document.querySelector(".vg-hq-main").scrollTop`);
        if (top < 100) { check(false, `${label} ${screen}: the screen has to scroll for this test to mean anything (scrolled to ${top})`); continue; }
        await tab.ev(`window.vaultHQ.setScreen("changes")`); await sleep(400);
        await tab.ev(`document.querySelector(".vg-hq-main").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(500);
        const r = await tab.ev(`({ on: window.vaultHQ.screen ? window.vaultHQ.screen() : "", top: document.querySelector(".vg-hq-main").scrollTop })`);
        check(r.on === screen, `${label} ${screen}: Back should return to the screen, got ${r.on}`);
        check(Math.abs(r.top - top) <= 2, `${label} ${screen}: Back should return to scroll ${top}, got ${r.top}`);
      }
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Back from a sub-screen returns to the same scroll", "hq back scroll");
})();
