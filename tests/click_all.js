#!/usr/bin/env node
// Click-everything test of the graph page in headless Chrome. Every distinct control (one of each kind per view,
// lens, panel and inspector, not all 120 identical rows) is clicked in its context, twice over:
//   read-only  the page as published (no vault access): nothing may throw
//   write      remounted with recording stand-ins for every write action (the plugin's viewActions): confirm boxes
//              get OK, pickers get their first choice, and each write button must reach the action it names
// For each control it also checks the click would land on it (nothing drawn over it) and notes clicks that change
// nothing at all. What the actions do to the vault is checked separately by live_e2e.js.
//   node tests/click_all.js [--verbose] [--mobile] [--vault [dir]]        exit 0 = no errors, nothing covered, every write button wired
//   node tests/click_all.js --phone   the same clicks in Obsidian on a phone plugged in over USB (USB debugging on):
//              the real plugin and layout, its graph remounted with the recording stand-ins, so nothing is written; view
//              settings aren't saved, and the real actions come back at the end. One pass (the write pass).
//              --resume: after the USB link dropped (Samsung's Auto Blocker turns USB commands off again after 30 min),
//              collect the result of the run still going on the phone, and put the real actions back.
const fs = require("fs"), path = require("path");
const VERBOSE = process.argv.includes("--verbose");
// --mobile: a phone (420 x 900, touch, 2x pixels) with the page's mobile layout, which is where most overlaps show up
const MOBILE = process.argv.includes("--mobile"), PHONE = process.argv.includes("--phone"), RESUME = PHONE && process.argv.includes("--resume");
const page = require("./env").page();

