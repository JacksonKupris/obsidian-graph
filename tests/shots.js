#!/usr/bin/env node
// Screenshots of the built graph page: every view, lens and picker tab, at desktop and phone size, for reviewing the
// look and comparing builds (before/after a polish change).
//   node tests/shots.js [out-folder] [--mobile] [--only view,lens,...] [--vault [dir]]     default out: .out/shots/<date>[-mobile]
const fs = require("fs"), path = require("path"), cdp = require("./cdp");
const env = require("./env"), MOBILE = process.argv.includes("--mobile");
const onlyArg = process.argv.indexOf("--only"), ONLY = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
const outArg = process.argv.slice(2).find(a => !a.startsWith("--") && !["--only", "--vault"].includes(process.argv[process.argv.indexOf(a) - 1]));
const OUT = outArg || env.out("shots", new Date().toISOString().slice(0, 10) + (MOBILE ? "-mobile" : ""));
// the palette's "In your notes" section: the page has no vault to search, so it gets results from the plugin's own
// search engine (VGRules.recallSearch) over the same vault's notes
const RECALL_Q = env.VAULT ? "connect exchange online" : "backup restore near server backup";
const recall = (() => { const { VGRules, list } = env.notes(); return env.inlineJson(VGRules.recallSearch(list, RECALL_Q, { n: 5, today: new Date().toISOString().slice(0, 10) })); })();
const html = env.pageWith(`${MOBILE ? "mobile: true, " : ""}recall: async () => ${recall},`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tab = await cdp.open({ html, port: 9332, mobile: MOBILE });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  fs.mkdirSync(OUT, { recursive: true });
  await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await sleep(1500);
  await tab.ev("document.querySelectorAll('.vg-tour').forEach(x => x.remove())");
  const shot = async name => { await tab.ev("document.querySelectorAll('.vg-tour').forEach(x => x.remove())");   // the tour comes back after a remount
    const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
  const want = k => !ONLY || ONLY.has(k);
  const D = "window.vaultGraph._debug";
  const views = await tab.ev(`${D}.views()`), lenses = await tab.ev(`${D}.lenses()`);
  let n = 0;
  for (const v of views) { if (!want(v)) continue; await tab.ev(`${D}.setView(${JSON.stringify(v)})`); await sleep(v === "2d" || v === "3d" ? 2500 : 1600); await shot("view-" + v); n++; }
  await tab.ev(`${D}.setView("2d")`); await sleep(1500);
  for (const k of lenses) { if (!want(k)) continue; await tab.ev(`${D}.openLens(${JSON.stringify(k)})`); await sleep(700); await shot("lens-" + k); n++; }
  await tab.ev("(() => { const c = document.querySelector('.vg-lens:not([hidden]) .vg-lens-close'); if (c) c.click(); })()");
  for (const t of ["views", "lenses", "style", "health"]) { if (!want("picker-" + t)) continue;
    await tab.ev(`(() => { const p = document.querySelector('.vg-picker'); if (p.hidden) document.querySelector('.vg-pickbtn').click(); const b = document.querySelector('.vg-picker-tab[data-tab="${t}"]'); if (b) b.click(); })()`);
    await sleep(500); await shot("picker-" + t); n++; }
  if (want("palette")) { await tab.ev("(() => { const x = document.querySelector('.vg-picker-x'); if (x) x.click(); document.querySelector('.vg-searchbtn').click(); })()");
    await sleep(300);
    await tab.ev(`(() => { const i = document.activeElement; i.value = ${JSON.stringify(RECALL_Q)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(900); await shot("palette"); n++;
    await tab.ev("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); }
  // a note's inspector and its actions menu
  if (want("inspector")) { await tab.ev("(() => { const x = document.querySelector('.vg-picker-x'); if (x) x.click(); })()");
    await tab.ev(`(() => { const d = ${D}; const n = d.nodes.filter(n => !n.ghost && !n.person && !n.moc).sort((a, b) => (b.tasks || 0) - (a.tasks || 0))[0]; window.vaultGraph.focusNote(n.id); })()`);
    await sleep(1200); await shot("inspector"); n++; }
  await tab.close();
  console.log(`${n} screenshots in ${OUT}`);
  process.exit(0);
})().catch(e => { console.log("FAIL - " + e.message); process.exit(1); });
