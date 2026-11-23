#!/usr/bin/env node
// Triage on a phone: the actions (Skip, Done, Later...) are on the first screen without scrolling past the context cards, and
// nothing in the card sits under the bottom bar. Found by persona-phone: Skip/Open were under the fold.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    for (const h of [844, 700]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: h, deviceScaleFactor: 1, mobile: true });
      await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), layout: "triage", api: { searchNotes: async q => [{ path: "Old fix.md", heading: "How it was solved", snippet: "We did this before: " + q }] } }); window.vaultHQ.setScreen("today"); })()`);
      await sleep(400);
      const r = await tab.ev(`(() => { const b = document.querySelector('.vg-hq-tricard [data-triage="skip"]'); if (!b) return null; const x = b.getBoundingClientRect(); return { bottom: x.bottom, vh: innerHeight }; })()`);
      check(r, `${h}px: no Skip button`);
      if (r) check(r.bottom <= r.vh - 56, `${h}px tall: Skip is at ${Math.round(r.bottom)} of ${r.vh}, under the fold or the bottom bar`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "triage on a phone: the actions are on the first screen", "triage phone");
})();