// ---- the probe that runs inside the page
const probe = String.raw`<script>
(run => (async () => {
const live = () => window.__VG_RUN__ === run;
const sleep = ms => new Promise(r => setTimeout(r, ms)), out = { clicks: 0, contexts: 0, errors: [], covered: [], notices: [], noEffect: [], wired: {}, wiredAct: {}, unwired: [], slow: [] };
// a frame should fit 30 fps on a slow machine; headless Chrome draws without a GPU, so the budget is loose
const FRAME_BUDGET = 60;
let errs = [];
addEventListener("error", e => errs.push(String(e.message)));
addEventListener("unhandledrejection", e => errs.push("promise: " + String(e.reason && e.reason.message || e.reason)));
const doc = () => window.__VG_SCOPE__ || document, root = () => doc().querySelector(".vg-root");
const H = () => window.vaultGraph, D = () => window.vaultGraph._debug;

// what a control is, for "one of each kind": its tag, classes and which action it names (not the note it's on)
const KEYS = ["act", "r", "view", "tab", "floor", "el", "all", "c", "depth", "vision", "auto", "theme", "ppanel", "relens"];
const sigOf = el => [el.tagName.toLowerCase(), [...el.classList].filter(c => !/^is-/.test(c)).sort().join("."),
  Object.keys(el.dataset).sort().join(","), KEYS.map(k => el.dataset[k] || "").join("|"), el.getAttribute("aria-label") && !Object.keys(el.dataset).length && !el.closest(".vg-sugg, .vg-st-row, .vg-pb-card, .vg-item") ? el.getAttribute("aria-label").slice(0, 24) : ""].join("#");
// checkVisibility: content in a closed <details> still reports a box, though nothing is drawn there
const visible = el => { if (el.closest("[hidden]") || el.disabled || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && r.right > 0 && r.left < innerWidth; };   // not slid off-screen (a phone's closed drawer)
const CLICKABLE = "button, a[href], [role=button], input[type=checkbox], summary, [data-id], [data-open], .vg-pitem";
// a context's own controls: the picker's, the open drawer's (the toolbar behind it is covered by design), or the pane's
const controls = ctx => [...((ctx && ctx.picker ? doc().querySelector(".vg-picker") : ctx && ctx.side ? doc().querySelector(".vg-side") : null) || root()).querySelectorAll(CLICKABLE)].filter(visible).filter(el => !el.matches(".vg-pq, .vg-picker-q, input[type=range], input[type=search], canvas"));
const state = () => { const d = D(); return JSON.stringify([d.st.view, d.st.selected, d.st.focus, !!d.st.highlight, d.st.palaceFloor, root().className, root().innerHTML.length,
  d.cam.k.toFixed(3), d.cam.tx.toFixed(1), d.cam.ty.toFixed(1), [...doc().querySelectorAll(".vg-root [aria-pressed=true], .vg-root [aria-selected=true]")].length]); };

// ---- contexts: views, inspector kinds, lenses, picker tabs, palace floors, missions
async function reset() {
  doc().querySelectorAll(".vg-confirm, .vg-actmenu, .vg-tour").forEach(x => x.remove());
  // a narrow pane's side panels are a drawer over the view (desktop shows them beside it): one opened in the last
  // context would cover this one
  if (root().classList.contains("vg-side-open")) { const t = doc().querySelector(".vg-toggle"); if (t) { t.click(); await sleep(150); } }
  for (const sel of [".vg-palette:not([hidden])", ".vg-picker:not([hidden])"]) { const p = doc().querySelector(sel); if (p) { root().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(60); } }
  const px = doc().querySelector(".vg-picker:not([hidden]) .vg-picker-x"); if (px) px.click();
  const lc = doc().querySelector(".vg-lens:not([hidden]) .vg-lens-close"); if (lc) lc.click();
}
async function enter(ctx) {
  await reset();
  if (D().st.view !== ctx.view) { D().setView(ctx.view); await sleep(ctx.view === "2d" || ctx.view === "3d" ? 500 : 1300); }
  if (ctx.select) { H().focusNote(ctx.select); await sleep(350); } else { const x = [...doc().querySelectorAll(".vg-ins-close")].find(visible); if (x) { x.click(); await sleep(120); } }   // the open one: each inspector kind has its own close, and a phone's sheet stays open over the next view
  if (ctx.lens) { D().openLens(ctx.lens); await sleep(300); }
  if (ctx.picker) { doc().querySelector(".vg-pickbtn").click(); await sleep(150); const t = doc().querySelector('.vg-picker-tab[data-tab="' + ctx.picker + '"]'); if (t) t.click(); await sleep(150); }
  if (ctx.floor != null) { const b = [...doc().querySelectorAll(".vg-floorbar button")][ctx.floor]; if (b) { b.click(); await sleep(1300); } }
  if (ctx.side && !root().classList.contains("vg-side-open")) { doc().querySelector(".vg-toggle").click(); await sleep(250); }
  if (ctx.missions) { const g = doc().querySelector(".vg-gamebtn"); if (g && g.getAttribute("aria-pressed") !== "true") g.click(); await sleep(200); }
}
// wait until an element's slide or fade has finished (its CSS transitions and animations), or a second at most
async function settled(sel) {
  await sleep(40);
  for (let i = 0; i < 48; i++) { const e = doc().querySelector(sel);
    if (!e || !e.getAnimations({ subtree: true }).some(a => a.playState === "running")) return; await sleep(20); }
}
async function tidy(ctx) {
  doc().querySelectorAll(".vg-confirm, .vg-actmenu").forEach(x => x.remove());
  if (!ctx.side && root().classList.contains("vg-side-open")) { doc().querySelector(".vg-toggle").click(); await settled(".vg-side"); }   // the drawer covers the toolbar while open
  // an inspector a write opened (Draft bridge, Create) stays over the next context's controls: close it, unless it's this context's
  if (!ctx.select) { const x = [...doc().querySelectorAll(".vg-ins-close")].find(visible); if (x) { x.click(); await sleep(120); } }
  if (!ctx.picker && !doc().querySelector(".vg-picker").hidden) { doc().querySelector(".vg-picker-scrim").click(); await sleep(60); }
  if (!ctx.lens && !doc().querySelector(".vg-lens").hidden) { doc().querySelector(".vg-lens-close").click(); await sleep(60); }
  if (!doc().querySelector(".vg-timebar").hidden) { doc().querySelector(".vg-maptime").click(); await sleep(60); }
  const rs = doc().querySelector(".vg-replay:not([hidden]) .vg-replay-stop"); if (rs) { rs.click(); await sleep(60); }
  const pal = doc().querySelector(".vg-palette:not([hidden])"); if (pal) { root().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(60); }
}
// the side panels are a drawer over the view in a narrow pane (beside it otherwise): the toggle opens and closes it
const drawerPane = () => getComputedStyle(doc().querySelector(".vg-side")).position === "absolute";
const intact = ctx => (!ctx.side || root().classList.contains("vg-side-open")) && D().st.view === ctx.view && (!ctx.select || D().st.selected === ctx.select) && (!ctx.lens || !doc().querySelector(".vg-lens").hidden)
  && (!ctx.picker || !doc().querySelector(".vg-picker").hidden) && !doc().querySelector(".vg-confirm, .vg-palette:not([hidden])");

function contexts() {
  const d = D(), cs = d.views().map(v => ({ name: "view " + v, view: v }));
  const notes = d.nodes.filter(n => !n.ghost && !n.person && !n.moc);
  const pick = (label, f) => { const n = d.nodes.find(f); if (n) cs.push({ name: "inspector: " + label, view: "2d", select: n.id }); };
  // the shared rulebook: a global on the page; inside the plugin it's private, so the view lends it (_debug.rules)
  const rules = window.VGRules || D().rules, days = (window.__VG_DATA__.quality || {}).stale_days;
  const stale = n => rules ? rules.isStale(n, days) : n.age > days;
  pick("note with tasks, stale, no refs", n => notes.includes(n) && n.tasks > 0 && n.refs === false && stale(n));
  pick("note named in dailies, never linked", n => notes.includes(n) && (window.__VG_DATA__.said_unlinked || []).some(([id]) => id === n.id));
  pick("note", n => notes.includes(n) && !n.tasks);
  pick("map", n => n.moc); pick("unwritten note", n => n.ghost); pick("person", n => n.person);
  d.lenses().forEach(k => cs.push({ name: "lens " + k, view: "2d", lens: k }));
  ["views", "lenses", "style", "health"].forEach(t => cs.push({ name: "picker " + t, view: "2d", picker: t }));
  for (let f = 0; f < 6; f++) cs.push({ name: "palace floor " + f, view: "palace", floor: f });
  cs.push({ name: "missions panel", view: "2d", missions: true });
  if (root().matches(".vg-root") && drawerPane()) cs.push({ name: "side drawer", view: "2d", side: true });   // a narrow pane's side panels
  return cs;
}

// ---- one pass: every distinct control in every context
const menuTried = { read: new Set(), write: new Set() };   // action-menu items clicked so far, per pass
const MENU_FIRST = ["link", "mentions", "map", "reference", "current", "archive", "cancel", "complete"];   // last = tried first
async function pass(mode, calls) {
  const seen = new Set();
  for (const ctx of contexts()) {
    if (!live()) throw new Error("a newer run took over");
    const t0 = performance.now();
    await enter(ctx); out.contexts++;
    const kinds = [], have = new Set();
    for (const el of controls(ctx)) { const s = sigOf(el); if (!have.has(s) && !seen.has(mode + ctx.name.split(":")[0] + s)) { have.add(s); kinds.push(s); } }
    for (const sig of kinds.slice(0, 160)) {
      await tidy(ctx);
      if (!intact(ctx)) await enter(ctx);
      const el = controls(ctx).find(e => sigOf(e) === sig); if (!el) continue;
      seen.add(mode + ctx.name.split(":")[0] + sig);
      el.scrollIntoView({ block: "center", inline: "nearest" });   // clear of sticky bars at a panel's edges
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const top = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
      const label = (el.getAttribute("aria-label") || el.title || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const byNotice = top && top.closest && top.closest(".notice-container");   // Obsidian's own popups (another plugin's message): noted, not the graph's fault
      if (byNotice) out.notices.push({ mode, ctx: ctx.name, control: label, by: (byNotice.innerText || "").trim().slice(0, 60) });
      else if (top && !(el === top || el.contains(top) || top.contains(el)) && !(top.closest && top.closest("[data-id]") && el.matches("[data-id]"))) out.covered.push({ mode, ctx: ctx.name, control: label, by: ((top.getAttribute && top.getAttribute("class")) || top.tagName).toString().slice(0, 40) });   // an SVG's className isn't a string
      const before = state(), nCalls = calls.length; errs = [];
      try { typeof el.click === "function" ? el.click() : el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch (e) { errs.push(e.message); }
      out.clicks++;
      await sleep(160);
      // follow-ups: an action menu (one item it hasn't tried yet, so across every "⋯" each action is reached), a
      // confirm box (OK in the write pass, Cancel otherwise), a typed answer, a note picker
      let menuAct = null;
      for (let i = 0; i < 4; i++) {
        const menu = doc().querySelector(".vg-actmenu");
        if (menu && !menuAct) { const it = [...menu.querySelectorAll("[data-act]")].filter(b => !menuTried[mode].has(b.dataset.act))
            .sort((a, b) => MENU_FIRST.indexOf(b.dataset.act) - MENU_FIRST.indexOf(a.dataset.act))[0];   // the write actions first
          if (it) { menuAct = it.dataset.act; menuTried[mode].add(menuAct); it.click(); await sleep(160); continue; } }
        const box = doc().querySelector(".vg-confirm");
        if (box) { const ta = box.querySelector("textarea"); if (ta) ta.value = "click-all test"; box.querySelector(mode === "write" ? '[data-c="ok"]' : '[data-c="no"]').click(); await sleep(160); continue; }
        const pal = doc().querySelector(".vg-palette:not([hidden])");
        if (pal && mode === "write") { const it = pal.querySelector(".vg-pitem"); if (it) { it.click(); await sleep(160); continue; } }
        break;
      }
      if (mode === "write") await sleep(250);
      const made = calls.slice(nCalls).map(c => c[0]);
      const act = el.dataset.act || menuAct;
      if (mode === "write" && act && made.length) (out.wiredAct[act] = [...new Set([...(out.wiredAct[act] || []), ...made])]);
      if (errs.length) out.errors.push({ mode, ctx: ctx.name, control: label, error: errs.slice(0, 2).join(" / ") });
      if (mode === "write" && made.length) (out.wired[sig.split("#").slice(2, 4).join(" ") + " · " + label] = [...new Set(made)]);
      if (!made.length && state() === before && !errs.length) out.noEffect.push({ mode, ctx: ctx.name, control: label });
    }
    const frame = [0, 1, 2].map(() => D().drawNow() || 0).reduce((a, b) => Math.max(a, b), 0);   // slowest of three frames, real time
    if (mode === "read" && frame > FRAME_BUDGET) out.slow.push({ ctx: ctx.name, ms: +frame.toFixed(1) });
    console.log("CA " + JSON.stringify({ mode, ctx: ctx.name, kinds: kinds.length, s: +((performance.now() - t0) / 1000).toFixed(1), frame: +frame.toFixed(1), errors: out.errors.length }));
  }
}

// stand-ins that record every write instead of making it (the plugin's viewActions, one per action)
const calls = [], rec = (name, ret) => async (...a) => { calls.push([name, a]); return typeof ret === "function" ? ret(...a) : ret; };
const standIns = () => ({
  openNote: rec("openNote"), linkNotes: rec("linkNotes"), linkMentions: rec("linkMentions", ["01-Daily/x.md"]), writeNote: rec("writeNote"),
  appendSection: rec("appendSection"), moveNote: rec("moveNote", "05-Archive/x.md"), readTasks: async id => [{ line: 3, text: "a test task" }, { line: 5, text: "another" }],
  toggleTask: rec("toggleTask"), setTaskStatus: rec("setTaskStatus"), setNoteTasks: rec("setNoteTasks", 2), stampReviewed: rec("stampReviewed"),
  dismissPair: rec("dismissPair"), linkText: id => "[[" + String(id).split("/").pop().replace(/\.md$/, "") + "]]", addToMap: rec("addToMap"),
  addReference: rec("addReference"), outlinksOf: () => [], saveBinary: rec("saveBinary"),
});
if (window.__VG_PHONE__) await window.__VG_PHONE__(standIns());   // Obsidian on the phone: its graph, remounted with them
else {
  await sleep(1500);
  doc().querySelectorAll(".vg-tour").forEach(x => x.remove());
  await pass("read", []);
  // ---- the write pass: the same page, remounted with the stand-ins
  H().destroy();
  window.vaultGraph = mountVaultGraph(document.getElementById("vg"), window.__VG_DATA__, { mobile: window.__VG_MOBILE__, ...standIns(),
    sharedStore: { load: async () => null, save: async () => {} }, store: { load: () => ({ v: 1, toured: true }), save: () => {} } });   // toured: the tour would cover the controls
}
await sleep(1500);
doc().querySelectorAll(".vg-tour").forEach(x => x.remove());
await pass("write", calls);
// every shared note action must reach its write action (vault_graph_actions.js)
const EXPECT = { archive: "moveNote", complete: "setNoteTasks", cancel: "setNoteTasks", current: "stampReviewed", link: "linkNotes", map: "addToMap", reference: "addReference", mentions: "linkMentions", open: "openNote" };
for (const [act, fn] of Object.entries(EXPECT)) {
  const got = out.wiredAct[act];
  if (!got) out.unwired.push(act + " (never clicked in the write pass)");
  else if (!got.includes(fn)) out.unwired.push(act + " → expected " + fn + ", got " + got.join("+"));
}
if (live()) window.__clickall = out;
})().catch(e => { if (window.__VG_RUN__ === run) window.__clickall = { fatal: String(e && e.stack || e) }; }))(window.__VG_RUN__ = Math.random());   // a probe that breaks says so
</script>`;
// the page keeps DATA in a const; expose it for the remount
const html = (MOBILE ? page.replace("window.vaultGraph = mountVaultGraph(document.getElementById(\"vg\"), DATA, {", "window.vaultGraph = mountVaultGraph(document.getElementById(\"vg\"), DATA, { mobile: true,") : page)
  .replace("const DATA = ", "const DATA = window.__VG_DATA__ = ")
  .replace("<script>", "<script>window.__VG_MOBILE__ = " + MOBILE + ";").replace("</body>", probe + "</body>");
