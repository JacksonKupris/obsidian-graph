#!/usr/bin/env node
// More / Less like this: reactions move a kind up or down by a capped amount, both devices' count, only upkeep can be
// hidden and it can be shown again; the buttons reach the host and say what happened with an Undo; and typing in HQ's
// search never rebuilds the box being typed in. Also the plugin's birth-date rule.
//   node tests/test_hq_reactions.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
const data = { nodes: [{ id: "a.md", name: "A", bc: 0.5 }, { id: "b.md", name: "B", bc: 0.4 }], links: [{ source: "a.md", target: "b.md", kind: "similar", why: "x", score: 1 }], mocs: [], clusters: [] };
const weight = VGRules.reactionNudge({ reactions: { link: { more: 1 } } }, "link");
assert(weight > 0, "a reaction moves nothing");
assert.strictEqual(VGRules.reactionNudge({ reactions: { link: { less: 99 } } }, "link"), VGRules.reactionNudge({ reactions: { link: { less: 3 } } }, "link"), "the nudge isn't capped");
assert.strictEqual(VGRules.reactionNudge({}, "link"), 0);
assert.strictEqual(VGRules.canHideKind("link"), true); assert.strictEqual(VGRules.canHideKind("task"), false, "your own tasks can be hidden");
const list = review => VGRules.todayList(data, { review, today: "2026-11-01", now: new Date("2026-11-01T12:00:00") });
const plain = list({}).find(it => it.kind === "link");
if (plain) {
  assert(list({ reactions: { link: { more: 2 } } }).find(it => it.kind === "link").score > plain.score, "More didn't raise the item");
  assert(list({ reactions: { link: { less: 2 } } }).find(it => it.kind === "link").score < plain.score, "Less didn't lower the item");
  assert(!list({ hiddenKinds: ["link"] }).some(it => it.kind === "link"), "a hidden kind still shows");
}
const merged = VGRules.mergeShared({ review: { reactions: { link: { more: 1, less: 0 } } } }, { review: { reactions: { link: { more: 2, less: 0 } }, hiddenKinds: ["map"] } }, { review: { reactions: { link: { more: 3, less: 1 } } } }).review;
assert.deepStrictEqual(merged.reactions.link, { more: 4, less: 1 }, "two devices' reactions didn't both count");
assert.deepStrictEqual(merged.hiddenKinds, ["map"], "a hidden kind was lost in the merge");
// the plugin's birth date
assert.strictEqual(VGRules.nameDate("Release Notes 2025-01"), "2025-01-01"); assert.strictEqual(VGRules.nameDate("Backup April 2025"), "2025-04-01"); assert.strictEqual(VGRules.nameDate("Log 2026-03-04 x"), "2026-03-04"); assert.strictEqual(VGRules.nameDate("Plain"), null); assert.strictEqual(VGRules.nameDate("Ticket 2025-01234"), null);
assert.strictEqual(VGRules.bornDate("Backup April 2025", null, "2026-10-26"), "2025-04-01"); assert.strictEqual(VGRules.bornDate("Plain", "2024-02-03T10:00", "2026-10-26"), "2024-02-03"); assert.strictEqual(VGRules.bornDate("Plain", null, "2026-10-26"), "2026-10-26");

(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.__calls = []; window.__state = { review: { reactions: { link: { less: 2 } } } }; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { state: window.__state, ask: async () => { window.__asked = true; return true; }, now: new Date("2026-10-28T12:00:00"),
      api: { hqReact: async (...a) => window.__calls.push(a), hqMark: async () => {}, openNote: () => {}, searchNotes: async q => [] } }); window.vaultHQ.setScreen("today"); })()`);
    await sleep(100);
    const hasRow = await tab.ev(`!!document.querySelector("[data-react]")`);
    check(hasRow, "no More/Less buttons on the items");
    if (hasRow) {
      await tab.ev(`document.querySelector('[data-react="more"]').click()`); await sleep(50);
      const c = await tab.ev("window.__calls"); check(c[0] && c[0][1] === "more", "More didn't reach the host: " + JSON.stringify(c));
      check(await tab.ev(`/More/.test(document.querySelector(".vg-hq-toast").textContent) && !!document.querySelector(".vg-hq-toast [data-undo]")`), "More has no message with Undo");
      await tab.ev(`document.querySelector(".vg-hq-toast [data-undo]").click()`); await sleep(50);
      check((await tab.ev("window.__calls")).some(x => x[1] === "undo-more"), "Undo didn't reach the host");
      // the third Less on an upkeep kind asks whether to hide it; never on your own work
      const r = await tab.ev(`(() => { const list = window.vaultHQ.items(), up = list.find(it => VGRules.canHideKind(it.kind)); return up ? up.kind : null; })()`);
      if (r) { await tab.ev(`window.__state.review.reactions[${JSON.stringify(r)}] = { less: 2 }; window.__calls = []; window.__asked = false`); await tab.ev(`window.vaultHQ.setScreen("home")`); }
    }
    // typing: the same box stays in the page, with focus and text, until the results come
    await tab.ev(`window.vaultHQ.setScreen("projects")`); await sleep(50);
    const type = await tab.ev(`(async () => { const box = document.querySelector(".vg-hq-global-search"); box.focus(); const put = v => { box.value = v; box.dispatchEvent(new Event("input", { bubbles: true })); };
      put("k"); const first = document.querySelector(".vg-hq-global-search"); first.focus(); first.value = "ki"; first.dispatchEvent(new Event("input", { bubbles: true })); first.value = "kio"; first.dispatchEvent(new Event("input", { bubbles: true }));
      const t0 = performance.now(); first.value = "kios"; first.dispatchEvent(new Event("input", { bubbles: true })); const keystroke = performance.now() - t0; const same = document.querySelector(".vg-hq-global-search") === first;
      await new Promise(r => setTimeout(r, 400)); return { same, keystroke, still: document.querySelector(".vg-hq-global-search").value, focus: document.activeElement === document.querySelector(".vg-hq-global-search"), results: /Search results/.test(document.querySelector(".vg-hq-main").textContent) }; })()`);
    console.log(`  hq: a keystroke in search takes ${type.keystroke.toFixed(1)} ms`);
    check(type.same, "a keystroke rebuilt the search box"); check(type.still === "kios" && type.focus, "typing lost its text or focus: " + JSON.stringify(type)); check(type.results, "no results after a pause");
    check(type.keystroke < 16, `a keystroke takes ${type.keystroke.toFixed(1)} ms`);
    // a hidden kind has its way back on Home
    await tab.ev(`document.querySelector("[data-clear-global]").click(); window.__state.review.hiddenKinds = ["link"]; window.vaultHQ.setScreen("home")`); await sleep(50);
    check(await tab.ev(`!!document.querySelector('[data-showkind="link"]')`), "a hidden kind has no Show button on Home");
    await tab.ev(`window.__calls = []; document.querySelector('[data-showkind="link"]').click()`); check((await tab.ev("window.__calls")).some(x => x[0] === "link" && x[1] === "show"), "Show didn't reach the host");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "More/Less: capped, merged across devices, hide with a way back; typing keeps the search box", "hq reactions");
})();
