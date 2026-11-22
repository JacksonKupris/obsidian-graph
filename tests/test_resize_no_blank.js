#!/usr/bin/env node
// Resizing the canvas clears it, and the redraw used to wait for the next frame, so the browser painted one empty canvas each time the
// inspector opened or closed (a flicker). The canvas is drawn again in the same pass as the resize.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), V = "window.vaultGraph._debug";
  try {
    check(await tab.waitFor(`window.vaultGraph && ${V} ? 1 : 0`, 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await sleep(2500);   // the layout settles
    const r = await tab.ev(`new Promise(res => {
      const cv = document.querySelector(".vg-root canvas"), wrap = cv.parentElement, ink = () => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; const g = c.getContext("2d"); g.drawImage(cv, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++; return n; };
      const before = ink(); let seen = null, w0 = cv.width;
      new ResizeObserver(() => { if (seen === null && cv.width !== w0) seen = ink(); }).observe(wrap);   // runs after the page's own observer, before the next paint
      wrap.parentElement.style.paddingRight = "300px";
      setTimeout(() => res({ before, seen, resized: cv.width !== w0 }), 600);
    })`);
    check(r.before > 50, "the canvas must show something to start with, or this test reads nothing: " + r.before);
    check(r.resized && r.seen !== null, "the canvas must have been resized: " + JSON.stringify(r));
    check(r.seen > r.before / 4, `the canvas is empty right after its resize (${r.seen} marks against ${r.before} before)`);
  } finally { await tab.close(); }
  finish(fails, "a resize does not leave an empty canvas for a frame");
})();
