#!/usr/bin/env node
// The right-hand panel on Today never opens as an empty box: when the picked item has nothing to add beside the Do next card, it says what to do.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("today"); })()`);
    await sleep(300);
    const r = await tab.ev(`(() => { const e = document.querySelector(".vg-hq-rail"); return e ? { text: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height) } : null; })()`);
    check(r, "Today at 1280 should show the right-hand panel");
    if (r) check(r.text.length > 10, `the right-hand panel is an empty box (${r.h}px tall, text "${r.text}")`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the right-hand panel on Today is never empty", "rail empty");
})();
