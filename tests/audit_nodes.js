#!/usr/bin/env node
// Node-click audit: opens every view, clicks real nodes in it (real mouse events, in a visible headed Chrome window) and reports where views
// disagree on what a click on a node does. It is a report, not a pass/fail test: the findings are the to-do list.
// What a click on a node must do, the same in every view (the standing rules in global-rules.md):
//   select       the click selects that note (the plugin's selection is the note)
//   actions      the detail shows every action the note has: the same set as the baseline view's (2d)
//   next         after the actions are taken or declined (Skip / Next / Done), a control moves on to the next note that
//                gains most; the view never ends in a dead end
//   back         Escape returns to the screen it was on: same view, nothing selected, same scroll
//   silent       the click throws nothing
//   reach        some node of the view can be clicked at all (a view nobody can click into is a dead label)
//   node tests/audit_nodes.js [--per N (default: every clickable note)] [--mobile] [--view slime] [--out file.md]
// Writes .out/node-audit.md (or --out): per view a row of ticks, then each kind of finding once with how to improve it.
// Headed by default: a visible Chrome window, so the clicks are seen to land (VG_HEADED=0 runs it headless, as CI does).
if (process.env.VG_HEADED === undefined) process.env.VG_HEADED = "1"; else if (process.env.VG_HEADED === "0") delete process.env.VG_HEADED;
const fs = require("fs"), path = require("path");
const { sleep, openPage } = require("./kit");
const env = require("./env");
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const PER = arg("--per", "all") === "all" ? 100000 : +arg("--per", "all"), ONLY = arg("--view", ""), MOBILE = process.argv.includes("--mobile");
const OUT = arg("--out", env.out("node-audit.md"));

// what to do about each kind of finding (the report prints it once, under the views that have it)
const HOW = {
  reach: "No node in this view can be clicked. Give the view a hit test (the plugin's `screen(id)` or the library's `keyAt`) so a note drawn in it opens the shared detail; if the view shows no notes, it should say so and point to the view that does.",
  select: "A click on a drawn note does not select it. Route the click through the shared `select(id)` (the library view's `onOpen` -> `libOpen`), so the inspector, status and every other view follow.",
  actions: "The detail opened by this view lacks actions the baseline (2d) detail has. Open the one shared inspector (`select`), not a view-private card, so a new action appears in every view at once.",
  next: "After the actions there is no way to move on to the next note that would gain most. Add the shared Next control to the inspector (one queue, ordered by what the vault graph can do for each note), not a per-view one.",
  back: "Escape does not return to the exact previous screen (view, selection, scroll). Push the click onto the shared view stack so Back and Escape share one path.",
  overlap: "Notes drawn on top of each other: a click on one selects its neighbour. Spread them (a minimum gap in the layout) or let the click pick the nearest centre and offer the others in a list, so every note can be reached.",
  carry: "A note selected in another view is not selected here when the view opens. Keep one selection in the shell (`select`), and have every view draw it, so switching views keeps the person's place.",
  silent: "The click raised a page error. Fix the handler; a view must never throw on a click.",
};

// the probe: runs in the page (the plugin's own screen(id) is relative to its canvas); given a view it returns clickable notes and, after a click, what the page shows
const IN = {
  candidates: (view, per) => `(() => { const D = window.vaultGraph._debug, sc = D.scenes && D.scenes()[${JSON.stringify(view)}], out = [], seen = new Set(), why = {};
    const lib = sc && sc.api && sc.api.handle && sc.api.handle();
    const top = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === "CANVAS"; };
    if (lib && lib.keyAt) { for (let y = 100; y < innerHeight - 60; y += 8) for (let x = 60; x < innerWidth - 60; x += 8) { const k = lib.keyAt(x, y); if (k && k.kind === "note" && !seen.has(k.id) && top(x, y)) { seen.add(k.id); out.push({ id: k.id, x, y }); } } }
    else { const cr = document.querySelector("canvas.vg-cv").getBoundingClientRect(); why.canvas = [cr.left, cr.top, cr.width, cr.height].map(Math.round).join("x"); for (const n of D.nodes) { if (n.ghost || n.person || n.moc) { why.kind = (why.kind || 0) + 1; continue; } const p0 = D.screen(n.id); if (!p0) { why.nop = (why.nop || 0) + 1; continue; } if (p0.a < 0.15) { why.faded = (why.faded || 0) + 1; continue; } const p = { x: p0.x + cr.left, y: p0.y + cr.top };
      if (!(p.x > 40 && p.x < innerWidth - 40 && p.y > 100 && p.y < innerHeight - 60)) { why.off = (why.off || 0) + 1; continue; } if (!top(p.x, p.y)) { why.covered = (why.covered || 0) + 1; continue; } out.push({ id: n.id, x: p.x, y: p.y }); } }
    const step = Math.max(1, Math.floor(out.length / ${per})); return { why, total: out.length, picks: out.filter((c, i) => i % step === 0).slice(0, ${per}) }; })()`,
  shown: `(() => { const box = document.querySelector(".vg-inspector"), shown = !!box && !box.hidden, labels = shown ? [...box.querySelectorAll(".vg-ins-head button, .vg-ins-actions button, [data-act]")].map(b => (b.textContent || b.getAttribute("aria-label") || b.dataset.act || "").trim().replace(/\\s+/g, " ").replace(/[#0-9.,]+/g, "").trim().slice(0, 30)).filter(Boolean) : [];
    return { selected: window.vaultGraph.viewport().selected, shown, labels: [...new Set(labels)], scroll: shown ? box.scrollTop : 0, view: window.vaultGraph.viewport().view || null, errs: (window.__errs || []).length }; })()`,
};

