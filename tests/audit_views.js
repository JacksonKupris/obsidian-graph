#!/usr/bin/env node
// Views and menus audit: opens every view and menu of the graph page in headless Chrome and reports where they break the
// standing rules (global-rules.md, briefs/readable-views.md). A report, not a pass/fail test: the findings are the to-do list.
// Companion of audit_nodes.js (what a click on a note does) and audit_repeats.js (copies in the source).
//   explains   the view says what it shows (a hint in the picker) and a legend or sub-title is on screen
//   named      every visible control has a name, and none is too small to press (44 px on a phone, 24 px on a desktop)
//   fits       nothing runs off the pane; no two visible controls overlap (checked at 360 px with --mobile)
//   next       an empty state or a message offers an action, never a dead end
//   back       Escape returns to the screen it came from (a report beside the canvas closes; a menu closes)
//   plain      no visible text that reassures or explains the machinery
//   silent     opening it throws nothing
//   panels     the graph's side panels (Insights, Topics) and, with --obsidian, the plugin's own side views (Suggestions, Local graph, HQ) in the real Obsidian: named, fit, rows do something, no dead ends
//   menus      each menu opens, lists named items with a one-line meaning, and closes on Escape
//   node tests/audit_views.js [--obsidian] [--mobile] [--view slime] [--out file.md] [--gate] [--vault [dir]]
// Writes .out/views-audit.md (and .json; --gate fails when a check got worse than the last run).
const fs = require("fs"), path = require("path");
const { sleep, openPage } = require("./kit");
const env = require("./env");
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const MOBILE = process.argv.includes("--mobile"), ONLY = arg("--view", ""), OUT = arg("--out", env.out(MOBILE ? "views-audit-mobile.md" : "views-audit.md"));
const SAYS = "automatically|right away|straight away|immediately|in the background|no refresh|without (a )?refresh|joins the|Live ·|don't worry|behind the scenes|re-?analysed|updates itself";

const HOW = {
  panels: "A side panel (the graph's Insights and Topics, the plugin's Suggestions, Local graph and HQ) must follow the same rules as a view: named, big enough, inside its pane, rows that open the shared detail, empty states that say what to do next. Build each from the shared panel helpers (src/parts.js) so one fix reaches all.",
  explains: "Give the view a hint (its registry entry, read by the picker) and a legend or sub-title from the shared frame, so a first-time user can read what it shows and what the colours and sizes mean.",
  named: "A control with no name or under the minimum tap size. Name it through the shared button helper (aria-label, title) and size it with the shared token, not per view.",
  fits: "Something runs off the pane or sits on another control. Fix it in the shared frame (toolbar, dock, sheet) so every view gets it, then re-measure at 360 px.",
  next: "An empty state or message with no button. Use the shared empty-state helper (`vg-empty` + `vg-empty-next`) so every dead end points to what to do next.",
  back: "Escape does not return to the previous screen. Push the opening onto the shared view stack so Back and Escape share one path.",
  plain: "The interface explains its machinery or reassures. Say what it is or what happened, and stop; move the mechanism into a comment or the docs.",
  silent: "Opening the view raised a page error. A view must never throw on opening.",
  menus: "A menu item with no name or meaning, a menu that doesn't open, or one Escape doesn't close. Build menus from the one shared menu helper so each follows every rule.",
};

