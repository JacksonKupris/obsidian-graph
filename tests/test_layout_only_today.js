#!/usr/bin/env node
// The Layout control changes how Today is drawn, so it shows on Today only; the Theme control applies everywhere and shows on every screen.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const seen = {};
    for (const screen of ["today", "home", "needs", "people", "projects", "calendar", "automations", "wrap"]) {
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(screen)}); })()`);
      await sleep(250);
      seen[screen] = await tab.ev(`({ layout: document.querySelectorAll("select[data-layout]").length, theme: document.querySelectorAll("select[data-palette]").length })`);
    }
    check(seen.today.layout === 1, `Today should offer the Layout control: ${JSON.stringify(seen.today)}`);
    for (const [screen, s] of Object.entries(seen)) {
      if (screen !== "today") check(s.layout === 0, `${screen} shows a Layout control that only changes Today`);
      check(s.theme === 1, `${screen} should offer the Theme control once: ${JSON.stringify(s)}`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Layout shows on Today only, Theme on every screen", "layout only on today");
})();
