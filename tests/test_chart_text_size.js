#!/usr/bin/env node
// Chart text is drawn in the chart's own units and the whole drawing is scaled to the panel, so a 10-unit label in a 1000-unit chart on a
// 330 px panel came out 3 px tall. Every label in every report chart is at least 11 px on screen, on a computer and on a phone.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const MIN = 11;
(async () => {
  for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true]]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    const V = "window.vaultGraph._debug";
    try {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
      check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
      await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      const keys = (await tab.ev(`${V}.allViews().map(v => v.key)`)).filter(k => k.startsWith("lens:"));
      let charts = 0;
      for (const k of keys) {
        await tab.ev(`${V}.openView(${JSON.stringify(k)})`); await sleep(500);
        const r = await tab.ev(`(() => { const out = []; for (const s of document.querySelectorAll("svg[viewBox]:not(.vg-ic)")) { const vb = s.viewBox.baseVal, b = s.getBoundingClientRect(); if (!vb.width || !b.width) continue; const k = b.width / vb.width;
          for (const t of s.querySelectorAll("text")) { const px = parseFloat(getComputedStyle(t).fontSize) * k; if (px < ${MIN - 0.2}) out.push((t.textContent || "").slice(0, 18) + " " + px.toFixed(1) + "px"); } out.push("#chart"); } return out; })()`);
        charts += r.filter(x => x === "#chart").length;
        const small = r.filter(x => x !== "#chart");
        check(!small.length, `${w}px, ${k}: chart text under ${MIN}px on screen: ${[...new Set(small)].slice(0, 6).join(", ")}`);
      }
      check(charts >= 3, `${w}px: the views must show at least three charts, or this test reads nothing: ${charts}`);
    } finally { await tab.close(); }
  }
  finish(fails, "chart text is readable on screen");
})();
