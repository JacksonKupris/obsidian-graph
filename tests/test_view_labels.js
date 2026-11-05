#!/usr/bin/env node
// What the map views write stays readable. Subway: no two station names touch, and none sits on a station. Radar: the whole scope and its
// topic names fit under the toolbar, and a waiting note stays in its topic's slice, next to its name. Heat clock: a click on a ring opens
// that topic. Read from what the page really draws (fillText on a canvas), on the real view code.
//   node tests/test_view_labels.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
// every text drawn in the next repaint, with the box it covers on screen
const CAPTURE = `(() => { const d = window.vaultGraph._debug, p = CanvasRenderingContext2D.prototype, was = p.fillText, out = []; p.fillText = function (t, x, y, m) { const a = this.getTransform().a, w = this.measureText(t).width, al = this.textAlign, left = al === "center" ? x - w / 2 : al === "right" || al === "end" ? x - w : x; out.push({ t: String(t), x: left, y: y - 6, w, h: 12, font: this.font }); return was.call(this, t, x, y, m); };
  try { d.drawNow(); } finally { p.fillText = was; } return out; })()`;
const near = (a, b, gapX, gapY) => a.x < b.x + b.w + gapX && a.x + a.w + gapX > b.x && a.y < b.y + b.h + gapY && a.y + a.h + gapY > b.y;
(async () => {
  const tab = await openPage({ html: env.pageWith("") });
  const D = "window.vaultGraph._debug", ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.waitFor(`document.querySelector(".vg-tour-card") ? 1 : 0`, 8000);
    await ev(`(() => { const s = [...document.querySelectorAll(".vg-tour-card button")].find(b => b.textContent.trim() === "Skip"); if (s) s.click(); })()`);
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1384, height: 860, deviceScaleFactor: 1, mobile: false });

    // ---- Subway
    await ev(`${D}.setView("subway")`); await sleep(2400);
    const texts = await ev(CAPTURE), pos = await ev(`${D}.nodes.filter(n => ${D}.screen(n.id)).map(n => ({ id: n.id, name: n.name, ...${D}.screen(n.id) }))`);
    const names = new Set(pos.map(p => p.name)), clipped = s => [...names].some(n => n === s || (s.endsWith("…") && n.startsWith(s.slice(0, -1))));
    const stations = texts.filter(t => clipped(t.t));
    check(stations.length > 5, `Subway: only ${stations.length} station names drawn`);
    const close = []; stations.forEach((a, i) => stations.slice(i + 1).forEach(b => { if (near(a, b, 6, -2)) close.push(`${a.t} / ${b.t}`); }));
    check(!close.length, `Subway: station names touching (${close.length}): ${close.slice(0, 5).join("; ")}`);
    const onDot = []; stations.forEach(a => pos.forEach(p => { if (p.x > a.x && p.x < a.x + a.w && p.y > a.y && p.y < a.y + a.h) onDot.push(`${a.t} on ${p.name}`); }));
    check(!onDot.length, `Subway: names drawn over a station (${onDot.length}): ${onDot.slice(0, 5).join("; ")}`);

    // ---- Radar
    await ev(`${D}.setView("radar")`); await sleep(2400);
    const geo = await ev(`${D}.radarScope()`); check(geo, "the radar has no scope");
    if (geo) { check(geo.top >= geo.under, `Radar: the top of the scope is at ${Math.round(geo.top)}, under the toolbar at ${geo.under}`);
      check(geo.bottom <= geo.H, `Radar: the bottom of the scope is at ${Math.round(geo.bottom)} of ${geo.H}`); check(geo.left >= 0 && geo.right <= geo.W, `Radar: the scope runs ${Math.round(geo.left)} to ${Math.round(geo.right)} of ${geo.W}`);
      const held = geo.held; check(held, "Radar: no note waiting 90+ days to check");
      if (held) { const angle = () => ev(`(() => { ${D}.drawNow(); const p = ${D}.screen(${JSON.stringify(held)}), g = ${D}.radarScope(); return Math.atan2(p.y - g.cy, p.x - g.cx); })()`);
        const a0 = await angle(); await sleep(2500); const a1 = await angle(); let moved = Math.abs(a1 - a0); if (moved > Math.PI) moved = 2 * Math.PI - moved;
        check(moved < 0.12, `Radar: a waiting note drifted ${moved.toFixed(2)} rad in 2.5 s, out of its topic's slice`); } }

    // ---- Heat clock
    await ev(`${D}.setView("clock")`); await sleep(2400);
    const ring = await ev(`${D}.clockRing(1)`); check(ring, "the clock has no ring to press");
    if (ring) { const box = await ev(`(() => { const r = document.querySelector(".vg-cv").getBoundingClientRect(); return { x: r.left, y: r.top }; })()`), X = box.x + ring.x, Y = box.y + ring.y;
      for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: X, y: Y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
      await sleep(250); check(await ev(`${D}.st.clockFocus`) === ring.c, `Heat clock: pressing a ring opened ${await ev(`${D}.st.clockFocus`)}, want topic ${ring.c}`); }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Map views: names don't touch, the radar fits and holds its slices, the clock's rings open their topic");
})();
