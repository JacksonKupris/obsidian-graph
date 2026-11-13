#!/usr/bin/env node
// Guide scan (the CRISPR view, read-only): the plugin reads every note outside the folders it skips and VGScience.guideSurvey
// counts the sites; the view shows exact matches and look-alikes apart, says so when nothing matches or the scan fails,
// keeps its result when shut and reopened, and runs a preset from the rules file. The matcher's own sums are in test_science.js.
//   node tests/test_guide_scan.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, openPage } = require("./kit");
const assert = require("assert"), env = require("./env"), stub = require("./plugin_stub");
const S = new Function(`${require("../build").scienceSource()}; return VGScience;`)();

// ---- a rules-file guide with a replacement is also a suggestion for the open note (the suggestions sidebar), through the same guide and the same repair
{ const preset = { name: "Retired tag tech/", seq: "tech/", to: "technology/" }, g = S.guideOfPreset(preset);
  assert.deepStrictEqual([g.seq, g.mismatches, g.word, g.where.join()], ["tech/", 0, true, S.GUIDE_DEFAULT.join()], "a preset becomes the guide the scan reads, with the defaults filled in");
  const cuts = S.guideCuts("tags:\n  - tech/python\ntext tech/x\n", g, { to: preset.to }); assert.ok(cuts.length >= 1 && cuts.every(c => c.after.includes("technology/")), "the guide's repair is what the sidebar offers");
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "plugin", "10-views.js"), "utf8");
  assert.ok(/VGScience\.guideOfPreset\(/.test(src) && /plugin\.guideApply\(/.test(src) && /scope = \{ path: file\.path \}/.test(src), "the sidebar suggests the repair through the shared guide and the one guideApply, scoped to the open note"); }
// ---- the survey: totals over several notes, excerpts, and the order
{ const s = S.guideSurvey({ seq: "tech/python", mismatches: 1 });
  s.add("b.md", "one tech/python"); s.add("a.md", "tech/python and tech/python\n`tech/python`"); s.add("c.md", "nothing here"); s.add("d.md", "only teck/python");
  const r = s.done();
  assert.deepStrictEqual([r.scanned, r.hits, r.near, r.skipped.where, r.allowed], [4, 3, 1, 1, 1], "the survey's totals");
  assert.deepStrictEqual(r.notes.map(n => [n.path, n.hitsCount, n.nearCount]), [["a.md", 2, 0], ["b.md", 1, 0], ["d.md", 0, 1]], "notes with a site, most first; a note with none isn't listed");
  const long = "x".repeat(100) + " tech/python " + "y".repeat(100), e = S.guideExcerpt(S.guideScan(long, { seq: "tech/python" }).hits[0]);
  assert.ok(e.pre.startsWith("…") && e.post.endsWith("…") && e.pre.length < 50 && e.found === "tech/python", "a long line is cut around the site");
  assert.strictEqual(S.guideSurvey({ seq: "tech/python", mismatches: 9 }).done().allowed, 2, "the survey reports the mismatches the guide's length allows"); }

// ---- both places the view is opened hand it the plugin's readers; only the graph view is handed the write, and it is a write action
{ const plugin = require("../build").pluginSource();
  assert.strictEqual((plugin.match(/\.\.\.this(\.plugin)?\.guideReaders\(\)/g) || []).length, 2, "the graph and the self-test don't both pass the guide readers");
  assert.strictEqual((plugin.match(/guideApply: run => this\.plugin\.guideApply\(run\)/g) || []).length, 1, "the write is handed to exactly one view");
  assert.ok(/WRITE_ACTIONS = \[[^\]]*"guideApply"/.test(plugin), "guideApply isn't a write action: no undo, no redraw");
  assert.ok(!/guideApply/.test(plugin.slice(plugin.indexOf("guideReaders() {"), plugin.indexOf("guideReaders() {") + 400)), "the readers hand out the write"); }

// ---- the repair on a vault it may write: the preview is what gets written, and nothing else is
async function repairOnDisk(check) {
  const fs = require("fs"), os = require("os"), path = require("path"), R = env.rules, TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vg-guide-"));
  const P = rel => path.join(TMP, rel), read = rel => fs.readFileSync(P(rel), "utf8"), put = (rel, t) => { fs.mkdirSync(path.dirname(P(rel)), { recursive: true }); fs.writeFileSync(P(rel), t); };
  const A = "---\ntags:\n  - tech/python\n  - project/x\n---\nUse tech/python here.\nAnd tech/python again.\n`tech/python` stays\nteck/python is a look-alike\n", B = "- [ ] retag tech/python\n", C = "tech/python outside the folder\n";
  put("Work/a.md", A); put("Work/b.md", B); put("Other/c.md", C);
  const { Plugin, TFile } = stub.load(R), app = stub.liveVault(TMP, TFile);
  app.fileManager.trashFile = async f => { fs.mkdirSync(P(".trash"), { recursive: true }); fs.renameSync(P(f.path), P(`.trash/${path.basename(f.path)}`)); app.flush(); };
  app.loadLocalStorage = () => "desktop-test"; app.saveLocalStorage = () => {};
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { sharedPath: "shared.json", dismissedPath: "_none.json" } });
  p.indexSettled = async () => {}; p.publish = async () => {}; p.saveSettings = async () => {}; p.wrapWriteActions(); await sleep(20);
  const guide = { seq: "tech/python", mismatches: 0, word: true, where: ["frontmatter", "task", "body"] }, repair = { to: "technology/python" }, scope = { folder: "Work" };
  const pre = await p.guidePreview(guide, repair, scope);
  check(pre.scanned === 2 && pre.cuts === 4 && pre.notes.map(n => `${n.path}:${n.cuts.length}`).join() === "Work/a.md:3,Work/b.md:1", `the preview: ${JSON.stringify(pre.notes.map(n => [n.path, n.cuts.length]))} of ${pre.scanned}`);
  check(read("Work/a.md") === A && read("Work/b.md") === B && !fs.existsSync(P(".trash")), "a preview wrote something");
  check((await p.guidePreview(guide, repair, { tag: "project" })).notes.map(n => n.path).join() === "Work/a.md", "a tag scope isn't the notes carrying it or a tag under it");
  const refused = async run => { try { await p.guideApply(run); return ""; } catch (e) { return e.message; } };
  check(/folder or a tag/.test(await refused({ guide, repair, scope: {}, notes: pre.notes })), "a repair with no folder or tag was written");
  check(/none of the ticked/.test(await refused({ guide, repair, scope, notes: [{ path: "Other/c.md", cuts: S.guideCuts(C, guide, repair) }] })) && read("Other/c.md") === C, "a note outside the scope was written");
  // a line edited after the preview is left as it is; the rest is written
  const A2 = A.replace("And tech/python again.", "And tech/python again, edited since."); put("Work/a.md", A2); app.flush();
  const run = await p.guideApply({ guide, repair, scope, notes: pre.notes }); app.flush();
  check(run.cuts === 3 && run.left === 1 && run.notes === 2, `the run's counts: ${JSON.stringify([run.cuts, run.left, run.notes])}`);
  const a = read("Work/a.md");
  check(a === A2.replace("  - tech/python", "  - technology/python").replace("Use tech/python here.", "Use technology/python here."), `what was written isn't the preview's cuts: ${JSON.stringify(a)}`);
  check(a.includes("`tech/python` stays") && a.includes("teck/python is a look-alike") && a.includes("And tech/python again, edited since."), "code, a look-alike or an edited line was cut");
  check(read("Work/b.md") === "- [ ] retag technology/python\n" && read("Other/c.md") === C, "the task wasn't written, or the note outside was");
  check(run.kept === `.trash/Guide Scan ${run.id}` && read(`${run.kept}/Work/a.md`) === A2 && read(`${run.kept}/Work/b.md`) === B, "the originals weren't kept first");
  const report = run.report && fs.existsSync(P(run.report)) ? read(run.report) : "";
  check(run.report === `${R.folders.reports}/Guide Scan ${run.id}.md` && /Work\/a/.test(report) && /Work\/b/.test(report) && /technology\/python/.test(report) && /Left as it was/.test(report), `the report: ${run.report} ${report.slice(0, 200)}`);
  const log = await p.guideLog(), onDisk = JSON.parse(read("shared.json"));
  check(log.length === 1 && log[0].id === run.id && log[0].cuts === 3 && log[0].report === run.report && log[0].scope.folder === "Work" && onDisk.guideLog.length === 1, `the run isn't in the shared log: ${JSON.stringify(log)}`);
  check((await p.guidePreview(guide, repair, scope)).cuts === 1, "a second preview doesn't show only the line left");
  // undo puts both notes back and takes the report away
  await p.undo(p.lastUndo()); app.flush();
  check(read("Work/a.md") === A2 && read("Work/b.md") === B, "undo didn't put the notes back");
  check(!fs.existsSync(P(run.report)) && (await p.guideLog())[0].report === "", "an undone run still links its report");
  fs.rmSync(TMP, { recursive: true, force: true });
}

