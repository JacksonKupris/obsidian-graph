#!/usr/bin/env node
// 2D and 3D are one control in every view: the same switch in the same place, the same key, and in 3D a real click still
// lands on the note under the pointer. Time-lapse runs the same way in 2D and 3D. A retired view in a saved state or a
// link opens the map instead of a blank page; the game has no switch.
//   node tests/test_dimensions.js [--vault [dir]]        exit 0 = pass
const cdp = require("./cdp"), env = require("./env");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tab = await cdp.open({ html: env.page(), port: 9359 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug", q = s => `document.querySelector(${JSON.stringify(s)})`;
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove())`);
    const pressed = () => tab.ev(`(document.querySelector('[data-dim][aria-pressed="true"]') || {dataset: {}}).dataset.dim`);
    const key = k => tab.ev(`${q(".vg-root")}.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
    const views = await tab.ev(`${D}.views()`), out = [];
    let spot = null;
    for (const v of views) {
      await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove()); ${D}.setView(${JSON.stringify(v)})`); await sleep(v === "2d" || v === "3d" ? 500 : 1100); await tab.ev(`${D}.drawNow()`);
      const shows = await tab.ev(`!${q(".vg-dimseg")}.hidden && !!${q(".vg-dimseg")}.offsetParent`);
      if (v === "dungeon") { if (shows) out.push("dungeon: a game has no 2D/3D switch"); continue; }
      if (!shows) { out.push(`${v}: no 2D/3D switch`); continue; }
      const first = await pressed(), other = first === "3d" ? "2d" : "3d";
      await tab.ev(`${q(`[data-dim="${other}"]`)}.click()`); await sleep(v === "2d" || v === "3d" ? 400 : 120);
      const now = await tab.ev(`${D}.st.view`);
      if (v === "2d" || v === "3d") { if (now !== other) out.push(`${v}: the switch didn't change the layout`); }
      else if (await pressed() !== other) out.push(`${v}: the switch stayed on ${first}`);
      await tab.ev(`${D}.drawNow()`);
      // Time-lapse works the same in either
      await tab.ev(`${q(".vg-maptime")}.click()`); const r = await tab.ev(`!!${D}.replay()`); await tab.ev(`if (${D}.replay()) ${q(".vg-time-close")}.click()`); if (!r) out.push(`${v}: no time-lapse in ${other}`);
      await key("3"); await sleep(v === "2d" || v === "3d" ? 400 : 120); if (v !== "2d" && v !== "3d" && await pressed() !== first) out.push(`${v}: the 3 key didn't switch back`);
      if (v === "2d" || v === "3d") await tab.ev(`${D}.setView(${JSON.stringify(v)})`);
    }
    out.forEach(x => fails.push(x));
    // in 3D a real click lands on the note under the pointer: the perspective is undone for the hit test
    await tab.ev(`${D}.setView("radar")`); await sleep(1200); await tab.ev(`${q('[data-dim="3d"]')}.click()`); await sleep(500); await tab.ev(`${D}.drawNow()`);
    const tilted = await tab.ev(`${q(".vg-cv")}.classList.contains("is-tilt3d")`); check(tilted, "radar in 3D doesn't lean back");
    // find where on the screen a note ended up by asking: move the real mouse, read where the browser says it is on the canvas
    const target = await tab.ev(`(() => { const cv = ${q(".vg-cv")}; let best = null; ${D}.P.forEach((p, id) => { if (p.a > 0.5 && p.r > 3 && !best && p.x > cv.clientWidth * 0.3 && p.x < cv.clientWidth * 0.7 && p.y > cv.clientHeight * 0.35 && p.y < cv.clientHeight * 0.7) best = { id, x: p.x, y: p.y }; }); return best; })()`);
    check(target, "no note in the middle of Radar to click");
    if (target) {
      await tab.ev(`window.__at = null; ${q(".vg-cv")}.addEventListener("pointermove", e => { window.__at = [e.offsetX, e.offsetY]; }, true)`);
      let sx = target.x + 300, sy = target.y + 80;
      for (let i = 0; i < 12; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: sx, y: sy, button: "none" }); await sleep(30);
        const at = await tab.ev("window.__at"); if (!at) { sx += 7; continue; } sx += (target.x - at[0]) * 0.9; sy += (target.y - at[1]) * 0.9; }
      await tab.ev(`${D}.st.selected = null`);
      for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: sx, y: sy, button: "left", clickCount: 1 });
      await sleep(200); check(await tab.ev(`${D}.st.selected`) === target.id, `a click in 3D selected ${await tab.ev(`${D}.st.selected`)}, not the note under the pointer ${target.id}`);
    }
    await tab.ev(`${D}.st.selected = null; ${q('[data-dim="2d"]')}.click()`);
    // a retired view opens the map
    await tab.ev(`${D}.setView("garden")`); await sleep(300); check(await tab.ev(`${D}.st.view`) === "2d", "a retired view didn't open the map");
    const errs = await tab.ev("window.__errs");
    check(!errs.length, "page errors: " + errs.join("; "));
    console.log(`  dimensions: ${views.length} views`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  console.log(fails.length ? "FAIL - dimensions:\n    " + fails.join("\n    ") : "ok - 2D/3D: one switch in every view, the 3 key, Time-lapse in both, clicks land in 3D, retired views open the map");
  process.exit(fails.length ? 1 : 0);
})();