(async () => {
  const data = env.data();
  let tab = null, carried = null; const rows = [], found = new Map();
  const note = (kind, view) => { if (!found.has(kind)) found.set(kind, new Set()); found.get(kind).add(view); };
  try {
    tab = await openPage({ html: env.pageWith(MOBILE ? "mobile: true," : "", data), mobile: MOBILE });
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const D = "window.vaultGraph._debug", calm = async () => { await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.drawNow()`); await sleep(80); };
    const click = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await tab.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }); await sleep(type === "mouseMoved" ? 120 : 60); } await sleep(300); await calm(); };
    const esc = async () => { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(250); await calm(); };

    // the baseline: what the detail of a note offers in the plain graph view
    await tab.ev(`${D}.setView("2d")`); await sleep(500); await calm();
    await sleep(1500); await calm(); const base = await tab.ev(IN.candidates("2d", 1));
    let baseline = [];
    if (base.picks.length) { await click(base.picks[0].x, base.picks[0].y); baseline = (await tab.ev(IN.shown)).labels; await esc(); }
    if (!baseline.length) console.log("WARNING: the 2d view gave no baseline set of actions, so the 'actions' check is skipped");

    const views = (await tab.ev(`${D}.views()`)).filter(v => !ONLY || v === ONLY);
    for (const view of views) {
      const row = { view, overlap: 0, total: 0, tried: 0, select: 0, actions: 0, next: 0, back: 0, silent: 0, carry: null, missing: [], err: "" };
      try {
        await tab.ev(`${D}.setView(${JSON.stringify(view)})`); await sleep(view.endsWith("-lib") ? 1900 : 700); await calm();
        // a selection made in the last view is still the selection here, with its detail open (one selection for every view)
        if (carried) { const now = await tab.ev(IN.shown); row.carry = now.selected === carried && now.shown; await esc(); carried = null; }
        await sleep(600); await calm(); let cand = await tab.ev(IN.candidates(view, PER));   // notes fade in as a view settles: sample again until the count stops growing
        for (let i = 0; i < 12; i++) {   // settled = the same notes at the same places twice running (a cooling layout moves them)
          await sleep(400); await calm(); const again = await tab.ev(IN.candidates(view, PER));
          const same = again.total === cand.total && again.picks.every((q, j) => cand.picks[j] && cand.picks[j].id === q.id && Math.hypot(cand.picks[j].x - q.x, cand.picks[j].y - q.y) < 1.5);
          cand = again; if (same) break;
        }
        row.total = cand.total; if (process.env.AUDIT_DEBUG) console.log(`    ${view} candidates`, JSON.stringify(cand.why));
        for (const c of cand.picks) {
          row.tried++;
          const before = await tab.ev(IN.shown), errs0 = before.errs;
          await click(c.x, c.y);
          const after = await tab.ev(IN.shown);
          if (process.env.AUDIT_DEBUG) console.log(`    ${view} click ${c.id} at ${Math.round(c.x)},${Math.round(c.y)} -> selected ${after.selected}, inspector ${after.shown}, view ${after.view}`);
          if (after.selected === c.id) row.select++;
          else if (after.selected) { row.overlap++; row.select++; }   // another note was drawn on top at that spot: counted as selecting, and reported as overlap
          if (after.errs === errs0) row.silent++;
          if (after.shown && baseline.length) { const miss = baseline.filter(l => !after.labels.includes(l)); if (!miss.length) row.actions++; else row.missing = [...new Set([...row.missing, ...miss])]; }
          if (after.labels.some(l => /^(next|skip|continue|done)\b/i.test(l))) row.next++;
          await esc();
          const gone = await tab.ev(IN.shown);
          if (gone.selected == null && gone.view === before.view) row.back++;
        }
        if (cand.picks.length) { await click(cand.picks[0].x, cand.picks[0].y); const sel = await tab.ev(IN.shown); carried = sel.selected; }   // left selected on purpose: the next view must still show it
      } catch (e) { row.err = String(e.message || e).slice(0, 120); }
      // a view with nothing to click, or any check that failed on some node, is a finding
      if (row.err) note("silent", view);
      else if (!row.total) note("reach", view);
      else {
        if (row.select < row.tried) note("select", view);
        if (row.overlap) note("overlap", view);
        if (baseline.length && row.actions < row.tried) note("actions", view);
        if (row.next < row.tried) note("next", view);
        if (row.back < row.tried) note("back", view);
        if (row.carry === false) note("carry", view);
        if (row.silent < row.tried) note("silent", view);
      }
      rows.push(row); console.log(`  ${view}: ${row.total} clickable, ${row.tried} tried, select ${row.select}, actions ${row.actions}, next ${row.next}, back ${row.back}${row.err ? " ERROR " + row.err : ""}`);
    }
  } finally { if (tab) await tab.close(); }

  const tick = (n, of) => (!of ? "–" : n === of ? "✓" : n === 0 ? "✗" : `${n}/${of}`);
  const lines = [`# Node click audit ${new Date().toISOString().slice(0, 10)}`, "", `${rows.length} views, ${PER >= 100000 ? "every clickable note" : "up to " + PER + " notes"} clicked for real in each${MOBILE ? " (phone size)" : ""}. ✓ all, ✗ none, n/m some. Rules: a click selects the note, shows every action the plain view's detail has, offers the next note, and Escape returns to the same screen.`, "",
    "| view | clickable | select | actions | next | back | silent | overlap |", "|---|---|---|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.view} | ${r.total} | ${r.err ? "error" : tick(r.select, r.tried)} | ${tick(r.actions, r.tried)} | ${tick(r.next, r.tried)} | ${tick(r.back, r.tried)} | ${tick(r.silent, r.tried)} | ${r.overlap || ""} |`);
  lines.push("", "## What to improve", "");
  if (!found.size) lines.push("Nothing: every view follows the click rules.");
  for (const [kind, set] of found) lines.push(`- **${kind}** (${set.size} views: ${[...set].join(", ")}): ${HOW[kind]}`);
  const missing = rows.filter(r => r.missing.length).map(r => `${r.view}: ${r.missing.slice(0, 6).join(", ")}`);
  if (missing.length) lines.push("", "Actions the plain view's detail has that these lack:", ...missing.map(m => `- ${m}`));
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, lines.join("\n") + "\n");
  // the machine-readable twin and the diff against the last run: nothing newly failing means one line to read, so a
  // scheduled run costs nothing; a regression is written to <out>.diff.md for whoever (or whatever) picks it up
  const KEYS = ["select", "actions", "next", "back", "silent"], JSON_OUT = OUT.replace(/\.md$/, ".json"), DIFF = OUT.replace(/\.md$/, ".diff.md");
  const prev = fs.existsSync(JSON_OUT) ? JSON.parse(fs.readFileSync(JSON_OUT, "utf8")) : null;
  const now = Object.fromEntries(rows.map(r => [r.view, { total: r.total, err: r.err || null, ...Object.fromEntries(KEYS.map(k => [k, r.tried ? r[k] / r.tried : null])) }]));
  const worse = [], better = [];
  if (prev) for (const [v, n] of Object.entries(now)) for (const k of KEYS) {
    const o = prev.views[v] && prev.views[v][k]; if (o == null || n[k] == null || Math.abs(n[k] - o) < 1e-9) continue;
    (n[k] < o ? worse : better).push(`${v} ${k}: ${Math.round(o * 100)}% -> ${Math.round(n[k] * 100)}%`);
  }
  fs.writeFileSync(JSON_OUT, JSON.stringify({ date: new Date().toISOString(), vault: env.VAULT, views: now }, null, 1));
  if (worse.length) fs.writeFileSync(DIFF, `# Node audit: newly failing\n\n${worse.map(w => "- " + w).join("\n")}\n\nFixed since the last run:\n${better.map(w => "- " + w).join("\n") || "- none"}\n\nFull report: ${OUT}\n`);
  else if (fs.existsSync(DIFF)) fs.unlinkSync(DIFF);
  console.log(prev ? `Since the last run: ${worse.length} worse, ${better.length} better` : "First run: nothing to compare with");
  if (process.argv.includes("--gate") && worse.length) { console.log(`FAIL - ${worse.length} checks got worse; see ${DIFF}`); process.exitCode = 1; }
  console.log(`\nWrote ${OUT}: ${found.size} kinds of finding across ${rows.length} views`);
})().catch(e => { console.error(e); process.exit(1); });
