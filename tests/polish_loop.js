#!/usr/bin/env node
// The polish loop: one pass of everything that checks how the graph feels to use, written up as a checklist note in the
// report. Run it, fix what it lists, run it again; each report says what's new and what got fixed since the last.
//   node tests/polish_loop.js [--full] [--vault [dir]]      report: .out/polish/ (with --vault, the vault's reports folder)
// Each pass:
//   1. the smoke test (every view and lens draws, no dead ends, search sane)
//   2. screenshots of every view, lens and panel at desktop and phone size (shots.js)
//   3. a layout audit of the same screens at both sizes, for what a person notices and a test of the logic doesn't:
//      text cut off mid-word, the page scrolling sideways, and (phone) buttons too small to tap
//   4. --full: the click-everything test at both sizes (about 10 minutes)
// The audit's findings are kept in .out/polish/last.json, so the next report can compare.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process"), cdp = require("./cdp");
const env = require("./env"), FULL = process.argv.includes("--full");
const day = new Date().toISOString().slice(0, 10), stamp = day + " " + new Date().toTimeString().slice(0, 5).replace(":", "");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (script, args = []) => {   // a test script's last line, and whether it passed
  try { const out = execFileSync("node", [path.join(__dirname, script), ...args, ...env.args], { encoding: "utf8", timeout: 20 * 60 * 1000 }); return { ok: true, out: out.trim() }; }
  catch (e) { return { ok: false, out: String(e.stdout || e.message).trim() }; }
};

// ---- the audit, inside the page: one record per problem, keyed so the same problem matches across runs
const AUDIT = String.raw`(mobile => {
  // checkVisibility: content in a closed <details> still reports a box, though nothing is drawn there
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest("[hidden]") && getComputedStyle(e).visibility !== "hidden" && (!e.checkVisibility || e.checkVisibility()); };
  const name = e => (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).filter(c => c.startsWith("vg-")).slice(0, 2).join(".") : e.tagName.toLowerCase()) || e.tagName.toLowerCase();
  const out = [];
  // text cut off: an element holding text whose words run past its box, without an ellipsis to say so
  for (const e of document.querySelectorAll(".vg-root *")) {
    if (!vis(e) || e.closest("svg, canvas, pre, .vg-mx-wrap")) continue;
    const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2); if (!own) continue;
    const cs = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 2 && cs.textOverflow !== "ellipsis" && cs.overflowX !== "auto" && cs.overflowX !== "scroll" && e.clientWidth > 0)
      out.push({ kind: "clipped", what: name(e), text: e.textContent.trim().slice(0, 40) });
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: "sideways", what: "page", text: (document.documentElement.scrollWidth - innerWidth) + " px wider than the screen" });
  // the smallest a control may be on a phone: the stylesheet's --vg-tap (Apple and Google ask for 44-48; small row buttons sit lower)
  const tap = parseFloat(getComputedStyle(document.querySelector(".vg-root")).getPropertyValue("--vg-tap")) || 32;
  if (mobile) for (const b of document.querySelectorAll(".vg-root button, .vg-root [role=option], .vg-root a")) {
    if (!vis(b) || b.closest("[data-chart]")) continue;   // a chart's segments are as wide as their share; the row has its own control
    const r = b.getBoundingClientRect();
    if (Math.min(r.width, r.height) < tap - 0.5) out.push({ kind: "small", what: name(b), text: (b.getAttribute("aria-label") || b.title || b.textContent.trim()).slice(0, 30) + " · " + Math.round(r.width) + "×" + Math.round(r.height) });
  }
  return JSON.stringify(out);
})`;

async function audit(mobile) {
  const page = env.page();
  const html = mobile ? page.replace("window.vaultGraph = mountVaultGraph(document.getElementById(\"vg\"), DATA, {", "window.vaultGraph = mountVaultGraph(document.getElementById(\"vg\"), DATA, { mobile: true,") : page;
  const tab = await cdp.open({ html, port: 9337, mobile });
  if (!tab) return null;
  await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await sleep(1500);
  const D = "window.vaultGraph._debug", found = new Map();
  const take = async where => { await tab.ev("document.querySelectorAll('.vg-tour').forEach(x => x.remove())");
    for (const f of JSON.parse(await tab.ev(`${AUDIT}(${mobile})`))) { const key = `${f.kind}|${f.what}|${f.text}`; if (!found.has(key)) found.set(key, { ...f, where, size: mobile ? "phone" : "desktop" }); } };
  for (const v of await tab.ev(`${D}.views()`)) { await tab.ev(`${D}.setView(${JSON.stringify(v)})`); await sleep(500); await take("view " + v); }
  await tab.ev(`${D}.setView("2d")`); await sleep(800);
  for (const k of await tab.ev(`${D}.lenses()`)) { await tab.ev(`${D}.openLens(${JSON.stringify(k)})`); await sleep(400); await take("lens " + k); }
  await tab.ev("(() => { const c = document.querySelector('.vg-lens:not([hidden]) .vg-lens-close'); if (c) c.click(); })()");
  for (const t of ["views", "lenses", "style", "health"]) {
    await tab.ev(`(() => { const p = document.querySelector('.vg-picker'); if (p.hidden) document.querySelector('.vg-pickbtn').click(); const b = document.querySelector('.vg-picker-tab[data-tab="${t}"]'); if (b) b.click(); })()`);
    await sleep(300); await take("picker " + t); }
  await tab.ev("(() => { const x = document.querySelector('.vg-picker-x'); if (x) x.click(); })()");
  await tab.ev(`(() => { const n = ${D}.nodes.filter(n => !n.ghost && !n.person && !n.moc).sort((a, b) => (b.tasks || 0) - (a.tasks || 0))[0]; window.vaultGraph.focusNote(n.id); })()`);
  await sleep(1000); await take("inspector");
  tab.close();
  return [...found.values()];
}

