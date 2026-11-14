#!/usr/bin/env node
// Found by eye on the real vault at phone size (front-end round 2):
//   - the status pill was cut off under the banner: the banner is taller on a phone than the space kept for it
//   - search had no visible way to close it or to highlight every match: "Esc" was a label, and the footer listed keys a phone has not got
//   node tests/test_phone_overlays.js [--vault [dir]]        exit 0 = pass
const assert = require("assert");
const { sleep, openPage } = require("./kit");
const env = require("./env");
const box = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden || getComputedStyle(e).display === "none") return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; })()`;
const look = async mobile => {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile });
  try {
    assert.ok(await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000), "the graph must mount");
    await tab.ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`); await sleep(1200);
    if (mobile) {
      const banner = await tab.ev(box(".vg-today")), pill = await tab.ev(box(".vg-status"));
      assert.ok(banner && pill, "the banner and the status pill must both show to be measured: " + JSON.stringify({ banner, pill }));
      assert.ok(pill.top >= banner.bottom, `the status pill starts under the banner (pill top ${pill.top}, banner bottom ${banner.bottom})`);
    }
    // search: a close button and a "highlight all" button that can be pressed; key hints only where there are keys
    await tab.ev(`document.querySelector(".vg-searchbtn").click()`); await sleep(400);
    assert.strictEqual(await tab.ev(`document.querySelector(".vg-palette").hidden`), false, "search must open");
    await tab.ev(`(() => { const i = document.querySelector(".vg-pq"); i.value = "a"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(500);
    const min = mobile ? 40 : 24, x = await tab.ev(box("button.vg-pal-x")), all = await tab.ev(box("button.vg-pal-all"));
    assert.ok(x && x.w >= min && x.h >= min, `search has a close button of at least ${min} px: ` + JSON.stringify(x));
    assert.ok(all && all.h >= min, `search has a "Highlight all" button of at least ${min} px: ` + JSON.stringify(all));
    const keys = await tab.ev(`[...document.querySelectorAll(".vg-palette kbd")].filter(k => getComputedStyle(k).display !== "none" && k.getBoundingClientRect().width > 0).length`);
    if (mobile) assert.strictEqual(keys, 0, "a phone is shown no key hints in search"); else assert.ok(keys >= 4, "a desktop keeps the key hints: " + keys);
    await tab.ev(`document.querySelector("button.vg-pal-all").click()`); await sleep(500);
    assert.strictEqual(await tab.ev(`document.querySelector(".vg-palette").hidden`), true, "Highlight all closes search");
    const said = await tab.ev(`(document.querySelector(".vg-root").textContent.match(/“a” · ([0-9]+) matches/) || [])[1] || null`);
    assert.ok(+said > 0, "Highlight all highlights the matches, and the graph says how many: " + said);
    await tab.ev(`document.querySelector(".vg-searchbtn").click()`); await sleep(400);
    await tab.ev(`document.querySelector("button.vg-pal-x").click()`); await sleep(300);
    assert.strictEqual(await tab.ev(`document.querySelector(".vg-palette").hidden`), true, "the close button closes search");
  } finally { try { await tab.close(); } catch (e) { /* page already gone */ } }
};
(async () => {
  await look(true); await look(false);
  console.log("ok - on a phone the status pill sits under the banner, and search can be closed and can highlight all without a keyboard");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