// what the page shows right now, as one object (runs in the page)
const probeOf = sel => `(() => { const root = document.querySelector(${JSON.stringify(sel)}) || document.body, R = root.getBoundingClientRect();
  /* a control inside a closed <details> is laid out but not drawn: it has a size and a place and cannot be seen or pressed */
  const closedMore = e => { for (let d = e.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) if (!d.open && !(e.closest("summary") && e.closest("summary").parentElement === d)) return true; return false; };
  /* on a phone the side panel is a drawer slid off the pane until opened: its controls are not on screen */
  const closedDrawer = e => { const d = e.closest(".vg-side"); return !!d && d.getBoundingClientRect().right <= R.left + 1; };
  const seen = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && c.display !== "none" && +c.opacity > 0.05 && !e.closest("[hidden]") && !closedMore(e) && !closedDrawer(e); };
  const name = e => (e.getAttribute("aria-label") || e.textContent || (e.labels && e.labels[0] ? e.labels[0].textContent : "") || e.title || e.getAttribute("data-act") || "").trim().replace(/\\s+/g, " ");
  // a control scrolled out of sight inside a scrolling panel (or clipped by it) is not off the pane
  const clipped = e => { const r = e.getBoundingClientRect(); for (let p = e.parentElement; p && p !== root; p = p.parentElement) { const c = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(c.overflow + c.overflowX + c.overflowY)) { const q = p.getBoundingClientRect(); if (r.bottom > q.bottom + 1 || r.top < q.top - 1 || r.right > q.right + 1 || r.left < q.left - 1) return true; } } return false; };
  const ctl = [...root.querySelectorAll("button, [role=button], [role=menuitem], input, select")].filter(e => seen(e) && !clipped(e) && !e.disabled && !e.closest(".vg-gl, .vg-tour, .vg-tour-card") && !(e.type === "range"));
  const noName = ctl.filter(e => !name(e) && !(e.type === "range")).map(e => e.className.toString().slice(0, 40));
  const small = ctl.filter(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < ${MOBILE ? "(parseFloat(getComputedStyle(root).getPropertyValue('--vg-tap')) || 44)" : 24} && !e.closest(".vg-seg, .vg-dock") && !(e.matches("input[type=checkbox], input[type=radio]") && e.labels && e.labels.length);   /* a box inside its label: the label is what is pressed */ }).map(e => (name(e).slice(0, 24) || e.className.toString().slice(0, 30)) + " " + Math.round(e.getBoundingClientRect().width) + "x" + Math.round(e.getBoundingClientRect().height) + " ." + String(e.className.baseVal ?? e.className).split(" ")[0]);
  const out = ctl.filter(e => { const r = e.getBoundingClientRect(); return r.right > R.right + 2 || r.left < R.left - 2 || r.bottom > R.bottom + 2; }).map(e => name(e).slice(0, 24));
  const over = []; const boxes = ctl.map(e => ({ e, r: e.getBoundingClientRect() }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 4 && h > 4) over.push(name(a.e).slice(0, 18) + " / " + name(b.e).slice(0, 18)); }
  const lens = document.querySelector(".vg-lens"), lensOpen = !!lens && !lens.hidden, body = lensOpen ? lens.querySelector(".vg-lens-body") : null;
  const legend = (document.querySelector(".vg-legend") || {}).textContent || "", sub = lensOpen ? (lens.querySelector(".vg-lens-sub") || {}).textContent || "" : "";
  const empties = [...root.querySelectorAll(".vg-empty")].filter(seen).map(e => ({ text: e.textContent.trim().slice(0, 60), next: !!(e.parentElement && e.parentElement.querySelector(".vg-empty-next button, button, a")) }));
  const text = [...root.querySelectorAll("*")].filter(e => seen(e) && ![...e.children].length && e.textContent.trim().length > 6).map(e => e.textContent.trim()).filter(t => new RegExp(${JSON.stringify(SAYS)}, "i").test(t)).map(t => t.slice(0, 70));
  return { lensOpen, legend: legend.trim().slice(0, 60), sub: sub.trim().slice(0, 60), buttons: body ? body.querySelectorAll("button").length : null, noName: [...new Set(noName)], small: [...new Set(small)], out: [...new Set(out)], over: [...new Set(over)].slice(0, 6), empties, text: [...new Set(text)], view: ((window.vaultGraph && window.vaultGraph.viewport()) || {}).view || null, errs: (window.__errs || []).length }; })()`;
const PROBE = probeOf(".vg-root");

