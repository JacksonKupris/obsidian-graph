#!/usr/bin/env node
// Smoke test of the built graph page in headless Chrome: opens every view, every palace floor and every lens, and opens the task
// list of a note with open tasks, collecting page errors.
//   node tests/smoke_page.js [--vault [dir]]        exit 0 = no errors
const fs = require("fs"), path = require("path"), cdp = require("./cdp");
const page = require("./env").page();
const probe = `<script>
window.__errs = []; window.__ms = []; window.__counts = { views: 0, lenses: 0 };
addEventListener("error", e => __errs.push(String(e.message)));
addEventListener("unhandledrejection", e => __errs.push("promise: " + String(e.reason && e.reason.message || e.reason)));
setTimeout(async () => {
  const D = window.vaultGraph && window.vaultGraph._debug, sleep = ms => new Promise(r => setTimeout(r, ms));
  if (!D) { __errs.push("no window.vaultGraph"); } else {
    for (const v of D.views()) { try { D.setView(v); await sleep(120); } catch (e) { __errs.push(v + ": " + e.message); } }
    // how long each view takes to draw a frame, once it's laid out (the renderer keeps a running average)
    // Chrome in this mode runs a single animation frame, so each view is drawn here directly: a drawing error fails the
    // test. (Its clock stands still during a task, so frame times are measured by click_all.js, which runs in real time.)
    for (const v of D.views()) { try { D.setView(v); await sleep(400); if (D.drawNow() == null) __errs.push(v + ": nothing drawn (no canvas size)"); else __ms.push(v); } catch (e) { __errs.push(v + " (drawing): " + e.message); } }
    // modes inside a view: every palace floor (drawn through the iso kit), then back out front
    try { D.setView("palace"); await sleep(200); D.drawNow(); for (const b of [...document.querySelectorAll(".vg-floorbar button")].reverse()) { b.click(); await sleep(250); D.drawNow(); } }
    catch (e) { __errs.push("palace floors: " + e.message); }
    for (const k of D.lenses()) { try { D.openLens(k); await sleep(60); } catch (e) { __errs.push("lens " + k + ": " + e.message); } }
    // the search palette: a query that names nothing lists nothing (a kind's rank bonus once turned every miss into a match),
    // and a real note name finds that note
    try { const pq = () => document.querySelector(".vg-pq"), rows = () => document.querySelectorAll(".vg-palette-list .vg-pitem");
      document.querySelector(".vg-searchbtn").click(); await sleep(100);
      pq().value = "qqzx wvvk"; pq().dispatchEvent(new Event("input", { bubbles: true })); await sleep(50);
      if (rows().length) __errs.push("palette: an unrelated query listed " + rows().length + " results");
      const name = D.nodes.find(n => !n.ghost && n.name.length > 6).name;
      pq().value = name; pq().dispatchEvent(new Event("input", { bubbles: true })); await sleep(50);
      if (!rows().length || !rows()[0].textContent.includes(name)) __errs.push("palette: searching \\"" + name + "\\" didn't list it first");
      pq().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }
    catch (e) { __errs.push("palette: " + e.message); }
    // keys: 3 turns a 3D scene's angle (flat, tilt, iso) and ? lists every shortcut
    try { const key = k => document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      D.setView("zombie"); await sleep(200);
      const label = () => (document.querySelector(".vg-anglebtn:not([hidden]) .vg-tlabel") || {}).textContent;
      const a0 = label(); key("3"); await sleep(100); const a1 = label();
      if (!a0 || a0 === a1) __errs.push("angle: 3 in Zombie went " + a0 + " -> " + a1);
      key("3"); key("3"); await sleep(50);
      if (label() !== a0) __errs.push("angle: three presses didn't come back to " + a0);
      D.setView("2d"); await sleep(100);
      if (document.querySelector(".vg-anglebtn").offsetParent) __errs.push("angle: the button shows on the 2D graph");
      key("?"); await sleep(100);
      const rows = document.querySelectorAll(".vg-confirm .vg-keys tr").length;
      if (rows < 15) __errs.push("shortcuts: the sheet lists " + rows + " keys");
      const ok = document.querySelector('.vg-confirm [data-c="ok"]'); if (ok) ok.click(); else __errs.push("shortcuts: no sheet opened");
      if (document.querySelector('.vg-confirm [data-c="no"]')) __errs.push("shortcuts: the sheet has a Cancel button"); }
    catch (e) { __errs.push("keys: " + e.message); }
    // Tools: the menu lists the tools, runs one through the same path as the phone's sheet, and shows that one is on
    try { const tb = document.querySelector(".vg-toolsbtn"); tb.click(); await sleep(100);
      const items = [...document.querySelectorAll(".vg-toolsmenu:not([hidden]) [data-tool]")];
      if (items.length < 4) __errs.push("tools: the menu lists " + items.length + " tools");
      const time = items.find(x => x.dataset.tool === "vg-timebtn"); if (time) time.click(); await sleep(100);
      if (document.querySelector(".vg-timebar").hidden) __errs.push("tools: Time-lapse didn't open the time bar");
      if (tb.getAttribute("aria-pressed") !== "true") __errs.push("tools: the button doesn't show a tool is on");
      if (!document.querySelector(".vg-toolsmenu").hidden) __errs.push("tools: the menu stayed open after choosing");
      tb.click(); await sleep(50); document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(50);
      if (!document.querySelector(".vg-toolsmenu").hidden) __errs.push("tools: Esc didn't close the menu");
      document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true })); await sleep(50);
      if (tb.getAttribute("aria-pressed") === "true") __errs.push("tools: still pressed after the time bar closed"); }
    catch (e) { __errs.push("tools: " + e.message); }
    // no dead ends: on a small vault (6 notes, nothing else) and an empty one, every lens has something to click besides
    // close. The plugin's hooks are stand-ins, so the buttons it would show are drawn too.
    const views = D.views().length, lenses = D.lenses();
    for (const keep of [6, 0]) {
      try {
        const d = JSON.parse(JSON.stringify(DATA)), c0 = d.clusters[0].id;
        const hollow = o => Array.isArray(o) ? [] : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, hollow(v)])) : o;
        d.nodes = d.nodes.filter(n => n.cluster === c0 && !n.ghost).slice(0, keep);
        const ids = new Set(d.nodes.map(n => n.id));
        d.links = d.links.filter(l => ids.has(l.source) && ids.has(l.target)); d.clusters = keep ? d.clusters.filter(c => c.id === c0) : [];
        for (const k of ["said_unlinked", "wanted", "mocs", "gaps", "pairs", "near_dupes", "snapshots", "scenes"]) d[k] = [];
        for (const k of ["timeline", "followthrough", "changes", "code", "rhythm"]) d[k] = hollow(d[k]);
        window.vaultGraph.destroy(); const el = document.getElementById("vg"); el.innerHTML = "";
        window.vaultGraph = mountVaultGraph(el, d, { writeNote: async () => "", openDaily: () => {}, openNote: () => {} });
        await sleep(300);
        // every view draws on the trimmed vault too (an empty one has no topics, rooms or towers)
        { const T = window.vaultGraph._debug;
          for (const v of T.views()) { try { T.setView(v); await sleep(60); T.drawNow(); } catch (e) { __errs.push("view " + v + " with " + keep + " notes: " + e.message); } }
          T.setView("2d"); await sleep(60); }
        for (const k of window.vaultGraph._debug.lenses()) {   // the trimmed vault's lenses (Code needs repos, for one)
          window.vaultGraph._debug.openLens(k); await sleep(40);
          const box = document.querySelector(".vg-lens:not([hidden])");
          const n = box ? [...box.querySelectorAll("button, a, input, select, summary")].filter(e => !e.closest("[hidden]") && !/close/.test(e.className) && e.offsetParent).length : 0;
          if (!n) __errs.push("dead end: lens " + k + " with " + keep + " notes has nothing to click");
        }
        // with the plugin's hooks the picker offers New scene, and its form opens and cancels
        if (keep) { document.querySelector(".vg-lens:not([hidden]) .vg-lens-close")?.click(); document.querySelector(".vg-pickbtn").click(); await sleep(100);
          const tile = [...document.querySelectorAll(".vg-tile")].find(t => /New scene/.test(t.textContent));
          if (!tile) __errs.push("New scene: no tile in the picker");
          else { tile.click(); await sleep(100); const f = document.querySelector(".vg-confirm .vg-form");
            if (!f || f.querySelectorAll("select").length < 8) __errs.push("New scene: the form didn't open with its choices");
            document.querySelector('.vg-confirm [data-c="no"]')?.click(); await sleep(50);
            if (document.querySelector(".vg-confirm")) __errs.push("New scene: Cancel left the form open"); } }
      } catch (e) { __errs.push("small vault (" + keep + " notes): " + e.message); }
    }
    window.__counts = { views, lenses: lenses.length };
  }
  window.__smoke = JSON.stringify({ views: D ? __counts.views : 0, lenses: D ? __counts.lenses : 0, errors: __errs, ms: __ms });
}, 1500);
</script>`;
// in real time over the DevTools protocol (tests/cdp.js). It used Chrome's virtual clock (--dump-dom with a 60 s
// budget), which renders every animated frame of the budget in software: over 10 minutes once the scenes animated.
(async () => {
  let tab;
  try { tab = await cdp.open({ html: page.replace("</body>", probe + "</body>"), port: 9333 }); } catch (e) { console.log("FAIL - " + e.message); process.exit(1); }
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  let why = "the page crashed or took over 5 minutes";
  const res = await tab.waitFor("window.__smoke || null", 5 * 60 * 1000).catch(e => { why = e.message; return null; });
  await tab.close();
  if (!res) { console.log(`FAIL - the probe never reported (${why})`); process.exit(1); }
  const r = JSON.parse(res);
  if (r.errors.length) { console.log(`FAIL - ${r.errors.length} error(s) over ${r.views} views, ${r.lenses} lenses\n  ` + r.errors.slice(0, 15).join("\n  ")); process.exit(1); }
  console.log(`ok - graph page: ${r.views} views (${(r.ms || []).length} drawn), ${r.lenses} lenses, no errors, no dead ends`);
  process.exit(0);
})();
