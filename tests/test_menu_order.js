#!/usr/bin/env node
// Every list a person scans is A–Z by name: the views inside each group of the View menu, the tabs of the picker and the Tools menu.
// (Groups keep their order, Recent keeps newest first, and Undo/Redo stay on top of Tools.)
//   node tests/test_menu_order.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const sorted = xs => [...xs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
(async () => {
  const tab = await openPage({ html: env.pageWith(["writeNote", "createMap", "linkNotes", "addToMap"].map(k => `${k}: async () => true,`).join(" ")) });
  const ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`(() => { const s = [...document.querySelectorAll(".vg-tour-card button")].find(b => b.textContent.trim() === "Skip"); if (s) s.click(); })()`); await sleep(150);
    await ev(`document.querySelector(".vg-pickbtn").click()`); await sleep(250);
    // the heading and the names under it, in the order they're shown
    const groups = await ev(`(() => { const out = []; let cur = null; for (const el of document.querySelectorAll(".vg-picker-tiles > *")) {
      if (el.classList.contains("vg-tiles")) { if (cur) cur.names = [...el.querySelectorAll(".vg-tile b")].map(b => b.textContent.trim()); } else { cur = { head: el.textContent.trim(), names: [] }; out.push(cur); } } return out; })()`);
    check(groups.length >= 3, `the View menu has groups (${groups.length})`);
    check(groups.reduce((n, g) => n + g.names.length, 0) >= 30, "the View menu lists the views");
    groups.filter(g => g.head !== "Recent").forEach(g => check(JSON.stringify(g.names) === JSON.stringify(sorted(g.names)), `${g.head}: A–Z, got ${g.names.join(", ")}`));
    const tabs = await ev(`[...document.querySelectorAll('.vg-picker-tab[data-tab="style"]')].length`);
    check(tabs === 1, "the Style tab is there");
    await ev(`document.querySelector('.vg-picker-tab[data-tab="style"]').click()`); await sleep(200);
    const styles = await ev(`[...document.querySelectorAll(".vg-picker-tiles .vg-tile b")].map(b => b.textContent.trim())`);
    check(styles.length > 2 && JSON.stringify(styles) === JSON.stringify(sorted(styles)), `Styles: A–Z, got ${styles.join(", ")}`);
    await ev(`document.querySelector(".vg-picker-x").click()`); await sleep(150);
    await ev(`document.querySelector(".vg-toolsbtn").click()`); await sleep(250);
    const tools = await ev(`[...document.querySelectorAll(".vg-toolsmenu [data-tool] b")].map(b => b.textContent.trim())`);
    check(tools.length >= 3 && JSON.stringify(tools) === JSON.stringify(sorted(tools)), `Tools: A–Z, got ${tools.join(", ")}`);
  } catch (e) { check(false, "the test itself failed: " + e.message); }
  finally { await tab.close(); }
  finish(fails, "menus are A–Z");
})();
