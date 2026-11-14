#!/usr/bin/env node
// Two lens states found on the real vault (audit:views, named and next):
//   - Folders drew a topic with one note in a big folder as a 3 px sliver nobody could press. Small shares are now one "smaller topics"
//     segment, and every segment is at least the minimum tap size, at desktop and phone size.
//   - A lens that takes a while to load said "Loading…" with nothing to press. It now names the lens and offers the way back.
//   node tests/test_lens_states.js [--vault [dir]]        exit 0 = pass
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env"), { VGRules: R } = env.notes();

// ---- the rule: shares under the floor are folded into one, and nothing is lost
assert.strictEqual(typeof R.foldSmall, "function", "the rules have no foldSmall");
{
  const f = R.foldSmall([["a", 60], ["b", 30], ["c", 5], ["d", 3], ["e", 2]], 0.15);
  assert.deepStrictEqual(f.kept, [["a", 60], ["b", 30]], "the big shares are kept, biggest first");
  assert.deepStrictEqual(f.rest, [["c", 5], ["d", 3], ["e", 2]], "the small shares are folded");
  const one = R.foldSmall([["a", 60], ["b", 30], ["c", 5]], 0.15);
  assert.deepStrictEqual([one.kept.length, one.rest.length], [3, 0], "a single small share is not folded: a group of one says less than its own name");
  const many = R.foldSmall(Array.from({ length: 30 }, (_, i) => ["k" + i, 1]), 0.15);
  assert.ok(many.kept.length + (many.rest.length ? 1 : 0) <= 7, "a folder with 30 equal topics must still fit seven segments: " + many.kept.length);
  assert.strictEqual(many.kept.length + many.rest.length, 30, "no topic is dropped");
}

const look = async mobile => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    await tab.ev(`window.vaultGraph._debug.openView("lens:folders")`); await sleep(700);
    const segs = await tab.ev(`[...document.querySelectorAll(".vg-lens-body .vg-fd-bar button")].map(b => { const r = b.getBoundingClientRect(), bar = b.parentElement.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), name: b.getAttribute("aria-label") || "", inside: r.right <= bar.right + 1, cl: b.dataset.cl }; })`);
    assert.ok(segs.length >= 2, "the Folders lens must draw bar segments to measure: " + segs.length);
    const min = mobile ? 40 : 24, small = segs.filter(s => s.w < min || s.h < min);
    assert.deepStrictEqual(small, [], `every segment is at least ${min} px to press (${mobile ? "phone" : "desktop"})`);
    assert.ok(segs.every(s => s.name), "every segment has a name");
    assert.ok(segs.every(s => s.inside), "no segment is pushed out of its bar: " + JSON.stringify(segs.filter(s => !s.inside)));

    // a slow lens: its loading state names it and has a button that goes back to the graph
    const had = await tab.ev(`(() => { const L = window.vaultGraph._debug.lensDefs(); L.drift.__load = L.drift.load; L.drift.load = () => new Promise(() => {}); return typeof L.drift.__load; })()`);
    assert.strictEqual(had, "function", "the Version drift lens must have a load() to hold open");
    await tab.ev(`window.vaultGraph._debug.openView("lens:drift")`); await sleep(500);
    const state = await tab.ev(`(() => { const e = document.querySelector(".vg-lens-body .vg-empty"), b = document.querySelector(".vg-lens-body .vg-empty-next button"); return e && { text: e.textContent, btn: b ? b.textContent.trim() : null }; })()`);
    assert.ok(state && /Loading Version drift/.test(state.text), "the loading state names the lens: " + JSON.stringify(state));
    assert.ok(state.btn, "the loading state has a button");
    await tab.ev(`document.querySelector(".vg-lens-body .vg-empty-next button").click()`); await sleep(400);
    assert.strictEqual(await tab.ev(`document.querySelector(".vg-lens").hidden`), true, "its button goes back to the graph");
    await tab.ev(`(() => { const L = window.vaultGraph._debug.lensDefs(); L.drift.load = L.drift.__load; })()`);
    // on a phone the side panel is a drawer: the topics card switches its tab, so the drawer has to stay open to show it
    if (mobile) {
      await tab.ev(`(() => { const r = document.querySelector(".vg-root"); r.classList.add("vg-side-open"); window.vaultGraph._debug.setTab && window.vaultGraph._debug.setTab("insights"); })()`);
      const card = await tab.ev(`(() => { const b = document.querySelector('.vg-panel [data-stat="topics"]'); if (!b) return null; b.click(); const r = document.querySelector(".vg-root"), t = document.querySelector('.vg-tab[aria-selected="true"]'); return { open: r.classList.contains("vg-side-open"), tab: t && t.dataset.tab }; })()`);
      assert.ok(card, "the Insights panel must have a topics card");
      assert.deepStrictEqual(card, { open: true, tab: "clusters" }, "the topics card shows the Topics tab, in a drawer that is still open");
    }
    return segs.length;
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
};
(async () => {
  const d = await look(false), m = await look(true);
  console.log(`ok - Folders segments can all be pressed (${d} at desktop size, ${m} at phone size), and a loading lens offers the way back`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
