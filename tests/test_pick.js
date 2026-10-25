#!/usr/bin/env node
// A note you can see, you can click: map views draw unlinked notes (the garden's nursery, the palace storeroom,
// the city's outskirts), and a real click on one selects it. Real mouse events over the DevTools protocol.
//   node tests/test_pick.js [--vault [dir]]        exit 0 = pass
const cdp = require("./cdp"), env = require("./env");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tab = await cdp.open({ html: env.page(), port: 9339 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [];
  try {
    await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await sleep(1500);
    for (const v of ["garden", "palace", "city"]) {
      await tab.ev(`window.vaultGraph._debug.setView(${JSON.stringify(v)})`); await sleep(2500);
      const t = JSON.parse(await tab.ev(`(() => { const D = window.vaultGraph._debug, r = document.querySelector("canvas").getBoundingClientRect();
        const n = D.nodes.find(n => n.isolated && !n.ghost && D.P.get(n.id) && D.P.get(n.id).r && D.P.get(n.id).a > 0.5);
        if (!n) return "null"; const p = D.P.get(n.id); return JSON.stringify({ id: n.id, x: r.left + p.x, y: r.top + p.y }); })()`));
      if (!t) { fails.push(`${v}: no unlinked note drawn to click`); continue; }
      for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: t.x, y: t.y, button: "left", clickCount: 1 });
      await sleep(600);
      const sel = await tab.ev("window.vaultGraph._debug.st.selected || null");
      if (sel !== t.id) fails.push(`${v}: clicking ${t.id} selected ${sel}`);
      await tab.ev("window.vaultGraph._debug.st.selected = null");
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  console.log(fails.length ? "FAIL - " + fails.join("; ") : "ok - unlinked notes in map views can be clicked");
  process.exit(fails.length ? 1 : 0);
})();
