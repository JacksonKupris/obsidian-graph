#!/usr/bin/env node
// Every tour card is fully inside the pane and does not cover the control it explains (its ring), on a computer and on a phone.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  for (const [w, h, mobile] of [[1280, 800, false], [390, 844, true]]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile }), V = "window.vaultGraph._debug";
    try {
      await tab.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
      check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
      await sleep(2600);   // the first-open tour starts by itself
      let steps = 0, seenBanner = 0;
      for (let i = 0; i < 30; i++) {
        const r = await tab.ev(`(() => { const t = document.querySelector(".vg-tour"); if (!t) return null; const R = document.querySelector(".vg-root").getBoundingClientRect(), c = t.querySelector(".vg-tour-card").getBoundingClientRect(), g = t.querySelector(".vg-tour-ring"), q = g && g.getBoundingClientRect();
          const hit = q && !(c.right <= q.left || c.left >= q.right || c.bottom <= q.top || c.top >= q.bottom);
          return { title: t.getAttribute("aria-label"), outside: c.left < R.left - 1 || c.right > R.right + 1 || c.top < R.top - 1 || c.bottom > R.bottom + 1, covers: !!hit, c: [c.left, c.top, c.right, c.bottom].map(Math.round), q: q ? [q.left, q.top, q.right, q.bottom].map(Math.round) : null }; })()`);
        if (!r) break;
        steps++;
        const b = await tab.ev(`(() => { const t = document.querySelector(".vg-today:not([hidden])"), c = document.querySelector(".vg-tour-card"); if (!t || !c) return null; const a = t.getBoundingClientRect(), d = c.getBoundingClientRect();
          return { covers: !(d.right <= a.left || d.left >= a.right || d.bottom <= a.top || d.top >= a.bottom), a: [a.left, a.top, a.right, a.bottom].map(Math.round), d: [d.left, d.top, d.right, d.bottom].map(Math.round) }; })()`);
        if (b) { seenBanner++; check(!b.covers, `${w}px, step "${r.title}": the card covers the Today banner: card ${JSON.stringify(b.d)}, banner ${JSON.stringify(b.a)}`); }
        check(!r.outside, `${w}px, step "${r.title}": the card runs outside the pane ${JSON.stringify(r.c)}`);
        check(!r.covers, `${w}px, step "${r.title}": the card covers the control it explains: card ${JSON.stringify(r.c)}, control ${JSON.stringify(r.q)}`);
        await tab.ev(`document.querySelector('.vg-tour [data-t="next"]').click()`); await sleep(250);
      }
      check(seenBanner > 0, `${w}px: the Today banner must be showing during the tour, or the banner check reads nothing`);
      check(steps >= 4, `${w}px: the tour must show at least four cards, or this test reads nothing: ${steps}`);
    } finally { await tab.close(); }
  }
  finish(fails, "tour cards stay inside the pane and off the control they explain");
})();
