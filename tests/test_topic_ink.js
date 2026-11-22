#!/usr/bin/env node
// Topic colours are legible where they are used, in light and dark: the topic names drawn on the canvas (as they look after the
// label's own transparency, 4.5:1) and the topic dots in the legend (3:1, they are not text). The persona run measured labels at
// 3.5 to 4.0:1 in light, and legend dots at 2.8 to 3.4:1, from the dark palette on a cream page.
const { sleep, checks, finish, openPage, contrast } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  for (const dark of [false, true]) {
    const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug", tag = dark ? "dark" : "light";
    try {
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
      check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
      await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
      await tab.ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(400);
      await tab.ev(`(() => { const rgb = s => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "#000"; c.fillStyle = s; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        window.__labels = []; const f = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (t, x, y, w) { if (/^600 14px/.test(this.font)) window.__labels.push({ t: String(t), fill: rgb(this.fillStyle), bg: rgb(this.strokeStyle), a: this.globalAlpha }); return f.call(this, t, x, y, w); }; })()`);
      await tab.ev(`${V}.openView("2d")`); await sleep(500); await tab.ev(`window.__labels = []; ${V}.drawNow()`); await sleep(300);
      const L = await tab.ev(`window.__labels`);
      const lit = L.filter(l => l.a >= 0.5);
      check(lit.length >= 3, `${tag}: topic names must be drawn, or this test reads nothing: ${L.length} drawn, ${lit.length} undimmed`);
      for (const l of lit) {
        const eff = l.fill.map((v, i) => Math.round(v * l.a + l.bg[i] * (1 - l.a))), c = contrast(eff, l.bg);
        check(c >= 4.5, `${tag}: topic name "${l.t}" is ${c.toFixed(2)}:1 (ink ${l.fill}, alpha ${l.a}, page ${l.bg})`);
      }
      const dots = await tab.ev(`(() => { const rgb = s => (s.match(/[0-9.]+/g) || []).map(Number), lg = document.querySelector(".vg-legend"); let bg = null;
        for (let e = lg; e && !bg; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.6)) bg = c.slice(0, 3); }
        return { bg, dots: [...lg.querySelectorAll(".vg-lg-dots > i[style*=background]")].map(i => rgb(getComputedStyle(i).backgroundColor).slice(0, 3)) }; })()`);
      check(dots.dots.length >= 3 && dots.bg, `${tag}: the legend must show topic dots on a known background, or this test reads nothing: ${JSON.stringify(dots)}`);
      for (const d of dots.dots) { const c = contrast(d, dots.bg); check(c >= 3, `${tag}: a topic dot in the legend ${d} on ${dots.bg} is ${c.toFixed(2)}:1`); }
    } finally { await tab.close(); }
  }
  finish(fails, "topic names and topic dots read on their background in light and dark");
})();
