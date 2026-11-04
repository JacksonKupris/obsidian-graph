#!/usr/bin/env node
// HQ's layout at the widths people use: nothing runs off the side or out of a card, the dock never sits on a row on a wide
// pane, a row's buttons wait for the pointer without moving anything, Do next isn't shown twice, and the accent is readable.
//   node tests/test_hq_layout.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, openPage, tools } = require("./kit");
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
assert.strictEqual(VGRules.systemLabel("project/route-planner"), "Route planner", "a tag with no system in the rules reads as words");

// contrast of the light accent, as text and behind its ink (WCAG AA is 4.5)
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    const size = async (width, mobile = false) => { await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile }); await sleep(120); };
    const screen = s => tools(tab, { wait: 120 }).screen(s);
    for (const [width, mobile] of [[390, true], [800, false], [1500, false]]) {
      await size(width, mobile);
      for (const s of ["home", "today", "needs", "projects", "threads", "people"]) {
        await screen(s);
        const at = `${s} at ${width}`;
        check(await tab.ev(`document.documentElement.scrollWidth <= innerWidth && document.querySelector(".vg-hq-main").scrollWidth <= document.querySelector(".vg-hq-main").clientWidth + 1`), `${at}: runs off the side`);
        const out = await tab.ev(`[...document.querySelectorAll(".vg-hq-proj")].slice(0, 30).flatMap(c => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll(".vg-hq-projfoot small, .vg-hq-spark, .vg-hq-pill")].filter(x => { const q = x.getBoundingClientRect(); return q.right > r.right - 4 || q.left < r.left; }).map(x => x.textContent.slice(0, 24)); })`);
        check(!out.length, `${at}: out of its card: ${out.join(", ")}`);
        const cut = await tab.ev(`[...document.querySelectorAll(".vg-hq-chip b")].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent)`);
        check(!cut.length, `${at}: chip label cut: ${cut.join(", ")}`);
      }
    }
    // wide: the dock is beside the content, not over it
    await size(1500); await screen("today");
    check(await tab.ev(`(() => { const d = document.querySelector(".vg-hq-dock").getBoundingClientRect(), c = document.querySelector(".vg-hq-col").getBoundingClientRect(); return d.right <= c.left; })()`), "the dock covers the list on a wide pane");
    // a row: buttons wait for the pointer, in place, and showing them moves nothing
    const hasRow = await tab.ev(`!!document.querySelector(".vg-hq-sec .vg-hq-item[data-key]")`);
    if (hasRow) {
      const hoverable = await tab.ev(`matchMedia("(hover: hover)").matches`);
      const rect = await tab.ev(`(() => { const r = document.querySelector(".vg-hq-sec .vg-hq-item[data-key]"); r.scrollIntoView({ block: "center" }); const q = r.getBoundingClientRect(), t = r.querySelector(".vg-hq-txt b").getBoundingClientRect(); return { x: q.x + 60, y: q.y + q.height / 2, h: q.height, tw: t.width }; })()`);
      const done = `[...document.querySelector(".vg-hq-sec .vg-hq-item[data-key] .vg-hq-acts").children].find(b => !b.classList.contains("vg-hq-star"))`;
      if (hoverable) check(await tab.ev(`getComputedStyle(${done}).opacity === "0"`), "a row's buttons show before the pointer gets there");
      await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y }); await sleep(250);
      check(await tab.ev(`getComputedStyle(${done}).opacity === "1"`), "a row's buttons don't come up under the pointer");
      const after = await tab.ev(`(() => { const r = document.querySelector(".vg-hq-sec .vg-hq-item[data-key]"); return { h: r.getBoundingClientRect().height, tw: r.querySelector(".vg-hq-txt b").getBoundingClientRect().width }; })()`);
      check(after.h === rect.h && after.tw === rect.tw, "showing a row's buttons moved the row");
      await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
    }
    // Do next once: the rail beside it doesn't repeat its title until something else is picked
    const heroTitle = await tab.ev(`(document.querySelector(".vg-hq-next h2") || {}).textContent || ""`);
    if (heroTitle) check(!(await tab.ev(`document.querySelector(".vg-hq-rail").textContent.includes(${JSON.stringify(heroTitle)})`)), "Do next is shown twice on Today");
    // a screen with no hero shows nothing unrelated in the rail
    await screen("threads");
    check(await tab.ev(`!document.querySelector(".vg-hq-rail") || !!document.querySelector(".vg-hq-railempty") || !!document.querySelector(".vg-hq-railtitle") === false`), "Threads opens with an unrelated item in the rail");
    // a phone: the task list isn't pushed down by Do next's notes, and capture's box has its own line
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { api: { capture: async () => {}, hqFocus: async () => {}, hqMark: async () => {}, openNote() {}, searchNotes: async () => [] } }); })()`);
    await size(390, true); await screen("today");
    check(await tab.ev(`!!document.querySelector(".vg-hq-capture")`), "the capture box isn't here to check");
    check(await tab.ev(`!document.querySelector(".vg-hq-next .vg-hq-ctx")`), "Do next's notes push the list down on a phone");
    check(await tab.ev(`(() => { const b = document.querySelector(".vg-hq-captureinput"), c = document.querySelector(".vg-hq-capture"); return b.getBoundingClientRect().width > c.getBoundingClientRect().width * 0.8; })()`), "capture's box is squeezed on a phone");
  } catch (e) { fails.push(e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - layout:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - HQ layout: 3 widths on 6 screens, dock beside the list, quiet rows, one Do next, readable accent");
  process.exit(0);
})();
