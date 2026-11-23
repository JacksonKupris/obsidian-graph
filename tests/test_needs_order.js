#!/usr/bin/env node
// Needs you lists a failed automation first (it can stop everything after it) and puts the inbox last (it is tidying, not a decision); the
// one-at-a-time walk follows the same order, so the first card is the first section.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), api: {} }); window.vaultHQ.setScreen("needs"); })()`);
    await sleep(300);
    const heads = await tab.ev(`[...document.querySelectorAll(".vg-hq-sec > h3")].map(h => h.firstChild.textContent.trim())`);
    const at = name => heads.findIndex(h => h.startsWith(name));
    check(at("Automations") === 0, `a failed automation should be the first section: ${JSON.stringify(heads)}`);
    check(at("Inbox") === heads.length - 1, `the inbox should be the last section: ${JSON.stringify(heads)}`);
    const lede = await tab.ev(`document.querySelector(".vg-hq-lede").textContent`);
    check(!/decisions only you/i.test(lede), `the inbox isn't a decision, so the line shouldn't call everything one: "${lede}"`);
    await tab.ev(`document.querySelector('[data-walk="on"]').click()`);
    await sleep(200);
    const first = await tab.ev(`document.querySelector(".vg-hq-walk .vg-hq-eyebrow").textContent`);
    check(/automation/i.test(first), `the walk should start with the first section's item: "${first}"`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Needs you is ordered by what can wait, and the walk follows it", "needs order");
})();