// Obsidian on the phone: its graph remounted with the probe's stand-ins (plugin.viewActions), nothing saved
// (settings, missions, the MOC report), and all of it put back by __VG_PHONE_RESTORE__
const PHONE_SETUP = `(() => {
  const plugin = app.plugins.plugins["jk-vault-graph"], NO = ["viewActions", "saveSettings", "saveShared", "tickMocRow", "applyMocReport"];
  const view0 = structuredClone(plugin.settings.view || null); let leaf = null;
  Object.defineProperty(window, "vaultGraph", { configurable: true, get: () => leaf && leaf.view.handle });
  window.__VG_PHONE__ = async stand => {
    leaf = app.workspace.getLeavesOfType("vault-graph")[0] || await plugin.open(); app.workspace.revealLeaf(leaf);
    plugin.viewActions = () => stand; NO.slice(1).forEach(k => { plugin[k] = async () => {}; });
    window.__VG_DATA__ = await plugin.graphData(); await leaf.view.render();
    window.__VG_SCOPE__ = leaf.view.contentEl;
  };
  // close the test's graph while the stand-ins are still in place: closing saves its state, and that save must go to
  // the stand-ins, not the vault (review position, missions, XP the test clicked). Then the real actions, then a fresh graph.
  window.__VG_PHONE_RESTORE__ = async () => { if (leaf) leaf.view.unmount();
    NO.forEach(k => delete plugin[k]); plugin.settings.view = view0;
    delete window.vaultGraph; delete window.__VG_SCOPE__; if (leaf) await leaf.view.render(); return "restored"; };
})()`;
// the page, in real time: headless Chrome here, or Obsidian on the phone (tests/cdp.js). The probe's progress lines
// stream back as it goes, so a stuck page is visible.
const cdp = require("./cdp");
const t0 = Date.now(), LIMIT = 40 * 60 * 1000;
let tab = null, restore = null, finished = false;   // the phone run puts the real actions back before it exits
const done = async code => { finished = true; if (restore) console.log("  phone: " + await restore().catch(e => "restore failed: " + e.message));
  if (tab) tab.close(); process.exit(code); };
