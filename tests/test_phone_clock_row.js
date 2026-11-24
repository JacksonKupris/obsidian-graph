#!/usr/bin/env node
// (A phone's slim bar has no clock at all.) On a phone the header's clock never sits alone on its own row (it used to take a row of its own between the title row and the search box); at desktop width it stays.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const [w, h] of [[1280, 800], [390, 844], [360, 740]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("home"); })()`);
      await sleep(300);
      const r = await tab.ev(`(() => { const top = document.querySelector(".vg-hq-top"), c = top.querySelector(".vg-hq-clock"); if (!c) return { shown: false, mates: 0 }; const shown = getComputedStyle(c).display !== "none"; const t = Math.round(c.getBoundingClientRect().top); const mates = [...top.children].filter(x => x !== c && getComputedStyle(x).display !== "none" && Math.abs(Math.round(x.getBoundingClientRect().top) - t) < 20).length; return { shown, mates }; })()`);
      if (w >= 600) check(r.shown, `${w}px: the clock stays on desktop`);
      else check(!r.shown || r.mates > 0, `${w}px: the clock sits alone on its own row`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the clock never takes a header row of its own", "phone clock row");
})();
