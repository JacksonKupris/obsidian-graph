#!/usr/bin/env node
// The carried-over list on Today and its "Go through them" button name their orders (round 4: the list ran newest first while the button said oldest first,
// and nothing said so). The heading states the list's order, and the rows really run in that order.
const { sleep, checks, openPage, tools } = require("./kit"), env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage(""), mobile: true });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(200);
    await tools(tab, { wait: 150 }).screen("today");
    const r = await tab.ev(`(() => { const s = [...document.querySelectorAll(".vg-hq-sec")].find(x => /^Carried over/.test(x.querySelector("h3").textContent));
      if (!s) return null;
      const days = [...s.querySelectorAll(".vg-hq-item")].map(x => { const m = x.textContent.match(/(\\d+) days? ago/); return m ? Number(m[1]) : null; }).filter(x => x != null);
      return { head: s.querySelector("h3").firstChild.textContent, btn: (s.querySelector("[data-go=sweep]") || {}).textContent || "", days }; })()`);
    check(r, "the sample has a carried-over section");
    if (r) {
      check(/newest first/i.test(r.head), 'the heading says how the list is ordered ("' + r.head + '")');
      check(/oldest first/i.test(r.btn), "the button names its own order");
      check(r.days.length > 1 && r.days.every((a, i) => i === 0 || a >= r.days[i - 1]), "the rows run newest first, as the heading says (days ago " + r.days.join(",") + ")");
    }
  } finally { await tab.close(); }
  const { finish } = require("./kit"); finish(fails, "the carried-over list names its order and keeps it", "hq carried order");
})();
