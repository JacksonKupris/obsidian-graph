#!/usr/bin/env node
// Triage's "N items to go" drops by one each time you skip, and the card's main button says what it does (not a bare "Open").
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 844, deviceScaleFactor: 1, mobile: false });
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), layout: "triage", api: {} }); window.vaultHQ.setScreen("today"); })()`);
    await sleep(300);
    const read = () => tab.ev(`(() => { const l = document.querySelector(".vg-hq-tribar"); const p = l && l.previousElementSibling; const m = p && /([0-9]+) items? to go/.exec(p.textContent); return m ? +m[1] : -1; })()`);
    const n0 = await read();
    check(n0 > 1, "needs two or more items to test, got " + n0);
    await tab.ev(`document.querySelector('[data-triage="skip"]').click()`); await sleep(150);
    const n1 = await read();
    check(n1 === n0 - 1, `after one skip the count should drop from ${n0} to ${n0 - 1}, it says ${n1}`);
    const main = await tab.ev(`(() => { const b = document.querySelector('.vg-hq-tricard [data-act="main"]'); return b ? b.textContent.trim() : ""; })()`);
    check(!/^open$/i.test(main), `the main button says only "${main}"`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "triage count drops on skip and the main button says what it does", "triage count");
})();
