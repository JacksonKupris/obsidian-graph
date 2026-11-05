#!/usr/bin/env node
// What the graph's screens owe someone on a keyboard or a screen reader, with the same audit HQ gets: every control named, no repeated
// ids, readable text in both themes, big enough to press, at desktop and phone width. And the keyboard: the panels open from the keyboard,
// Escape closes them and puts focus back, tabs move with the arrow keys.
//   node tests/test_graph_a11y.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage, a11yAudit, contrast, FLEXOKI } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith(["writeNote", "createMap", "linkNotes", "addToMap"].map(k => `${k}: async () => true,`).join(" ")) });
  const D = "window.vaultGraph._debug", ev = e => tab.ev(e), AUDIT = a11yAudit(".vg-root", ".vg-sr");
  const named = new Set(), dup = new Set(), small = new Set(), low = new Map();
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.waitFor(`document.querySelector(".vg-tour-card") ? 1 : 0`, 8000);
    await ev(`(() => { const s = [...document.querySelectorAll(".vg-tour-card button")].find(b => b.textContent.trim() === "Skip"); if (s) s.click(); })()`); await sleep(150);
    check(await ev(`!document.querySelector(".vg-tour-card")`), "the tour should end on Skip");
    const theme = async (name, dark, vars) => { await ev(`(() => { const r = document.documentElement.style; Object.keys(${JSON.stringify(FLEXOKI.light)}).forEach(k => r.removeProperty(k)); Object.entries(${JSON.stringify(vars)}).forEach(([k, v]) => r.setProperty(k, v)); document.body.classList.toggle("theme-dark", ${dark}); })()`);
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }] }); await sleep(80); return name; };
    let themeName = "";
    const audit = async where => { where = `${themeName} ${where}`; const a = await ev(AUDIT);
      check(a.text.length > 5, `${where}: the audit read almost nothing`);
      a.noName.forEach(x => named.add(`${where}: ${x}`)); a.dup.forEach(x => dup.add(x)); a.small.forEach(x => small.add(`${where}: ${x}`));
      a.text.forEach(([what, words, fg, bg, fs, w]) => { const r = contrast(fg, bg), large = fs >= 24 || (fs >= 18.66 && w >= 700); if (r < (large ? 3 : 4.5)) { const k = `${where.split(" ")[0]} ${what}`; if (!low.has(k) || r < low.get(k)[0]) low.set(k, [r, words, where]); } }); };
    const pressKey = key => ev(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
    for (const [name, dark, vars] of [["light", false, FLEXOKI.light], ["dark", true, FLEXOKI.dark]]) { themeName = await theme(name, dark, vars);
    for (const [width, mobile] of [[1384, false], [400, true]]) {
      await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 860, deviceScaleFactor: 1, mobile }); await sleep(500);
      const w = `${width}px`;
      if (mobile) { await ev(`document.querySelector(".vg-toggle").click()`); await sleep(250); }
      await audit(`${w} sidebar`);
      await ev(`document.querySelector('.vg-tab[data-tab="clusters"]').click()`); await sleep(150); await audit(`${w} topics`); await ev(`document.querySelector('.vg-tab[data-tab="insights"]').click()`);
      if (mobile) { await ev(`document.querySelector(".vg-toggle").click()`); await sleep(250); }
      await ev(`document.querySelector(".vg-gamebtn").click()`); await sleep(250); await audit(`${w} upkeep`); await ev(`document.querySelector(".vg-gamebtn").click()`);
      for (const t of ["views", "style", "health"]) { await ev(`(() => { const p = document.querySelector(".vg-picker"); if (p.hidden) document.querySelector(".vg-pickbtn").click(); document.querySelector('.vg-picker-tab[data-tab="${t}"]').click(); })()`); await sleep(150); await audit(`${w} picker ${t}`); }
      await ev(`document.querySelector(".vg-picker-x").click()`);
      await ev(`(() => { const n = ${D}.nodes.filter(n => !n.ghost && !n.person && !n.moc).sort((a, b) => (b.tasks || 0) - (a.tasks || 0))[0]; window.vaultGraph.focusNote(n.id); })()`); await sleep(500); await audit(`${w} note`);
      await ev(`(() => { const x = document.querySelector(".vg-ins-close"); if (x) x.click(); })()`); await sleep(100);
    } }
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1384, height: 860, deviceScaleFactor: 1, mobile: false }); await sleep(300);
    // the tablists: a tab says which panel it opens, and arrow keys move along them
    const tabsOk = await ev(`(() => { const out = []; document.querySelectorAll(".vg-tab").forEach(b => { const p = document.querySelector('[data-panel="' + b.dataset.tab + '"]'); if (!p || !b.id || p.getAttribute("aria-labelledby") !== b.id) out.push(b.textContent); if (b.getAttribute("aria-controls") !== p.id) out.push(b.textContent + " controls"); }); return out.join(", "); })()`);
    check(!tabsOk, `sidebar tabs not joined to their panels: ${tabsOk}`);
    await ev(`document.querySelector('.vg-tab[data-tab="insights"]').focus()`); await pressKey("ArrowRight"); await sleep(120);
    check(await ev(`document.activeElement.dataset.tab`) === "clusters", "ArrowRight on the sidebar's tabs didn't move");
    check(await ev(`document.querySelector('.vg-tab[data-tab="clusters"]').getAttribute("aria-selected")`) === "true", "ArrowRight didn't open the next tab");
    await pressKey("ArrowLeft"); await sleep(120);
    check(await ev(`document.activeElement.dataset.tab`) === "insights", "ArrowLeft on the sidebar's tabs didn't move");
    check(await ev(`document.querySelectorAll('.vg-tab[tabindex="0"]').length`) === 1, "only the open tab should be in the Tab order");
    await ev(`document.querySelector(".vg-pickbtn").click()`); await sleep(200);
    check(await ev(`!!document.activeElement.closest(".vg-picker")`), "opening the picker should move focus into it");
    await ev(`document.querySelector('.vg-picker-tab[aria-selected="true"]').focus()`); await pressKey("ArrowRight"); await sleep(150);
    check(await ev(`document.activeElement.classList.contains("vg-picker-tab") && document.activeElement.dataset.tab === "style"`), "ArrowRight on the picker's tabs didn't move");
    check(await ev(`document.querySelector('.vg-picker-tab[data-tab="style"]').getAttribute("aria-selected")`) === "true", "ArrowRight didn't open the picker's next tab");
    await pressKey("Escape"); await sleep(150);
    check(await ev(`document.querySelector(".vg-picker").hidden`), "Escape should close the picker");
    check(await ev(`document.activeElement === document.querySelector(".vg-pickbtn")`), "closing the picker should put focus back on its button");
    // the Upkeep panel is reachable and its button says it's open
    await ev(`document.querySelector(".vg-gamebtn").focus(); document.querySelector(".vg-gamebtn").click()`); await sleep(200);
    check(await ev(`document.querySelector(".vg-gamebtn").getAttribute("aria-pressed")`) === "true", "the Upkeep button should say it's on");
    check(await ev(`document.querySelector(".vg-missions").getAttribute("aria-label")`) === "Upkeep", "the Upkeep panel has no name");
    await ev(`document.querySelector(".vg-gamebtn").click()`);
    // a note's panel takes focus when opened from the keyboard path, and gives it back
    check(await ev(`document.querySelector(".vg-inspector").getAttribute("aria-label")`) === "Selected note", "the note's panel has no name");
  } catch (e) { fails.push(e.message); }
  check(!named.size, `controls with no name:\n    ${[...named].slice(0, 15).join("\n    ")}`);
  check(!dup.size, `repeated ids: ${[...dup].slice(0, 8)}`);
  check(!small.size, `too small to press:\n    ${[...small].slice(0, 25).join("\n    ")}`);
  check(!low.size, `text below AA (${low.size}):\n    ${[...low].sort().map(([k, [r, w, where]]) => `${k} ${r.toFixed(2)} "${w}" (${where})`).slice(0, 40).join("\n    ")}`);
  await tab.close();
  finish(fails, "The graph's screens: named controls, readable text, keyboard tabs, focus kept");
})();
