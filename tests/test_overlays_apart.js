#!/usr/bin/env node
// The 3D view's overlays (How to read this, legend, status line, toolbar, hint toast) never sit on top of each other,
// on a phone or a desktop window (3D persona round, 0.6.242: the chip overlapped How to read this after Show both).
//   node tests/test_overlays_apart.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
const SEL = [".vg-hud-title", ".vg-viewhelp", ".vg-legend", ".vg-status", ".vg-toolbar", ".vg-toast", ".vg-chips", ".vg-today"];
(async () => {
  for (const view of ["3d", "neural"]) for (const mobile of [true, false]) {
    const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
    try {
      if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
      await sleep(1500); await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" }).catch(() => {});
      await tab.ev(`${D}.openView("${view}")`); await sleep(2500);
      const boxes = await tab.ev(`(${JSON.stringify(SEL)}).flatMap(s => [...document.querySelectorAll(s)].map(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { s, x: r.left, y: r.top, w: r.width, h: r.height, v: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !e.hidden }; })).filter(b => b.v)`);
      const names = boxes.map(b => b.s);
      check(names.includes(".vg-toolbar") && names.includes(".vg-viewhelp"), view + " " + (mobile ? "phone" : "desktop") + ": the toolbar and How to read this show (the test can't fail without them): " + names.join(","));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]; if (a.s === b.s) continue;
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        check(!(w > 3 && h > 3), `${view} ${mobile ? "phone" : "desktop"}: ${a.s} overlaps ${b.s} (${Math.round(w)}x${Math.round(h)}px)`);
      }
    } finally { await tab.close(); }
  }
  finish(fails, "3D and Neural overlays stay apart");
})().catch(e => { console.error(e); process.exit(1); });
