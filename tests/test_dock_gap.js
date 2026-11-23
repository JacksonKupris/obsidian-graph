#!/usr/bin/env node
// On a phone the floating dock never covers the last row: scrolled to the bottom, the last thing on each screen ends above the dock.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    for (const screen of ["today", "needs", "projects", "automations", "wrap"]) {
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(screen)}); })()`);
      await sleep(300);
      const r = await tab.ev(`(() => { const m = document.querySelector(".vg-hq-main"), d = document.querySelector(".vg-hq-dock"); if (!m || !d) return null; m.scrollTo({ top: m.scrollHeight, behavior: "instant" }); const kids = [...m.querySelectorAll("*")].filter(e => e.getBoundingClientRect().height > 0 && !e.closest(".vg-hq-dock")); const last = Math.max(...kids.map(e => e.getBoundingClientRect().bottom)); return { last: Math.round(last), dock: Math.round(d.getBoundingClientRect().top) }; })()`);
      check(r, `${screen}: main and dock should both be on the page at phone width`);
      if (r) check(r.last <= r.dock, `${screen}: the last row ends at ${r.last}px but the dock starts at ${r.dock}px`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the dock never covers the last row on a phone", "dock gap");
})();
