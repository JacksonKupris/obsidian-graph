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
    // the still city is kept: a frame paints the kept picture and what moves, and doesn't walk the towers. Counted on the real canvas.
    const count = code => tab.ev(`(() => { const p = CanvasRenderingContext2D.prototype, was = {}, n = { fillRect: 0, drawImage: 0 }, main = document.querySelector(".vg-cv").getContext("2d"); for (const m of Object.keys(n)) { was[m] = p[m]; p[m] = function (...a) { n[m]++; n[m + "On"] = (n[m + "On"] || 0) + (this === main ? 1 : 0); return was[m].apply(this, a); }; } try { ${code} } finally { Object.assign(p, was); } return n; })()`);
    await tab.ev(`${D}.drawNow()`);
    const still = await count(`${D}.drawNow();`), towers = city.towers;
    check(still.drawImage <= 2 && still.fillRect <= 6, `a still frame should show the kept city, not repaint it: ${JSON.stringify(still)}`);
    const moved = await count(`${D}.cam.tx += 40; ${D}.drawNow();`);
    check(moved.fillRect > still.fillRect + Math.min(5, towers), `a moved camera should repaint it: ${JSON.stringify(moved)}`);
    const pick = await tab.ev(`${D}.P.size`); check(pick >= towers * 0.5, `clicks still need every tower after a kept frame: ${pick}`);
    await tab.ev(`${D}.cam.tx -= 40; ${D}.drawNow()`);
    const firstId = await tab.ev(`${D}.maps().cyberpunk.blds[0].n.id`);
    const filter = await count(`${D}.st.hidden.add(${JSON.stringify(firstId)}); ${D}.drawNow();`); check(filter.fillRect > still.fillRect, "hiding a note should repaint the city"); await tab.ev(`${D}.st.hidden.delete(${JSON.stringify(firstId)}); ${D}.drawNow()`);
    // it's still alive: the rain and traffic change the picture from one frame to the next
    const shotOf = () => tab.ev(`(() => { const c = document.querySelector(".vg-cv"); return c.toDataURL("image/jpeg", 0.5).length + ":" + c.toDataURL("image/jpeg", 0.5).slice(2000, 2060); })()`);
    const a1 = await shotOf(); await sleep(300); await tab.ev(`${D}.drawNow()`); check(a1 !== await shotOf(), "the picture should move");
    const errs = await tab.ev("window.__errs");
    check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); }
  await tab.close();
  // a phone: at most 20 frames a second, the kept picture slid while it's moved, and it catches up with the camera by itself
  const phone = await cdp.open({ html: env.pageWith("mobile: true,"), port: 9358 });
  if (phone) { try {
    if (!await phone.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount on a phone");
    await phone.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    const D = "window.vaultGraph._debug"; await phone.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove()); ${D}.setView("cyberpunk")`); await sleep(1800);
    check(await phone.ev(`document.querySelector(".vg-root").classList.contains("is-mobile")`), "the page isn't a phone");
    const fps = await phone.ev(`(async () => { const main = document.querySelector(".vg-cv").getContext("2d"), was = main.drawImage; let n = 0; main.drawImage = function (...a) { n++; return was.apply(this, a); }; await new Promise(r => setTimeout(r, 2000)); delete main.drawImage; return { perSec: n / 2, focus: document.hasFocus() }; })()`);
    check(fps.perSec <= 24, `a phone should draw at most 20 frames a second: ${JSON.stringify(fps)}`); if (fps.focus) check(fps.perSec >= 8, `it should still move: ${JSON.stringify(fps)}`);
    const slide = await phone.ev(`(() => { const d = window.vaultGraph._debug; d.drawNow(); const c = document.querySelector(".vg-cv").getContext("2d"), was = CanvasRenderingContext2D.prototype.fillRect; let fills = 0; CanvasRenderingContext2D.prototype.fillRect = function (...a) { fills++; return was.apply(this, a); }; d.cam.tx += 30; d.drawNow(); CanvasRenderingContext2D.prototype.fillRect = was; d.cam.tx -= 30; return fills; })()`); check(slide <= 8, `moving on a phone should slide the kept picture, not repaint it: ${slide} fills`);
    await sleep(200); const before = await phone.ev(`${D}.drawNow(); ${D}.scenes && [...${D}.P.values()].filter(p => p.a > 0).map(p => Math.round(p.x)).slice(0, 5).join()`);
    await phone.ev(`${D}.cam.tx += 120; window.dispatchEvent(new Event("resize"))`); await sleep(500);
    const after = await phone.ev(`[...${D}.P.values()].filter(p => p.a > 0).map(p => Math.round(p.x)).slice(0, 5).join()`); check(before !== after, "on a phone the city should catch up with the camera");
    check((await phone.ev("window.__errs || []")).length === 0, "page errors on a phone");
  } catch (e) { fails.push(e.message); } await phone.close(); }
  console.log(fails.length ? "FAIL - cyberpunk: " + fails.join("; ") : "ok - cyberpunk: a tower per note, clicks select, frame budget");
  process.exit(fails.length ? 1 : 0);
})();
