#!/usr/bin/env node
// A toast in the 3D view never covers the legend or the status line (3D persona round, 0.6.242).
//   node tests/test_toast_clear.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  for (const mobile of [true, false]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    const where = mobile ? "phone" : "desktop";
    try {
      if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
      await sleep(1500);
      await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }).catch(() => {}); await tab.ev(`${D}.openView("3d")`); await sleep(1500); await tab.ev(`${D}.toast("Style changed")`);
      const boxes = await tab.waitFor(`(() => { const t = document.querySelector(".vg-toast.is-in"); if (!t) return 0; const rs = s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(), v = r.width > 0 && r.height > 0 && getComputedStyle(e).display !== "none"; return v ? [r.left, r.top, r.right, r.bottom] : null; }; return JSON.stringify({ toast: rs(".vg-toast.is-in"), legend: rs(".vg-legend") || rs(".vg-legend-key"), status: rs(".vg-status") }); })()`, 8000);
      check(!!boxes, where + ": a toast shows in the 3D view (the test can't fail without it)");
      if (boxes) {
        const b = JSON.parse(boxes);
        check(!!b.legend, where + ": the legend shows (the test can't fail without it)");
        for (const k of ["legend", "status"]) if (b[k] && b.toast) {
          const w = Math.min(b.toast[2], b[k][2]) - Math.max(b.toast[0], b[k][0]), h = Math.min(b.toast[3], b[k][3]) - Math.max(b.toast[1], b[k][1]);
          check(!(w > 3 && h > 3), `${where}: the hint toast covers the ${k} (${Math.round(w)}x${Math.round(h)}px)`);
        }
      }
    } finally { await tab.close(); }
  }
  finish(fails, "the hint toast stays clear of the legend");
})().catch(e => { console.error(e); process.exit(1); });
