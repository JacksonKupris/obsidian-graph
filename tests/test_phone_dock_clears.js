#!/usr/bin/env node
// On a phone the floating dock never hides the end of a screen: scrolled to the bottom, the last thing on each screen sits above it.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const s of ["home", "today", "needs", "projects", "people", "automations"]) {
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(s)}); })()`);
      await sleep(300);
      const r = await tab.ev(`(() => { const sc = [...document.querySelectorAll("*")].filter(e => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)); sc.forEach(e => e.scrollTo({ top: e.scrollHeight, behavior: "instant" })); const dock = document.querySelector(".vg-hq-dock"); if (!dock) return { none: true }; const dt = dock.getBoundingClientRect().top; const col = document.querySelector(".vg-hq-col"); const kids = [...col.querySelectorAll("*")].filter(e => e.getBoundingClientRect().height > 0); const low = Math.max(...kids.map(e => e.getBoundingClientRect().bottom)); return { dt: Math.round(dt), low: Math.round(low) }; })()`);
      if (r.none) { fails.push(s + ": no dock found"); continue; }
      check(r.low <= r.dt, `${s}: at the end of the screen the dock (top ${r.dt}) covers content down to ${r.low}`);
    }
    // the check can fail: with the room under the content removed, the dock does cover it
    await tab.ev(`window.vaultHQ.setScreen("home")`); await sleep(300);
    await tab.ev(`document.querySelector(".vg-hq-main").style.paddingBottom = "0px"`);
    const bad = await tab.ev(`(() => { const m = document.querySelector(".vg-hq-main"); m.scrollTo({ top: m.scrollHeight, behavior: "instant" }); return Math.round(document.querySelector(".vg-hq-col").getBoundingClientRect().bottom) > Math.round(document.querySelector(".vg-hq-dock").getBoundingClientRect().top); })()`);
    check(bad, "the check cannot fail: removing the bottom room should leave content under the dock");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the dock never hides the end of a screen on a phone", "phone dock clears");
})();
