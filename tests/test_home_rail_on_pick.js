#!/usr/bin/env node
// Home's side panel is not drawn empty: it appears when a row is picked, and Today (which has rows to pick) keeps it.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  const show = s => tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen(${JSON.stringify(s)}); })()`).then(() => sleep(350));
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await show("home");
    check(await tab.ev(`!document.querySelector(".vg-hq-rail")`), "Home draws an empty side panel before anything is picked");
    const row = await tab.ev(`!!document.querySelector(".vg-hq-main .vg-hq-item[data-key]:not(.vg-hq-next)")`);
    check(row, "Home has a row to pick");
    if (row) { await tab.ev(`document.querySelector(".vg-hq-main .vg-hq-item[data-key]:not(.vg-hq-next)").click()`); await sleep(250); check(await tab.ev(`!!document.querySelector(".vg-hq-rail .vg-hq-railtitle")`), "picking a Home row should open its side panel"); }
    await show("today");
    check(await tab.ev(`!!document.querySelector(".vg-hq-rail")`), "Today keeps its side panel");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Home's side panel appears when something is picked", "home rail on pick");
})();
