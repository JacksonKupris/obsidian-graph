#!/usr/bin/env node
// The week strip's legend is a sentence: what the dots mean, what a day with none means, and that a day opens when tapped
// (round 4: "Days with Journal Standup" read as a label with no verb to two personas).
const { sleep, checks, openPage, tools } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
    await tools(tab, { wait: 150 }).screen("today");
    const r = await tab.ev(`(() => { const l = document.querySelector(".vg-hq-weeklegend"); return l ? { text: l.textContent.replace(/\\s+/g, " ").trim(), fits: l.scrollWidth <= l.clientWidth + 1 } : null; })()`);
    check(r, "the week strip has a legend");
    if (r) {
      check(/tap a day/i.test(r.text), 'it says a day opens when tapped ("' + r.text + '")');
      check(/journal/i.test(r.text) && /standup/i.test(r.text), "it names both dots");
      check(/no dot/i.test(r.text), "it says what a day with no dot means");
      check(r.fits, "it stays inside the screen at 390px");
    }
  } finally { await tab.close(); }
  const { finish } = require("./kit"); finish(fails, "the week strip's legend says what the dots and a tap mean", "hq strip legend");
})();
