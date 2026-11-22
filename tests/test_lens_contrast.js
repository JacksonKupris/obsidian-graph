#!/usr/bin/env node
// A report opened over the Neural view is readable in the light theme and the dark one: its text, buttons and cards use one palette
// (persona round 2: Open buttons 1.21:1, the Attention callout unreadable, muted text 3:1).
const { sleep, checks, finish, openPage, a11yAudit, contrast, FLEXOKI } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e), D = "window.vaultGraph._debug";
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(e => e.remove())`);
    await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    for (const [name, dark, vars] of [["light", false, FLEXOKI.light], ["dark", true, FLEXOKI.dark]]) {
      await ev(`(() => { const r = document.documentElement.style; Object.entries(${JSON.stringify(vars)}).forEach(([k, v]) => r.setProperty(k, v)); document.body.classList.toggle("theme-dark", ${dark}); })()`);
      for (const view of ["lens:stale", "lens:attention", "lens:blind"]) {
        await ev(`${D}.openView("neural")`); await sleep(400);
        const had = await ev(`!!${D}.openView && (${D}.openView(${JSON.stringify(view)}), 1)`); await sleep(500);
        if (!await ev(`!!document.querySelector(".vg-lens")`)) continue;
        const a = await ev(a11yAudit(".vg-lens", ".vg-sr"));
        check(a.text.length > 5, `${name} ${view}: the audit read almost nothing`);
        const low = a.text.filter(([, , fg, bg, fs, w]) => contrast(fg, bg) < (fs >= 24 || (fs >= 18.66 && w >= 700) ? 3 : 4.5));
        check(!low.length, `${name} ${view} over Neural: ${low.length} unreadable, e.g. ${low.slice(0, 3).map(l => `${l[0]} ${l[2]} on ${l[3]} ${contrast(l[2], l[3]).toFixed(2)}`).join("; ")}`);
      }
    }
  } finally { await tab.close(); }
  finish(fails, "a report over Neural is readable in both themes");
})().catch(e => { console.error(e); process.exit(1); });
