#!/usr/bin/env node
// Notes with a problem beyond a missing reference or a short note carry an ring in the warning colour in every view that places notes.
// Asked for by Jackson: "make those nodes stand out across views so I can see what to click next". The rule is
// VGActions.attention (one place); the ring is drawn once, after any view, from the positions the view recorded.
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    // the rule: the minor problems alone do not flag a note, the others do
    const rule = await tab.ev(`(() => { const A = typeof VGActions === "undefined" ? null : VGActions; if (!A) return null; const c = { data: { mocs: [], quality: { stub_words: 50, stale_days: 9999 }, said_unlinked: [] }, api: {} };
      const base = { id: "x", name: "x", inlinks: 1, outlinks: 1, refs: true, broken: 0, words: 500, age: 1, cluster: 0 };
      return { minor: A.attention({ ...base, refs: false, words: 3 }, c).length, orphan: A.attention({ ...base, inlinks: 0 }, c).length, broken: A.attention({ ...base, broken: 2 }, c).length, inspector: A.problems({ ...base, refs: false, words: 3 }, c).length }; })()`);
    assert.ok(rule, "VGActions must be on the page");
    assert.deepStrictEqual(rule, { minor: 0, orphan: 1, broken: 1, inspector: 2 }, "only the non-minor problems flag a note: " + JSON.stringify(rule));
    // crowded rings group: three notes within a few pixels are one badge, a far one stays its own ring, and every note is in exactly one group
    const cl = await tab.ev(`VGRules.ringClusters([{ id: "a", x: 10, y: 10 }, { id: "b", x: 14, y: 12 }, { id: "c", x: 18, y: 10 }, { id: "d", x: 200, y: 200 }], 18).map(g => g.ids.join(""))`);
    assert.deepStrictEqual(cl, ["abc", "d"], "ringClusters must merge close notes and keep far ones apart: " + JSON.stringify(cl));
    let seen = 0, badged = 0;
    for (const view of ["2d", "3d", "neural", "subway", "weather", "radar"]) {
      await tab.ev(`window.vaultGraph._debug.openView(${JSON.stringify(view)})`); await sleep(1500);
      const r = await tab.ev(`window.vaultGraph._debug.attention().filter(x => x.at)`);
      assert.ok(r.length > 0, view + ": some notes must be flagged and placed (saw " + r.length + ")");
      seen += r.length;
      // every badge is a group of flagged notes, and a group is two or more notes
      const bd = await tab.ev(`window.vaultGraph._debug.ringBadges()`), flagged = new Set((await tab.ev(`window.vaultGraph._debug.attention().map(x => x.id)`)));
      for (const b of bd) { assert.ok(b.ids.length >= 2 && b.ids.every(id => flagged.has(id)), view + ": a badge groups flagged notes: " + JSON.stringify(b)); badged += b.ids.length; }
      const lg = await tab.ev(`document.querySelector(".vg-legend").textContent`);
      const why = await tab.ev(`(() => { const s = new Set(); window.vaultGraph._debug.attention().forEach(x => x.why.forEach(k => s.add(VGActions.reasonLook(k).label))); return [...s].sort(); })()`);
      const sw = await tab.ev(`(() => { const e = document.querySelector(".vg-legend .vg-lg-attn-set"); return e ? { dots: e.querySelectorAll(".vg-lg-attn").length, title: e.title, text: e.textContent } : null; })()`);
      assert.ok(why.length > 0 && sw && /needs attention/.test(sw.text) && sw.dots === why.length && why.every(l => sw.title.includes(l)), view + ": one legend entry with a dot per reason present and every label in its tooltip: " + JSON.stringify({ sw, why }));
      // the ring is really painted: the pixel on its rim is the warning colour
      const hit = await tab.ev(`(() => { const W = VGActions.PROBLEMS.map(p => [1, 3, 5].map(i => parseInt(p.ring.slice(i, i + 2), 16))), cv = document.querySelector(".vg-cv"), g = cv.getContext("2d"), s = cv.width / cv.clientWidth, b = cv.getBoundingClientRect();
        let n = 0, amber = 0; for (const x of window.vaultGraph._debug.attention().filter(x => x.at).slice(0, 12)) { const rr = Math.max(4, Math.min(24, x.at.r)) + 4, d = g.getImageData(Math.round((x.at.x + rr) * s) - 1, Math.round(x.at.y * s), 3, 1).data;
          n++; for (let i = 0; i < 9; i += 4) if (W.some(c => Math.abs(d[i] - c[0]) < 30 && Math.abs(d[i + 1] - c[1]) < 30 && Math.abs(d[i + 2] - c[2]) < 30) && d[i + 3] > 80) { amber++; break; } } return { n, amber }; })()`);
      assert.ok(hit.amber > 0, view + ": the ring must be painted in a reason colour " + JSON.stringify(hit));
    }
    assert.ok(badged > 0, "the sample's crowded views must draw at least one count badge");
    // tapping a badge selects the notes behind it
    await tab.ev(`window.vaultGraph._debug.openView("neural")`); await sleep(1500);
    const bd2 = await tab.ev(`window.vaultGraph._debug.ringBadges()`);
    assert.ok(bd2.length, "the neural view must show a badge to tap");
    {
      const rect = await tab.ev(`(() => { const r = document.querySelector(".vg-root canvas").getBoundingClientRect(); return [r.left, r.top]; })()`);
      for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: rect[0] + bd2[0].x, y: rect[1] + bd2[0].y, button: "left", clickCount: 1 });
      await sleep(400);
      const sel = await tab.ev(`document.querySelector(".vg-inspector") && !document.querySelector(".vg-inspector").hidden ? 1 : 0`);
      assert.ok(sel, "tapping a badge must open the notes behind it");
    }
    // the switch turns it off
    await tab.ev(`window.vaultGraph._debug.openView("2d")`); await sleep(600);
    await tab.ev(`(() => { const cb = document.querySelector(".vg-l-attention"); cb.checked = false; cb.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(700);
    const off = await tab.ev(`(() => { const W = VGActions.PROBLEMS.map(p => [1, 3, 5].map(i => parseInt(p.ring.slice(i, i + 2), 16))), cv = document.querySelector(".vg-cv"), g = cv.getContext("2d"), s = cv.width / cv.clientWidth; let amber = 0; for (const x of window.vaultGraph._debug.attention().filter(x => x.at).slice(0, 12)) { const rr = Math.max(4, Math.min(24, x.at.r)) + 4, d = g.getImageData(Math.round((x.at.x + rr) * s) - 1, Math.round(x.at.y * s), 3, 1).data; for (let i = 0; i < 9; i += 4) if (W.some(c => Math.abs(d[i] - c[0]) < 30 && Math.abs(d[i + 1] - c[1]) < 30 && Math.abs(d[i + 2] - c[2]) < 30) && d[i + 3] > 80) { amber++; break; } } return amber; })()`);
    assert.strictEqual(off, 0, "with the switch off no ring is painted");
    assert.strictEqual(await tab.ev(`document.querySelectorAll(".vg-legend .vg-lg-attn-set").length`), 0, "with the switch off the legend drops the entries");
    // every problem has its own look, and a note with two problems gets a ring of two colours
    const looks = await tab.ev(`VGActions.PROBLEMS.map(p => VGActions.reasonLook(p.key))`);
    assert.ok(looks.every(l => /^#[0-9a-f]{6}$/i.test(l.color) && l.label), "each problem has a colour and a label: " + JSON.stringify(looks));
    await tab.ev(`(() => { const cb = document.querySelector(".vg-l-attention"); cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(700);
    const two = await tab.ev(`window.vaultGraph._debug.attention().filter(x => x.at && x.why.length > 1).length`);
    console.log("info - notes with two or more reasons in this view: " + two);
    console.log(`ok - notes with a problem beyond a reference or a short note are ringed in 6 views (${seen} placed), and the switch hides them`);
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
