#!/usr/bin/env node
// Randomize / Reset layout in every view, in headless Chrome: randomizing moves the notes, resetting brings back
// the exact default layout (2D/3D: the arrangement you had). In Cosmos it's the bodies that move, and Reset puts them back.
//   node tests/layout_random.js [--vault [dir]]        exit 0 = pass
const { openPage } = require("./kit");
const cdp = require("./cdp"), page = require("./env").page();
const probe = `<script>
setTimeout(async () => {
  const D = window.vaultGraph._debug, sleep = ms => new Promise(r => setTimeout(r, ms)), res = [], errs = [];
  addEventListener("error", e => errs.push(String(e.message)));
  // the layout itself, not the animated frame: scene targets, neural brain positions, or the 2D/3D positions
  const ids = D.nodes.filter(n => !n.ghost && !n.person).slice(0, 400).map(n => n.id), byId = new Map(D.nodes.map(n => [n.id, n]));
  const snap = v => ids.map(id => { const n = byId.get(id);
    if (v === "neural") return [Math.round(n.bx || 0), Math.round(n.by || 0)];
    if (v === "2d" || v === "3d") return [Math.round(n.x), Math.round(n.y)];
    const p = D.maps()[v] && D.maps()[v].pos.get(id); return p ? [Math.round(p[0]), Math.round(p[1])] : [0, 0]; });
  const settle = async () => { for (let i = 0; i < 60 && D.alpha() > 0.01; i++) await sleep(250); };
  const moved = (a, b) => a.filter((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > 20).length / a.length;
  for (const v of D.views()) {
    if (D.scenes()[v] && D.scenes()[v].game) { D.setView(v); await sleep(600); if (!document.querySelector(".vg-randlayout").hidden) errs.push(v + ": a game shouldn't offer Randomize"); continue; }
    if (v === "cosmos") {
      try {
        D.setView(v); await sleep(1500); D.st.paused = true; await sleep(150);   // orbits held still, so only the buttons move a body
        const sky = () => D.saved.bodies().map(b => [Math.round(b.x), Math.round(b.y)]), a = sky(); if (a.length < 2) throw new Error("no bodies to randomize");
        const rand = document.querySelector(".vg-randlayout"); if (rand.hidden) throw new Error("no Randomize in Cosmos");
        rand.click(); await sleep(200); const b = sky(), resetShown = !document.querySelector(".vg-resetlayout").hidden;
        rand.click(); await sleep(200); const b2 = sky();
        document.querySelector(".vg-resetlayout").click(); await sleep(200); const c = sky();
        if (moved(b, b2) < 0.5) throw new Error("Cosmos: a second Randomize should give another sky");
        res.push({ v, changed: +moved(a, b).toFixed(2), back: +moved(a, c).toFixed(2), resetShown, resetHidden: document.querySelector(".vg-resetlayout").hidden });
        D.st.paused = false;
      } catch (e) { errs.push(v + ": " + e.message); }
      continue;
    }
    try {
      D.setView(v); await sleep(1300); await settle();
      const a = snap(v);
      document.querySelector(".vg-randlayout").click(); await sleep(1300); await settle();
      const b = snap(v), resetShown = !document.querySelector(".vg-resetlayout").hidden;
      document.querySelector(".vg-resetlayout").click(); await sleep(300);
      const c = v === "2d" || v === "3d" ? a.map((_, i) => { const L = D.layouts[v === "3d" ? "3d" : "2d"][ids[i]]; return L ? [Math.round(L[0]), Math.round(L[1])] : [0, 0]; }) : snap(v);
      res.push({ v, changed: +moved(a, b).toFixed(2), back: +moved(a, c).toFixed(2), resetShown, resetHidden: document.querySelector(".vg-resetlayout").hidden });
    } catch (e) { errs.push(v + ": " + e.message); }
  }
  window.__layout = JSON.stringify({ res, errs });
}, 1500);
</script>`;
// in real time over the DevTools protocol (tests/cdp.js), as the smoke test does
(async () => {
  let tab;
  try { tab = await openPage({ html: page.replace("</body>", () => probe + "</body>") }); } catch (e) { console.log("FAIL - " + e.message); process.exit(1); }
  let why = "the page crashed or took over 15 minutes";
  const got = await tab.waitFor("window.__layout || null", 15 * 60 * 1000).catch(e => { why = e.message; return null; });
  await tab.close();
  if (!got) { console.log(`FAIL - the probe never reported (${why})`); process.exit(1); }
  const { res, errs } = JSON.parse(got);
  const bad = res.filter(r => r.changed < 0.2 || r.back > 0.05 || !r.resetShown || !r.resetHidden);
  res.forEach(r => console.log(`  ${bad.includes(r) ? "FAIL" : "ok  "}  ${r.v.padEnd(9)} randomize moved ${Math.round(r.changed * 100)}%, reset left ${Math.round(r.back * 100)}% moved`));
  errs.forEach(e => console.log("  error: " + e));
  process.exit(bad.length || errs.length ? 1 : 0);
})();
