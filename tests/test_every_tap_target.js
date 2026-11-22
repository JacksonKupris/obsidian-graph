#!/usr/bin/env node
// On a phone, no pressable thing in any view is smaller than 36 px in both directions (a hit area from ::after counts).
// Walks the page's own view list, so a view added later is covered. Found by the persona pass 2026-11-22: scene labels were 24 px and nothing swept every view.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile: true }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const keys = await ev(`window.vaultGraph._debug.allViews().map(v => v.key)`);
    check(keys.length > 30, "the page should list its views (got " + keys.length + ")");
    let seen = 0;
    for (const k of keys) {
      await ev(`window.vaultGraph._debug.openView(${JSON.stringify(k)})`); await sleep(700);
      const bad = await ev(`(() => { const out = []; for (const b of document.querySelectorAll(".vg-root button, .vg-root [role=button], .vg-root a[href], .vg-root select, .vg-root input")) {
        const lab = b.matches("input[type=checkbox],input[type=radio]") && b.closest("label"); const r = (lab || b).getBoundingClientRect(); if (r.width < 1 || r.height < 1 || getComputedStyle(b).visibility === "hidden" || b.closest("[hidden]")) continue;
        const a = getComputedStyle(b, "::after"), ah = a.content !== "none" && a.position === "absolute" ? parseFloat(a.height) || 0 : 0, aw = a.content !== "none" && a.position === "absolute" ? (parseFloat(a.width) || r.width) : 0;
        const h = Math.max(r.height, ah), w = Math.max(r.width, aw); if (h < 36 && w < 36 || h < 28) out.push((b.className.toString().split(" ")[0] || b.tagName) + " " + Math.round(w) + "x" + Math.round(h)); } return [...new Set(out)]; })()`);
      seen++; if (bad.length) check(false, `${k}: too small to tap: ${bad.slice(0, 6).join(", ")}`);
    }
    check(seen === keys.length, "every view was visited");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Every pressable thing in every view is big enough to tap");
})();
