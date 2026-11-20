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
    // the three select boxes: names in each group are A–Z
    const grp = sel => ev(`[...document.querySelectorAll("${sel} optgroup")].map(g => ({ head: g.label, names: [...g.querySelectorAll("option")].map(o => o.textContent.replace(/^✓ /, "").trim()) }))`);
    const groups = await grp(".vg-viewsel");
    check(groups.length >= 3, `the View select has groups (${groups.length})`);
    check(groups.reduce((n, g) => n + g.names.length, 0) >= 30, "the View select lists the views");
    groups.filter(g => g.head !== "Recent").forEach(g => check(JSON.stringify(g.names) === JSON.stringify(sorted(g.names)), `${g.head}: A–Z, got ${g.names.join(", ")}`));
    const styles = (await grp(".vg-displaysel")).find(g => g.head === "Styles");
    check(styles && styles.names.length > 2 && JSON.stringify(styles.names) === JSON.stringify(sorted(styles.names)), `Styles: A–Z, got ${styles && styles.names.join(", ")}`);
    const tools = (await grp(".vg-toolsel")).find(g => g.head === "Tools");
    check(tools && tools.names.length >= 3 && JSON.stringify(tools.names) === JSON.stringify(sorted(tools.names)), `Tools: A–Z, got ${tools && tools.names.join(", ")}`);
  } catch (e) { check(false, "the test itself failed: " + e.message); }
  finally { await tab.close(); }
  finish(fails, "menus are A–Z");
})();
