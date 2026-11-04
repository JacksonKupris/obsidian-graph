#!/usr/bin/env node
// A saved view keeps its Cosmos sky: the bodies and the switches come back, a copy so moving them doesn't change the view, and a
// view saved before this leaves the current sky alone. A body with no orbit yet (a view written by hand) gets one.
//   node tests/test_cosmos_views.js        exit 0 = pass
const { openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.page() });
  if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) { console.log("FAIL - cosmos views: the page did not mount"); process.exit(1); }
  const r = JSON.parse(await tab.ev(`(async () => { const D = window.vaultGraph._debug, S = D.saved, out = {}, wait = ms => new Promise(r => setTimeout(r, ms)), note = D.nodes.find(n => !n.person && !n.moc && !n.ghost && !n.isolated).id;
    D.setView("cosmos"); await wait(400);
    const hand = { name: "by hand", view: "cosmos", cam: { k: 0.3, tx: 0, ty: 0, cx: 0, cy: 0, cz: 0, yaw: 0, pitch: 0 }, layers: {}, cosmos: { bodies: [{ id: "h1", type: "star", target: note, name: "", parent: null }, { id: "h2", type: "blackhole", target: "tasks", name: "", parent: null }], auto: { trails: false, grid: false } } };
    S.apply(hand); await wait(300);
    out.handBodies = S.bodies().map(b => b.id); out.orbits = S.bodies().every(b => b.rx != null && Number.isFinite(b.x)); out.auto = [S.auto().trails, S.auto().grid, S.auto().motion]; out.pressed = document.querySelector('.vg-autobtn[data-auto="trails"]').getAttribute("aria-pressed"); out.captured = S.captured().h1 > 0;
    S.bodies()[0].x += 500; S.bodies().pop(); out.viewKept = hand.cosmos.bodies.length;
    const snap = S.snapshot("mine"); out.snapBodies = snap.cosmos.bodies.length; out.snapAuto = snap.cosmos.auto.trails; S.bodies()[0].mass = 9; out.snapCopy = snap.cosmos.bodies[0].mass === undefined;
    S.apply({ name: "older", view: "cosmos", layers: {}, cam: hand.cam }); await wait(100); out.olderLeft = S.bodies().length;
    S.apply(snap); await wait(200); out.restored = S.bodies().length === 1 && S.bodies()[0].id === "h1" && S.bodies()[0].mass === undefined;   // its orbit carries on, so where it is has moved
    D.setView("2d"); await wait(200); out.other = "cosmos" in S.snapshot("flat");
    return JSON.stringify(out); })()`));
  await tab.close();
  const want = { handBodies: ["h1", "h2"], orbits: true, auto: [false, false, true], pressed: "false", captured: true, viewKept: 2, snapBodies: 1, snapAuto: false, snapCopy: true, olderLeft: 1, restored: true, other: false };
  const off = Object.keys(want).filter(k => JSON.stringify(r[k]) !== JSON.stringify(want[k])).map(k => `${k}: got ${JSON.stringify(r[k])}, want ${JSON.stringify(want[k])}`);
  console.log(off.length ? "FAIL - cosmos views:\n  " + off.join("\n  ") : "ok - cosmos views: a saved view keeps its bodies and switches, as a copy; an older view leaves the sky alone");
  process.exit(off.length ? 1 : 0);
})().catch(e => { console.log("FAIL - cosmos views: " + e.message); process.exit(1); });
