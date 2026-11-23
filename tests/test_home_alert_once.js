#!/usr/bin/env node
// A failed automation is named by the Next pill and the Do next tile; the greeting does not say it a third time (the Automations chip already carries the dot and count).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("home"); })()`);
    await sleep(300);
    const t = await tab.ev(`document.querySelector(".vg-hq-main, .vg-hq-screen, #hq").innerText`);
    check(/Nightly-backup failed/.test(t), "the failed job is named in Do next");
    check(!/automations? needs? attention|automations? need attention/i.test(t), "the greeting repeats the failed automation");
    check(!!await tab.ev(`document.querySelector('.vg-hq-chip[data-go="automations"] .vg-hq-dot')`), "the Automations chip keeps its dot");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "a failed automation is not said a third time in the greeting", "home alert once");
})();
