#!/usr/bin/env node
// The side panel starts empty and its rows are upkeep suggestions, not tasks: it must not tell people to "pick a task".
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("today"); })()`); await sleep(400);
    const t = await tab.ev(`(document.querySelector(".vg-hq-railempty") || {}).innerText || ""`);
    check(t !== "", "The side panel has no empty state to read");
    check(!/task/i.test(t), `The side panel says "task" where its rows are suggestions: ${JSON.stringify(t)}`);
    check(/item/i.test(t), `the empty panel says what to pick: ${JSON.stringify(t)}`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the empty side panel names what it shows for", "rail empty words");
})();