(async () => {
  const data = env.data(), rows = [], found = new Map(), menuRows = [];
  const note = (kind, who, why) => { if (!found.has(kind)) found.set(kind, new Map()); const m = found.get(kind); if (!m.has(who)) m.set(who, new Set()); if (why) m.get(who).add(why); };
  let tab = null;
  try {
    tab = await openPage({ html: env.pageWith(MOBILE ? "mobile: true," : "", data), mobile: MOBILE });
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const D = "window.vaultGraph._debug", calm = async () => { await tab.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove()); ${D}.drawNow && ${D}.drawNow()`); await sleep(80); };
    const esc = async () => { await tab.ev(`(() => { const t = document.querySelector(".vg-lens:not([hidden]) .vg-lens-close") || document.querySelector(".vg-root button"); if (t) t.focus(); })()`); for (const type of ["keyDown", "keyUp"]) await tab.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(250); await calm(); };
    // the first-run tour starts 1.8 s after the graph opens and takes the first Escape (it sits over everything), so a view that happened to be open then looked as if Escape did not close it: end the tour first
    for (let i = 0; i < 20 && !await tab.ev(`!!document.querySelector(".vg-tour")`); i++) await sleep(250);
    await esc();
    const views = (await tab.ev(`${D}.allViews()`)).filter(v => !ONLY || v.key === ONLY);

    for (const v of views) {
      const row = { view: v.key, name: v.name, hidden: v.hidden, explains: false, named: false, fits: false, next: true, back: null, plain: false, silent: false, detail: {} };
      try {
        await tab.ev(`window.__errs = []`); await tab.ev(`${D}.openView(${JSON.stringify(v.key)})`); await sleep(v.key.endsWith("-lib") ? 1900 : 900); await calm();
        for (let i = 0; i < 40 && await tab.ev(`!![...document.querySelectorAll(".vg-lens-body .vg-empty")].find(e => /^Loading…/.test(e.textContent))`); i++) await sleep(250);   // a lens that loads asynchronously is measured once it has loaded
        const s = await tab.ev(PROBE);
        row.explains = !!(v.hint && v.hint.length > 8) && !!(s.legend || s.sub || s.lensOpen);
        if (!v.hint) row.detail.explains = "no hint in the registry"; else if (!(s.legend || s.sub || s.lensOpen)) row.detail.explains = "no legend or sub-title on screen";
        row.named = !s.noName.length && !s.small.length; if (!row.named) row.detail.named = [...s.noName.map(n => "no name: " + n), ...s.small.map(n => "small: " + n)].slice(0, 5).join("; ");
        row.fits = !s.out.length && !s.over.length; if (!row.fits) row.detail.fits = [...s.out.map(n => "off the pane: " + n), ...s.over.map(n => "overlap: " + n)].slice(0, 5).join("; ");
        row.next = s.empties.every(e => e.next); if (!row.next) row.detail.next = s.empties.filter(e => !e.next).map(e => `"${e.text}"`).join("; ");
        row.plain = !s.text.length; if (!row.plain) row.detail.plain = s.text.join("; ");
        row.silent = s.errs === 0; if (!row.silent) row.detail.silent = "page error";
        if (s.lensOpen) { await esc(); const after = await tab.ev(PROBE); row.back = !after.lensOpen; if (!row.back) row.detail.back = "the report stayed open" + await tab.ev(`(() => { const a = document.activeElement, v = q => { const e = document.querySelector(q); return e && !e.hidden ? q : ""; }; return "; focus on " + (a ? a.tagName + "." + String(a.className).slice(0, 30) : "nothing") + ", layers open: " + [v(".vg-palette"), v(".vg-picker"), v(".vg-toolsmenu"), v(".vg-tour"), v("[class*=tour]"), v(".vg-lens")].filter(Boolean).join(" ") })()`); }
      } catch (e) { row.err = String(e.message || e).slice(0, 100); row.silent = false; row.detail.silent = row.err; }
      for (const k of ["explains", "named", "fits", "next", "plain", "silent"]) if (row[k] === false) { const items = String(row.detail[k] || "").split("; ").filter(Boolean); if (items.length) items.forEach(x => note(k, v.key, x)); else note(k, v.key); }
      if (row.back === false) note("back", v.key, row.detail.back);
      rows.push(row); console.log(`  ${v.key}: ${["explains", "named", "fits", "next", "back", "plain", "silent"].map(k => k + " " + (row[k] === null ? "–" : row[k] ? "✓" : "✗")).join(", ")}`);
    }

    // menus: the picker and the tools menu (and each picker tab); each must open, list named items, and close on Escape
    if (!ONLY) {
      await tab.ev(`${D}.setView("2d")`); await sleep(600); await calm();
      const MENUS = [
        { name: "Views picker", open: `document.querySelector(".vg-pickbtn").click()`, items: `[...document.querySelectorAll(".vg-picker .vg-tile, .vg-picker [role=menuitem], .vg-sheet .vg-tile")]`, shown: `!!document.querySelector(".vg-picker:not([hidden]), .vg-sheet:not([hidden])")` },
        { name: "Tools menu", open: `document.querySelector(".vg-toolsbtn").click()`, items: `[...document.querySelectorAll(".vg-toolsmenu [role=menuitem]")]`, shown: `!!document.querySelector(".vg-toolsmenu:not([hidden])")` },
      ];
      for (const m of MENUS) {
        const mr = { name: m.name, opens: false, items: 0, bare: [], closes: false };
        try {
          await tab.ev(m.open); await sleep(400);
          const r = await tab.ev(`(() => { const items = ${m.items}; return { shown: ${m.shown}, n: items.length, bare: items.filter(e => !(e.textContent || "").trim() || !((e.title || e.getAttribute("aria-label") || "") + [...e.querySelectorAll(".vg-muted, small")].map(x => x.textContent).join("")).trim() && !(e.textContent || "").trim().includes(" ")).map(e => (e.textContent || e.className).trim().slice(0, 24)) }; })()`);
          mr.opens = r.shown && r.n > 0; mr.items = r.n; mr.bare = r.bare;
          await esc(); mr.closes = !(await tab.ev(m.shown));
        } catch (e) { mr.err = String(e.message || e).slice(0, 80); }
        if (!mr.opens) note("menus", m.name, "didn't open or lists nothing"); if (mr.bare.length) note("menus", m.name, "items with no meaning: " + mr.bare.slice(0, 4).join(", ")); if (mr.opens && !mr.closes) note("menus", m.name, "Escape doesn't close it");
        menuRows.push(mr); console.log(`  menu ${m.name}: ${mr.opens ? mr.items + " items" : "did not open"}, closes ${mr.closes ? "✓" : "✗"}`);
      }
    }

    // side panels of the graph page: each tab is probed like a view, and its first row must do something
    if (!ONLY) {
      await tab.ev(`${D}.setView("2d")`); await sleep(500); const openSide = async () => { await tab.ev(`(() => { const s = document.querySelector(".vg-side"); if (s && (getComputedStyle(s).display === "none" || s.getBoundingClientRect().right <= 1)) document.querySelector(".vg-toggle").click(); /* on a phone the panel is a drawer slid off the screen, not display:none */ })()`); await sleep(400); }; await openSide();
      for (const name of ["insights", "clusters"]) {
        const pr = { name: "Side panel: " + name, tabs: true, rows: 0, acts: null, probe: null };
        try {
          await openSide(); /* a row that opens something closes the phone drawer, so each panel starts with it open */
          await tab.ev(`(document.querySelector('.vg-tab[data-tab="${name}"]') || {click(){}}).click()`); await sleep(400);
          const s = await tab.ev(probeOf(".vg-side")); pr.probe = s;
          const first = await tab.ev(`(() => { const p = document.querySelector('.vg-panel[data-panel="${name}"]'); const b = p && [...p.querySelectorAll("button, [role=button], .vg-row")].find(e => e.getBoundingClientRect().height > 0 && !e.closest("[hidden]") && !e.matches('[data-stat="all"]')); /* "fit the whole graph" only moves the camera, which the DOM does not show */ if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, what: b.outerHTML.slice(0, 110), n: p.querySelectorAll("button, [role=button], .vg-row").length }; })()`);
          pr.rows = first ? first.n : 0; pr.what = first && first.what;
          if (first) {
            const before = await tab.ev(`JSON.stringify([window.vaultGraph.viewport().selected, window.vaultGraph.viewport().cam, !!document.querySelector(".vg-inspector:not([hidden])"), document.querySelector(".vg-lens:not([hidden])") ? 1 : 0, document.querySelector(".vg-side").innerHTML.length, (document.querySelector(".vg-tab[aria-selected=true]") || {}).textContent, document.querySelectorAll(".vg-side .is-on").length, Math.round(document.querySelector(".vg-side").getBoundingClientRect().right)])`); /* a row that marks itself or closes the phone drawer did something */
            for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x: first.x, y: first.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
            await sleep(500); const after = await tab.ev(`JSON.stringify([window.vaultGraph.viewport().selected, window.vaultGraph.viewport().cam, !!document.querySelector(".vg-inspector:not([hidden])"), document.querySelector(".vg-lens:not([hidden])") ? 1 : 0, document.querySelector(".vg-side").innerHTML.length, (document.querySelector(".vg-tab[aria-selected=true]") || {}).textContent, document.querySelectorAll(".vg-side .is-on").length, Math.round(document.querySelector(".vg-side").getBoundingClientRect().right)])`); /* a row that marks itself or closes the phone drawer did something */
            pr.acts = before !== after; await esc(); await esc(); }
        } catch (e) { pr.err = String(e.message || e).slice(0, 80); }
        const sp = pr.probe; if (sp) { if (sp.noName.length || sp.small.length) note("panels", pr.name, "named: " + [...sp.noName.map(n => "no name " + n), ...sp.small.map(n => "small " + n)].slice(0, 4).join(", ")); if (sp.out.length || sp.over.length) note("panels", pr.name, "fits: " + [...sp.out, ...sp.over].slice(0, 4).join(", ")); if (!sp.empties.every(e => e.next)) note("panels", pr.name, "dead end: " + sp.empties.filter(e => !e.next).map(e => e.text).join(", ")); if (sp.text.length) note("panels", pr.name, "wording: " + sp.text.join(", ")); }
        if (pr.rows === 0) note("panels", pr.name, "nothing to click"); else if (pr.acts === false) note("panels", pr.name, "its first row does nothing: " + pr.what);
        menuRows.push({ name: pr.name, opens: pr.rows > 0, items: pr.rows, closes: pr.acts !== false, panel: true }); console.log(`  ${pr.name}: ${pr.rows} controls, first one ${pr.acts === null ? "–" + (pr.err ? " (" + pr.err + ")" : "") : pr.acts ? "acts" : "does nothing"}`);
      }
    }
  } finally { if (tab) await tab.close(); }

  // the plugin's own side views, in the real Obsidian (needs it running; the helper is the vault's, as install_release uses)
  if (process.argv.includes("--obsidian") && !ONLY) {
    const { obsidianEval, vaultOf } = require("../scripts/install_release"), vault = vaultOf(null);
    if (!vault) console.log("--obsidian: no vault (set local.json)");
    else for (const [type, name] of [["vault-graph-suggest", "Suggestions"], ["vault-graph-local", "Local graph"], ["vault-graph-hq", "Vault HQ"]]) {
      const code = `let l = app.workspace.getLeavesOfType(${JSON.stringify(type)})[0], had = !!l; if (!l) { l = app.workspace.getRightLeaf(false); await l.setViewState({ type: ${JSON.stringify(type)}, active: true }); }
        await new Promise(r => setTimeout(r, 2500)); const r = JSON.stringify(${probeOf(`.workspace-leaf-content[data-type="${type}"]`)}); if (!had) l.detach(); return r;`;
      const r = obsidianEval(vault, code), pr = { name: "Obsidian side view: " + name, opens: false, items: 0, closes: true, panel: true };
      if (r.noHelper || !r.running || r.error) { console.log(`  ${pr.name}: skipped (${r.noHelper ? "no vault helper" : !r.running ? "Obsidian isn't running" : r.error})`); continue; }
      const sp = JSON.parse(r.value); pr.opens = true; pr.items = sp.noName.length + sp.small.length;
      if (sp.noName.length || sp.small.length) note("panels", pr.name, "named: " + [...sp.noName.map(n => "no name " + n), ...sp.small.map(n => "small " + n)].slice(0, 4).join(", "));
      if (sp.out.length || sp.over.length) note("panels", pr.name, "fits: " + [...sp.out, ...sp.over].slice(0, 4).join(", "));
      if (!sp.empties.every(e => e.next)) note("panels", pr.name, "dead end: " + sp.empties.filter(e => !e.next).map(e => e.text).join(", "));
      if (sp.text.length) note("panels", pr.name, "wording: " + sp.text.join(", "));
      menuRows.push(pr); console.log(`  ${pr.name}: read in Obsidian`);
    }
  }

  const t = b => (b === null ? "–" : b ? "✓" : "✗");
  const lines = [`# Views and menus audit ${new Date().toISOString().slice(0, 10)}${MOBILE ? " (phone width)" : ""}`, "",
    `${rows.length} views and ${menuRows.length} menus opened in a browser. ✓ passes, ✗ breaks a rule, – not applicable. Rules: a view says what it shows and has a legend; every control is named and big enough; nothing overlaps or runs off the pane; no dead ends; Escape goes back; no reassuring text.`, "",
    "| view | explains | named | fits | next | back | plain | silent |", "|---|---|---|---|---|---|---|---|",
    ...rows.map(r => `| ${r.view}${r.hidden ? " (hidden)" : ""} | ${["explains", "named", "fits", "next", "back", "plain", "silent"].map(k => t(r[k])).join(" | ")} |`), "",
    "| menu or panel | opens | items | closes / acts |", "|---|---|---|---|", ...menuRows.map(m => `| ${m.name} | ${t(m.opens)} | ${m.items} | ${t(m.closes)} |`), "", "## What to improve", ""];
  if (!found.size) lines.push("Nothing: every view and menu follows the rules.");
  // a finding the same on most views is the shared frame's, not each view's: said once
  const shared = [];
  for (const [kind, who] of found) { const by = new Map(); for (const [w, why] of who) for (const x of why) by.set(x, (by.get(x) || 0) + 1);
    for (const [x, n] of by) if (rows.length > 4 && n >= rows.length * 0.6) { shared.push(`- **${kind}**, ${n} of ${rows.length} views the same (shared frame): ${x}`); for (const [, why] of who) why.delete(x); } }
  if (shared.length) lines.push("Shared by most views, so fix once in the frame:", ...shared, "");
  for (const [kind, who] of found) { for (const [w, why] of [...who]) if (!why.size && kind !== "explains" && kind !== "back") who.delete(w); if (!who.size) continue; lines.push(`- **${kind}** (${who.size}: ${[...who.keys()].join(", ")}): ${HOW[kind]}`); for (const [w, why] of who) if (why.size) lines.push(`  - ${w}: ${[...why].join("; ").slice(0, 200)}`); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, lines.join("\n") + "\n");

  const KEYS = ["explains", "named", "fits", "next", "back", "plain", "silent"], JSON_OUT = OUT.replace(/\.md$/, ".json");
  const now = Object.fromEntries(KEYS.map(k => [k, rows.filter(r => r[k] === false).length]));
  now.menus = [...(found.get("menus") || new Map()).keys()].length; now.panels = [...(found.get("panels") || new Map()).keys()].length;
  const prev = fs.existsSync(JSON_OUT) ? JSON.parse(fs.readFileSync(JSON_OUT, "utf8")).failing : null;
  fs.writeFileSync(JSON_OUT, JSON.stringify({ date: new Date().toISOString(), vault: env.VAULT, failing: now, rows, menus: menuRows }, null, 1));
  const worse = prev ? Object.keys(now).filter(k => now[k] > (prev[k] ?? now[k])) : [];
  console.log(`Failing views per rule: ${Object.entries(now).map(([k, n]) => k + " " + n).join(", ")}${prev ? ` (${worse.length ? "worse: " + worse.join(", ") : "no worse than the last run"})` : " (first run)"}`);
  console.log(`Wrote ${OUT}`);
  if (process.argv.includes("--gate") && worse.length) { console.log(`FAIL - ${worse.join(", ")} got worse`); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
