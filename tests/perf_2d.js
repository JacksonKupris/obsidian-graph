#!/usr/bin/env node
// What the base 2D graph costs, measured on a page: how long it takes to settle, what a frame costs while it does
// (the simulation step and the drawing apart), and whether it still draws once it is left alone.
//   node tests/perf_2d.js [--vault [dir]] [--mobile]        prints numbers; exit 0
const { sleep, openPage } = require("./kit");
const env = require("./env");
const mobile = process.argv.includes("--mobile");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph did not mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    // count animation frames and the time spent inside them, from outside the plugin
    await tab.ev(`(() => { const raf = window.requestAnimationFrame.bind(window); window.__f = { n: 0, ms: 0, max: 0, long: 0 };
      window.requestAnimationFrame = cb => raf(t => { const t0 = performance.now(); cb(t); const d = performance.now() - t0; const f = window.__f; f.n++; f.ms += d; if (d > f.max) f.max = d; if (d > 16.7) f.long++; }); })()`);
    const take = async ms => { await tab.ev("window.__f = { n: 0, ms: 0, max: 0, long: 0 }"); await sleep(ms); const f = await tab.ev("window.__f"); return { frames: f.n, perSec: +(f.n / (ms / 1000)).toFixed(1), avgMs: f.n ? +(f.ms / f.n).toFixed(1) : 0, maxMs: +f.max.toFixed(1), over16: f.long, busyPct: +(f.ms / ms * 100).toFixed(0) }; };
    const size = await tab.ev(`(() => { const d = window.vaultGraph._debug; const c = document.querySelector(".vg-canvas canvas"); return { canvas: c ? c.width + "x" + c.height : null, status: (document.querySelector(".vg-status") || {}).textContent }; })()`);
    console.log("page:", JSON.stringify(size));
    console.log("first 5 s (laying out):", JSON.stringify(await take(5000)));
    const t0 = Date.now(); let settled = false;
    while (Date.now() - t0 < 90000) { if (!/Laying out/.test(await tab.ev(`(document.querySelector(".vg-status") || {}).textContent || ""`))) { settled = true; break; } await sleep(500); }
    console.log(settled ? `settled after about ${Math.round((Date.now() - t0) / 1000) + 5} s` : "still laying out after 95 s");
    console.log("left alone, 5 s:", JSON.stringify(await take(5000)));
    // a pan: move the pointer with the button held across the canvas
    const drag = async () => { const y = mobile ? 500 : 400; await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 200, y, button: "left", clickCount: 1 }); for (let i = 0; i < 60; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 200 + i * 3, y: y + i, button: "left", buttons: 1 }); await sleep(16); } await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 380, y: y + 60, button: "left", clickCount: 1 }); };
    await tab.ev("window.__f = { n: 0, ms: 0, max: 0, long: 0 }"); const d0 = Date.now(); await drag(); const f = await tab.ev("window.__f");
    console.log("while panning:", JSON.stringify({ frames: f.n, avgMs: +(f.ms / (f.n || 1)).toFixed(1), maxMs: +f.max.toFixed(1), over16: f.long, tookMs: Date.now() - d0 }));
    // hover: the pointer moving over the graph with no button
    await tab.ev("window.__f = { n: 0, ms: 0, max: 0, long: 0 }");
    for (let i = 0; i < 60; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 150 + i * 5, y: 300 + i * 3 }); await sleep(16); }
    const h = await tab.ev("window.__f");
    console.log("while hovering:", JSON.stringify({ frames: h.n, avgMs: +(h.ms / (h.n || 1)).toFixed(1), maxMs: +h.max.toFixed(1), over16: h.long }));
    console.log("left alone again, 5 s:", JSON.stringify(await take(5000)));
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