const progress = a => { if (typeof a !== "string" || !a.startsWith("CA ")) return; const x = JSON.parse(a.slice(3));
  console.log(`  ${x.mode.padEnd(5)} ${x.ctx.padEnd(46)} ${String(x.kinds).padStart(3)} controls ${String(x.s).padStart(5)} s ${String(x.frame).padStart(5)} ms/frame${x.errors ? `  (${x.errors} errors so far)` : ""}`); };
(async () => {
  try {
    tab = await cdp.open({ html: PHONE ? null : html, port: PHONE ? 9335 : 9334,   /* the phone has its own port: a desktop run can go at the same time */ mobile: MOBILE, phone: PHONE, fresh: PHONE && !RESUME, onConsole: progress,
      onClose: () => { if (!finished) { console.log("FAIL - the debug connection closed" + (PHONE ? ". The probe keeps running in Obsidian on the phone: reconnect (USB debugging, Auto Blocker off) and run --phone --resume to collect its result and put the real actions back." : "")); process.exit(1); } } });
  } catch (e) { console.log("FAIL - " + e.message); process.exit(1); }
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  if (PHONE) {   // the probe runs in Obsidian's page (no navigation): the setup, then the probe's script itself
    restore = () => tab.ev("window.__VG_PHONE_RESTORE__ ? window.__VG_PHONE_RESTORE__() : 'nothing to restore'");
    if (RESUME) { if (!await tab.ev("!!window.__VG_PHONE_RESTORE__")) { console.log("FAIL - no phone run to resume (Obsidian restarted?)"); restore = null; await done(1); } }   // the probe already in the page
    else { await tab.ev("window.__clickall = null"); await tab.ev(PHONE_SETUP); tab.send("Runtime.evaluate", { expression: probe.replace(/^<script>|<\/script>$/g, "") }); }
  }
  const res = await tab.waitFor("window.__clickall ? JSON.stringify(window.__clickall) : null", LIMIT);
  if (!res) { console.log("FAIL - no result within 40 minutes"); await done(1); }
  const r = JSON.parse(res);
  if (r.fatal) { console.log("FAIL - the probe stopped: " + r.fatal.split("\n").slice(0, 3).join(" | ")); await done(1); }
  report(r);
})();
function report(r) {
const secs = Math.round((Date.now() - t0) / 1000);
console.log(`${r.clicks} clicks in ${r.contexts} contexts (${secs} s)`);
const list = (title, xs, f, cap) => { if (!xs.length) return; console.log(`${title} (${xs.length}):`); xs.slice(0, cap).forEach(x => console.log("  " + f(x))); if (xs.length > cap) console.log(`  …and ${xs.length - cap} more`); };
list("FAIL errors", r.errors, x => `[${x.mode}] ${x.ctx} › ${x.control}: ${x.error}`, 40);
list("FAIL covered (something is drawn over the control)", r.covered, x => `[${x.mode}] ${x.ctx} › ${x.control} (under ${x.by})`, 40);
{ const by = [...new Set((r.notices || []).map(x => x.by))]; if (by.length) console.log(`note: ${(r.notices || []).length} controls were under an Obsidian notice (dismiss it on the phone): ${by.map(b => `"${b}"`).join(", ")}`); }
list("FAIL write buttons not wired", r.unwired, x => x, 20);
list("FAIL slow frames (over 60 ms)", r.slow, x => `${x.ctx}: ${x.ms} ms`, 20);
list("note: clicks that changed nothing", r.noEffect, x => `[${x.mode}] ${x.ctx} › ${x.control}`, VERBOSE ? 500 : 15);
if (VERBOSE) list("write buttons → actions", Object.entries(r.wired), ([k, v]) => `${k} → ${v.join(", ")}`, 500);
done(r.errors.length || r.covered.length || r.unwired.length || r.slow.length ? 1 : 0);
}
