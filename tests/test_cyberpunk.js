#!/usr/bin/env node
// The Cyberpunk view in headless Chrome: every linked note is a tower in its district, a click on one selects its note
// (the graph's own hit test), a frame stays inside its budget, and it draws on a vault of any size without errors.
//   node tests/test_cyberpunk.js [--vault [dir]] [--shots dir]        exit 0 = pass
const fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
(async () => {
  const tab = await cdp.open({ html: env.page(), port: 9357 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug";
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove()); ${D}.setView("cyberpunk")`); await sleep(1800); await tab.ev(`${D}.drawNow()`);
    const shot = async name => { if (!SHOTS) return; await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove()); ${D}.drawNow()`); await sleep(100); fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
    await shot("city");
    const city = await tab.ev(`(() => { const m = ${D}.maps().cyberpunk, have = new Set(m.blds.map(b => b.n.id)), want = ${D}.nodes.filter(n => !n.ghost && !n.person && !n.moc); return { towers: m.blds.length, missing: want.filter(n => !have.has(n.id)).length, districts: m.districts.length }; })()`);
    check(city.towers > 0 && city.missing === 0, `notes with no tower: ${JSON.stringify(city)}`);
    const ms = await tab.ev(`(() => { let t = 0; for (let i = 0; i < 20; i++) t += ${D}.drawNow(); return t / 20; })()`);
    console.log(`  cyberpunk: ${city.towers} towers in ${city.districts} districts, ${ms.toFixed(1)} ms a frame`);
    check(ms < 33, `a frame takes ${ms.toFixed(1)} ms (30 fps is 33)`);
    // a click on a tower selects its note: the tallest one drawn on screen, away from the toolbars
    await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`);   // the first-run tour comes back after the view changes and sits over the canvas
    const target = await tab.ev(`(() => { const P = ${D}.P; let best = null; P.forEach((p, id) => { if (p.a > 0.5 && p.r > 4 && p.x > 320 && p.x < innerWidth - 40 && p.y > 90 && p.y < innerHeight - 90 && (!best || p.depth < best.depth || p.r > best.r)) best = { id, x: p.x, y: p.y, r: p.r }; }); return best; })()`);
    check(target, "no tower on screen to click");
    if (target) { const r = await tab.ev(`(() => { const b = document.querySelector('.vg-cv').getBoundingClientRect(); return [b.left, b.top]; })()`);
      const x = r[0] + target.x, y = r[1] + target.y, over = await tab.ev(`document.elementFromPoint(${x}, ${y}).className`);
      check(String(over).includes("vg-cv"), `something covers the tower: ${over}`);
      for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); await sleep(200);
      check(await tab.ev(`!!${D}.st.selected`), "clicking a tower selected nothing"); await tab.ev(`${D}.drawNow()`); await shot("selected"); }
    await tab.ev(`${D}.st.selected = null`);
    const errs = await tab.ev("window.__errs");
    check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); }
  await tab.close();
  console.log(fails.length ? "FAIL - cyberpunk: " + fails.join("; ") : "ok - cyberpunk: a tower per note, clicks select, frame budget");
  process.exit(fails.length ? 1 : 0);
})();
