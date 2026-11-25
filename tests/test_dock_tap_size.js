#!/usr/bin/env node
// Every bottom-bar button on a phone is at least 44 by 44 px, the same minimum as every other control (tokens: --ds-tap).
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await sleep(500);
    const r = await tab.ev(`[...document.querySelectorAll(".vg-hq-dockbtn")].map(b => { const x = b.getBoundingClientRect(); return { n: b.getAttribute("aria-label"), w: Math.round(x.width * 10) / 10, h: Math.round(x.height * 10) / 10 }; })`);
    check(r.length >= 5, "the bottom bar has its buttons (the test can't fail without them): " + r.length);
    const small = r.filter(b => b.w < 44 || b.h < 44);
    check(!small.length, "bottom-bar buttons under 44 px: " + JSON.stringify(small));
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "every bottom-bar button is at least 44 px on a phone", "dock tap size");
})();
