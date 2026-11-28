#!/usr/bin/env node
// A legend glyph is how a colour is explained, so it has to be readable where it is drawn: coloured glyphs in every view's legend
// (the radar's green dot was 2.3:1 on white, the weather's blue H 2.7:1 on dark) reach 4.5:1 against the legend's own background, light and dark.
const { sleep, checks, finish, openPage, contrast } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  for (const dark of [false, true]) {
    const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug";
    try {
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
      check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
      await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      const keys = (await tab.ev(`${V}.allViews().map(v => v.key)`)).filter(k => !k.startsWith("lens:"));
      let glyphs = 0;
      for (const k of keys) {
        await tab.ev(`${V}.openView(${JSON.stringify(k)})`); await sleep(250);
        const r = await tab.ev(`(() => { const lg = document.querySelector(".vg-legend"); if (!lg) return []; const rgb = s => (s.match(/[0-9.]+/g) || []).map(Number);
          const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.6)) return c.slice(0, 3); } return rgb(getComputedStyle(document.querySelector(".vg-root")).getPropertyValue("--vg-bg").trim() || "rgb(255,255,255)"); };
          const up = c => c.map(v => v <= 1 && c.every(x => x <= 1) ? v * 255 : v); return [...lg.querySelectorAll("b, span, i")].filter(e => e.style.color && e.textContent.trim()).map(e => ({ t: e.textContent.trim().slice(0, 3), fg: rgb(getComputedStyle(e).color).slice(0, 3), bg: up(bgOf(e)) })); })()`);
        for (const g of r) { glyphs++; const c = contrast(g.fg, g.bg); check(c >= 4.5, `${dark ? "dark" : "light"}, ${k}: legend glyph "${g.t}" ${g.fg} on ${g.bg} is ${c.toFixed(2)}:1`); }
      }
      check(glyphs >= 8, `${dark ? "dark" : "light"}: the legends must show coloured glyphs, or this test reads nothing: ${glyphs}`);
    } finally { await tab.close(); }
  }
  finish(fails, "legend glyphs read on their background in light and dark");
})();