(async () => {
  const { fails, ok: check } = checks(), D = "window.vaultGraph._debug";
  try { await repairOnDisk(check); } catch (e) { fails.push(`the repair on disk: ${e.stack}`); }
  // ---- the plugin's scan on the vault under test: every note outside the skipped folders, and none inside them
  { const { Plugin, TFile } = stub.load(env.rules), app = stub.fakeVault(env.dir(), TFile), p = Object.assign(Object.create(Plugin.prototype), { app });
    const F = env.rules.folders, skipped = f => [F.reports, F.archive].some(x => f.path.startsWith(x + "/")) || /^(_|\.)/.test(f.path);
    const all = app.vault.getMarkdownFiles(), read = all.filter(f => !f.path.startsWith(F.reports + "/") && !f.path.startsWith(F.archive + "/"));
    const r = await p.guideScan({ seq: "the", where: ["body", "task"] });
    check(all.length > 0, "the vault under test has no notes"); check(r.scanned > 0 && r.scanned <= read.length, `scanned ${r.scanned} of ${read.length} readable notes`);
    check(r.hits > 0 && r.notes.length > 0, "no note in the vault says “the”: the scan read nothing");
    check(!r.notes.some(n => [F.reports, F.archive].some(x => n.path.startsWith(x + "/"))), "a report or an archived note was scanned");
    if (!all.some(f => [F.reports, F.archive].some(x => f.path.startsWith(x + "/")))) console.log("  note: this vault has no report or archived note, so skipping them is only checked by the scanned count");
    else check(r.scanned < all.length, "the skipped folders were read");
    const one = r.notes[0], text = await app.vault.cachedRead(all.find(f => f.path === one.path));
    check(S.guideScan(text, { seq: "the", where: ["body", "task"] }).hits.length === one.hitsCount, "a note's count isn't its text's count");
    void skipped; }

  const tab = await openPage({ html: env.pageWith(`guideScan: async g => { if (window.__guideBoom) throw new Error("boom"); window.__guideAsked = g; const s = VGScience.guideSurvey(g); for (const [p, t] of window.__guideNotes) s.add(p, t); return s.done(); },
    guidePreview: async (g, r, s) => { window.__guidePrev = { g, r, s }; const notes = window.__guideNotes.map(([p, t]) => ({ path: p, cuts: VGScience.guideCuts(t, g, r) })).filter(n => n.cuts.length); return { notes, scanned: window.__guideNotes.length, cuts: notes.reduce((n, x) => n + x.cuts.length, 0) }; },
    guideApply: async run => { window.__guideRun = run; window.__guideNotes = window.__guideNotes.map(([p, t]) => { const n = run.notes.find(x => x.path === p); return [p, n ? VGScience.guideApply(t, n.cuts).text : t]; });
      const e = { id: "t1", date: "2026-11-09", guide: run.guide, to: run.repair.to, scope: run.scope, notes: run.notes.length, cuts: run.notes.reduce((n, x) => n + x.cuts.length, 0), left: 0, report: window.__guideReport }; window.__guideLogged = [e]; return e; },
    guideLog: async () => window.__guideLogged || [],`) });
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await sleep(800);
    const body = () => tab.ev(`document.querySelector(".vg-lens-body").textContent.replace(/\\s+/g, " ")`);
    const scan = async (seq, more = "") => { await tab.ev(`(() => { const f = document.querySelector(".vg-guide"); f.querySelector('[data-guide="seq"]').value = ${JSON.stringify(seq)}; ${more} f.requestSubmit(); })()`); await sleep(400); return body(); };
    const anId = await tab.ev(`DATA.nodes.find(n => !n.person && !n.ghost && !n.moc).id`);
    await tab.ev(`void (window.__guideNotes = [[${JSON.stringify(anId)}, "tags tech/python here"], ["not/in/the/graph.md", "- [ ] retag tech/python and teck/python"], ["x.md", "nothing"]])`);
    check((await tab.ev(`${D}.lenses()`)).includes("guide"), "Guide scan isn't in the view list");
    await tab.ev(`${D}.openLens("guide")`); await sleep(300);
    let t = await body(); check(/writes nothing/.test(t) && await tab.ev(`!!document.querySelector(".vg-guide [data-guide='seq']")`), `Guide scan opened without its form: ${t.slice(0, 160)}`);
    // exact matches and look-alikes, apart; a note the graph doesn't hold still gets a row
    t = await scan("tech/python", `f.querySelector('[data-guide="mismatches"]').value = "1";`);
    check(/2 exact in 2 notes of 3, 1 look-alike/.test(t), `the counts: ${t.slice(0, 400)}`); check(/Exact matches/.test(t) && /Look-alikes/.test(t) && /1 letter different/.test(t), "look-alikes aren't listed apart");
    check(/graph(\.md)?/.test(t) && /Tasks · line 1/.test(t), "the note outside the graph, or where its site is, isn't shown"); check(!/NaN|undefined/.test(t), "a broken value on the page");
    check((await tab.ev(`JSON.stringify(window.__guideAsked)`)) === JSON.stringify({ seq: "tech/python", after: "", mismatches: 1, word: true, where: ["frontmatter", "task", "body"] }), "the host wasn't asked for the guide on the form");
    check((await tab.ev(`document.querySelectorAll(".vg-lens-body [data-twopen], .vg-lens-body [data-id]").length`)) >= 2, "rows open nothing");
    // shut and reopened: the same result, not a blank form
    await tab.ev(`${D}.closeLens()`); await tab.ev(`${D}.openLens("guide")`); await sleep(300); check(/2 exact in 2 notes/.test(await body()), "reopening lost the result");
    // only when followed by: the site without it is counted as left out
    t = await scan("tech/python", `f.querySelector('[data-guide="after"]').value = " here"; f.querySelector('[data-guide="mismatches"]').value = "0";`);
    check(/1 exact in 1 note of 3/.test(t) && /1 without “ here” after/.test(t), `the neighbour rule: ${t.slice(0, 300)}`);
    // nothing found, nothing typed, and a scan that fails each say so
    t = await scan("zzzqqq", `f.querySelector('[data-guide="after"]').value = "";`); check(/No “zzzqqq” in 3 notes/.test(t), `the empty state: ${t.slice(0, 200)}`);
    t = await scan("   "); check(/Type a guide first/.test(t), "an empty guide ran");
    await tab.ev(`void (window.__guideBoom = 1)`); t = await scan("tech/python"); check(/The scan stopped: boom/.test(t), `a failing scan: ${t.slice(0, 200)}`); await tab.ev(`void (window.__guideBoom = 0)`);
    // a preset from the rules file fills the form and runs
    await tab.ev(`void (VGRules.RULES.guides = [{ name: "Old Python tag", seq: "tech/python", where: ["task"], why: "retired" }, { name: "no text" }])`);
    await tab.ev(`${D}.closeLens()`); await tab.ev(`${D}.openLens("guide")`); await sleep(300);
    check((await tab.ev(`[...document.querySelectorAll("[data-guide-preset]")].map(b => b.textContent).join()`)) === "Old Python tag", "the rules file's guides aren't the presets (one without text is left out)");
    await tab.ev(`document.querySelector("[data-guide-preset]").click()`); await sleep(400); t = await body();
    check(/1 exact in 1 note of 3/.test(t) && /1 in places this guide doesn't look/.test(t), `the preset's scan: ${t.slice(0, 300)}`);
    // ---- the repair: no preview without a folder or tag; nothing ticked to start; only ticked notes are written
    const everywhere = `f.querySelectorAll("[data-guide-where]").forEach(c => { c.checked = c.dataset.guideWhere !== "code"; });`, has = sel => tab.ev(`!!document.querySelector(${JSON.stringify(".vg-lens-body " + sel)})`);
    const click = async sel => { await tab.ev(`document.querySelector(${JSON.stringify(".vg-lens-body " + sel)}).click()`); await sleep(400); return body(); };
    await tab.ev(`void (window.__guideReport = ${JSON.stringify(anId)})`);
    t = await scan("tech/python", everywhere); check(/2 exact in 2 notes/.test(t) && /inside one folder or tag/.test(t) && !await has("[data-guide-preview]"), `a repair was offered with no folder or tag: ${t.slice(0, 300)}`);
    t = await scan("tech/python", `f.querySelector('[data-guide="folder"]').value = "not/"; f.querySelector('[data-guide="to"]').value = "technology/python";`);
    check(await has("[data-guide-preview]") && /Preview the repair: replace with “technology\/python”/.test(t) && /in not:/.test(t), `the repair isn't offered inside a folder: ${t.slice(0, 300)}`);
    check((await tab.ev(`JSON.stringify(window.__guideAsked)`)).includes("tech/python"), "the scan lost its guide");
    t = await click("[data-guide-preview]");
    check((await tab.ev(`JSON.stringify([window.__guidePrev.g.mismatches, window.__guidePrev.r.to, window.__guidePrev.s.folder])`)) === `[0,"technology/python","not"]`, "the preview wasn't asked for exact sites, the replacement and the folder");
    check(/Cuts/.test(t) && /Nothing ticked/.test(t) && (await tab.ev(`[...document.querySelectorAll("[data-guide-tick]")].map(c => +c.checked).join()`)) === "0,0" && await tab.ev(`document.querySelector("[data-guide-apply]").disabled`), `the preview doesn't start with nothing ticked: ${t.slice(0, 300)}`);
    check((await tab.ev(`[...document.querySelectorAll(".vg-guide-cut")].map(x => x.querySelector("del").textContent + " > " + x.querySelector("ins").textContent).join(" | ")`)) === "tags tech/python here > tags technology/python here | - [ ] retag tech/python and teck/python > - [ ] retag technology/python and teck/python", "the preview doesn't show each line as it is and as it would be written");
    await tab.ev(`(() => { const c = document.querySelector("[data-guide-tick]"); c.checked = true; c.onchange(); })()`); await sleep(200); t = await body();
    check(/Write 1 line in 1 note/.test(t), `ticking one note: ${t.slice(0, 300)}`);
    t = await click(`[data-guide-all="0"]`); check(/Nothing ticked/.test(t), "Untick all left a tick");
    await tab.ev(`(() => { const c = [...document.querySelectorAll("[data-guide-tick]")].pop(); c.checked = true; c.onchange(); })()`); await sleep(200);
    const last = await tab.ev(`[...document.querySelectorAll("[data-guide-tick]")].pop().dataset.guideTick`);
    await click("[data-guide-apply]"); await sleep(600); t = await body();
    const ran = JSON.parse(await tab.ev(`JSON.stringify({ notes: window.__guideRun.notes.map(n => n.path), scope: window.__guideRun.scope, to: window.__guideRun.repair.to, texts: window.__guideNotes })`));
    check(ran.notes.join() === last && ran.scope.folder === "not" && ran.to === "technology/python", `the write wasn't the one ticked note: ${JSON.stringify(ran.notes)}`);
    check(ran.texts.filter(([, x]) => /technology\/python/.test(x)).length === 1 && ran.texts.some(([, x]) => /tech\/python/.test(x)), "an unticked note was written");
    check(/1 line written in 1 note/.test(t) && /1 exact in 1 note/.test(t), `after the write the page doesn't say what was written and scan again: ${t.slice(0, 400)}`);
    check(/Past repairs/.test(t) && await has("[data-guide-again]"), "the run isn't under Past repairs");
    check(!/NaN|undefined/.test(t), "a broken value on the page after a repair");
    await tab.ev(`${D}.closeLens()`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  if (fails.length) { console.error(fails.map(f => `  - ${f}`).join("\n")); process.exit(1); }
  console.log("ok - guide scan: the plugin reads the vault, exact and look-alike apart, the neighbour rule, empty and failed scans, presets from the rules");
})();