(async () => {
  const t0 = Date.now(), log = s => console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${s}`);
  const steps = [];
  log("smoke test"); steps.push(["Smoke test (views, lenses, search, no dead ends)", run("smoke_page.js")]);
  log("screenshots"); const shots = [run("shots.js"), run("shots.js", ["--mobile"])];
  steps.push(["Screenshots, desktop and phone", { ok: shots.every(x => x.ok), out: shots.map(x => x.out.split("\n").pop()).join("; ") }]);
  if (FULL) { log("click everything, desktop"); steps.push(["Click everything, desktop", run("click_all.js")]);
    log("click everything, phone size"); steps.push(["Click everything, phone size", run("click_all.js", ["--mobile"])]); }
  // one finding per component and screen size, with examples: one style fixes them all
  log("layout audit"); const raw = [...(await audit(false) || []), ...(await audit(true) || [])], groups = new Map();
  for (const f of raw) { const k = `${f.size}|${f.kind}|${f.what}`; if (!groups.has(k)) groups.set(k, { size: f.size, kind: f.kind, what: f.what, n: 0, where: [], text: [] });
    const g = groups.get(k); g.n++; if (!g.where.includes(f.where)) g.where.push(f.where); if (g.text.length < 3) g.text.push(f.text); }
  const found = [...groups.values()].sort((a, b) => b.n - a.n);

  // compare with the last pass
  const dir = env.out("polish"), lastP = path.join(dir, "last.json"); fs.mkdirSync(dir, { recursive: true });
  const key = f => `${f.size}|${f.kind}|${f.what}`;
  let last = null; try { last = JSON.parse(fs.readFileSync(lastP, "utf8")); } catch (e) {}
  const before = new Set((last ? last.found : []).map(key)), now = new Set(found.map(key));
  const fresh = last ? found.filter(f => !before.has(key(f))) : [], fixed = last ? last.found.filter(f => !now.has(key(f))) : [];
  fs.writeFileSync(lastP, JSON.stringify({ when: stamp, found }, null, 1));

  // the checklist note
  const KIND = { clipped: "Text cut off", sideways: "Page scrolls sideways", small: "Too small to tap on a phone (under --vg-tap)" };
  const clean = t => t.replace(/[|[\]`]/g, " ");
  const row = f => `- [ ] \`${f.what}\`${f.size === "phone" && f.kind !== "small" ? " (phone)" : ""}: ${f.n} on ${f.where.slice(0, 4).join(", ")}${f.where.length > 4 ? ` +${f.where.length - 4} more` : ""}. E.g. ${f.text.map(t => `“${clean(t)}”`).join(", ")}`;
  const shotDir = path.relative(env.ROOT, env.out("shots", day)).replace(/\\/g, "/");
  let md = `---\ncreated: ${day}\ntype: report\ntags:\n  - type/report\n---\n\n# Polish loop ${stamp}\n\n`;
  // each step's whole output is kept beside last.json; the note shows its summary lines (the unindented ones)
  steps.forEach(([t, r], i) => fs.writeFileSync(path.join(dir, `step-${i + 1}.txt`), `${t}\n\n${r.out}\n`));
  md += `## Checks\n\n${steps.map(([t, r], i) => `- ${r.ok ? "Passed" : "**Failed**"}: ${t} (full output: \`.out/polish/step-${i + 1}.txt\`)\n`
    + r.out.split(/\r?\n/).filter(l => l.trim() && !/^\s/.test(l)).slice(0, 12).map(l => `    - ${l.trim().replace(/[|[\]`]/g, " ")}`).join("\n")).join("\n")}\n`;
  md += `- Screenshots: \`${shotDir}\` and \`${shotDir}-mobile\`.\n\n`;
  md += `## Layout audit\n\n${found.length} findings (${raw.length} elements)${last ? ` · ${fresh.length} new and ${fixed.length} fixed since ${last.when}` : ""}.\n\n`;
  for (const k of Object.keys(KIND)) { const fs_ = found.filter(f => f.kind === k); if (!fs_.length) continue;
    md += `### ${KIND[k]} (${fs_.length})\n\n${fs_.slice(0, 60).map(row).join("\n")}${fs_.length > 60 ? `\n- …and ${fs_.length - 60} more (in \`.out/polish/last.json\`)` : ""}\n\n`; }
  if (fixed.length) md += `## Fixed since the last pass\n\n${fixed.slice(0, 40).map(f => `- \`${f.what}\` (${f.size}): ${KIND[f.kind] || f.kind}`).join("\n")}\n\n`;
  md += `## Look at by eye\n\nThings no check sees. Go through the screenshots with these in mind:\n\n` + [
    "Would someone new know what this screen is for, and what to do next?",
    "Labels on the map: overlapping, cut off, or unreadable on the background?",
    "Does every empty or finished state point somewhere?",
    "Same thing, same name and icon, everywhere?",
    "Phone: can each control be reached with a thumb without covering what it changes?",
  ].map(x => `- [ ] ${x}`).join("\n") + "\n";
  const out = env.VAULT ? path.join(env.VAULT, env.rules.folders.reports, `Polish Loop ${stamp}.md`) : path.join(dir, `Polish Loop ${stamp}.md`);
  fs.writeFileSync(out, md);
  console.log(`${steps.every(([, r]) => r.ok) ? "ok" : "FAIL"} - ${found.length} layout findings${last ? ` (${fresh.length} new, ${fixed.length} fixed)` : ""} · ${path.relative(env.VAULT || env.ROOT, out)}`);
  process.exit(steps.every(([, r]) => r.ok) ? 0 : 1);
})().catch(e => { console.log("FAIL - " + e.message); process.exit(1); });
