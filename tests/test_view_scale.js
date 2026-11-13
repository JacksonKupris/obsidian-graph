#!/usr/bin/env node
// The view manifest (first phase): every view says what scale it is about, from one table in rules.js. A view with no entry, or a
// scale that isn't on the ladder, fails here, so a new view can't ship without one. Decided 2026-11-12 (cohesion, phase 1).
const assert = require("assert");
const { openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    const views = await tab.ev(`window.vaultGraph._debug.allViews().map(v => [v.key, v.scale])`);
    assert.ok(views.length > 40, `the audit must see the views: ${views.length}`);
    const ladder = await tab.ev(`VGRules.SCALES`);
    const bad = views.filter(([, s]) => !ladder.includes(s)).map(([k, s]) => `${k}: ${s}`);
    assert.deepStrictEqual(bad, [], `views with no scale on the ladder (${ladder.join(", ")}): ${bad.join("; ")}`);
    // the table holds no view that doesn't exist (a renamed view leaves a dead entry)
    const keys = new Set(views.map(([k]) => k.replace(/-lib$/, "")));
    const dead = await tab.ev(`Object.keys(VGRules.VIEW_SCALES)`).then(a => a.filter(k => !keys.has(k)));
    assert.deepStrictEqual(dead, [], `scales for views that don't exist: ${dead.join(", ")}`);
    // the science label is a tag on the tile (`field`), not the first words of the hint (decided 2026-11-12)
    const all = await tab.ev(`window.vaultGraph._debug.allViews().map(v => [v.key, v.field, v.hint])`);
    const lead = all.filter(([, , h]) => /^(Lean manufacturing|Manufacturing|Clinical trials|Finance|Ecology|Gene editing|Epidemiology|Reliability engineering|Reservoir computing)\b[^:]*: /.test(h || "")).map(([k]) => k);
    assert.deepStrictEqual(lead, [], `hints that start with a field label (use field): ${lead.join(", ")}`);
    const tagged = all.filter(([, f]) => f).length; assert.ok(tagged >= 10, `the science views carry a field tag: ${tagged}`);
    // every menu entry has its own icon: none is the generic grid (except the matrix, which is one), and none repeats within a menu group
    const withMenu = await tab.ev(`window.vaultGraph._debug.allViews().filter(v => v.menu).map(v => [v.key, v.menu, v.icon])`);
    assert.ok(withMenu.length >= 40, `menu views seen: ${withMenu.length}`);
    const generic = withMenu.filter(([k, , i]) => !i || (i === "grid" && k !== "lens:matrix")).map(([k]) => k);
    assert.deepStrictEqual(generic, [], `views on the generic icon: ${generic.join(", ")}`);
    const seenIc = new Map(), dup = [];
    for (const [k, m, i] of withMenu) { const id = m + "|" + i; if (seenIc.has(id)) dup.push(`${seenIc.get(id)} + ${k} (${i}, ${m})`); else seenIc.set(id, k); }
    assert.deepStrictEqual(dup, [], `icons repeated within a menu group: ${dup.join("; ")}`);
    console.log(`ok - view manifest: all ${views.length} views declare a scale on the ladder, and the table has no dead entries`);
  } catch (e) { console.log("FAIL - view scale:\n  " + (e.message || e)); process.exitCode = 1; } finally { await tab.close(); }
})();
