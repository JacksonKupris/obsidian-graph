#!/usr/bin/env node
// Text on a phone is at least 12 px: the 10 and 11 px sizes are for a computer, and a thumb-sized screen read at arm's length needs more.
// Every visible piece of text in every view, at 390 px wide as a phone, is 12 px or more (charts are checked by test_chart_text_size).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const MIN = 12;
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true }), V = "window.vaultGraph._debug";
  try {
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    const keys = (await tab.ev(`${V}.allViews().map(v => v.key)`)).filter(x => x.startsWith("lens:") || ["2d", "neural", "cosmos"].includes(x));
    let texts = 0;
    for (const k of ["", ...keys]) {
      if (k) { await tab.ev(`${V}.openView(${JSON.stringify(k)})`); await sleep(400); }
      const r = await tab.ev(`(() => { const small = [], n = { all: 0 }; for (const e of document.querySelectorAll(".vg-root *")) { if (e.closest("svg") || e.closest("canvas") || !e.offsetParent) continue; let own = ""; for (const c of e.childNodes) if (c.nodeType === 3) own += c.textContent; if (!own.trim()) continue;
        const fs = parseFloat(getComputedStyle(e).fontSize); if (!fs) continue; n.all++; if (fs < ${MIN - 0.05}) small.push(fs.toFixed(1) + "px " + (typeof e.className === "string" ? e.className.split(" ")[0] : "") + " “" + own.trim().slice(0, 20) + "”"); } return { small, n: n.all }; })()`);
      texts += r.n;
      check(!r.small.length, `${k || "start"}: text under ${MIN}px on a phone: ${[...new Set(r.small)].slice(0, 5).join("; ")}`);
    }
    check(texts > 200, `the test must read the page's text, or it reads nothing: ${texts}`);
  } finally { await tab.close(); }
  finish(fails, "phone text is 12px or more");
})();
