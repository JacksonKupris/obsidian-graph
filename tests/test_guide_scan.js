#!/usr/bin/env node
// Guide scan (the CRISPR view, read-only): the plugin reads every note outside the folders it skips and VGScience.guideSurvey
// counts the sites; the view shows exact matches and look-alikes apart, says so when nothing matches or the scan fails,
// keeps its result when shut and reopened, and runs a preset from the rules file. The matcher's own sums are in test_science.js.
//   node tests/test_guide_scan.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, openPage } = require("./kit");
const assert = require("assert"), env = require("./env"), stub = require("./plugin_stub");
const S = new Function(`${require("../build").scienceSource()}; return VGScience;`)();

// ---- the survey: totals over several notes, excerpts, and the order
{ const s = S.guideSurvey({ seq: "tech/python", mismatches: 1 });
  s.add("b.md", "one tech/python"); s.add("a.md", "tech/python and tech/python\n`tech/python`"); s.add("c.md", "nothing here"); s.add("d.md", "only teck/python");
  const r = s.done();
  assert.deepStrictEqual([r.scanned, r.hits, r.near, r.skipped.where, r.allowed], [4, 3, 1, 1, 1], "the survey's totals");
  assert.deepStrictEqual(r.notes.map(n => [n.path, n.hitsCount, n.nearCount]), [["a.md", 2, 0], ["b.md", 1, 0], ["d.md", 0, 1]], "notes with a site, most first; a note with none isn't listed");
  const long = "x".repeat(100) + " tech/python " + "y".repeat(100), e = S.guideExcerpt(S.guideScan(long, { seq: "tech/python" }).hits[0]);
  assert.ok(e.pre.startsWith("…") && e.post.endsWith("…") && e.pre.length < 50 && e.found === "tech/python", "a long line is cut around the site");
  assert.strictEqual(S.guideSurvey({ seq: "tech/python", mismatches: 9 }).done().allowed, 2, "the survey reports the mismatches the guide's length allows"); }

// ---- both places the view is opened hand it the plugin's scan
{ const plugin = require("../build").pluginSource();
  assert.strictEqual((plugin.match(/guideScan: guide => this(\.plugin)?\.guideScan\(guide\)/g) || []).length, 2, "the graph and HQ don't both pass guideScan"); }

(async () => {
  const { fails, ok: check } = checks(), D = "window.vaultGraph._debug";
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

  const tab = await openPage({ html: env.pageWith(`guideScan: async g => { if (window.__guideBoom) throw new Error("boom"); window.__guideAsked = g; const s = VGScience.guideSurvey(g); for (const [p, t] of window.__guideNotes) s.add(p, t); return s.done(); },`) });
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
    await tab.ev(`${D}.closeLens()`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  if (fails.length) { console.error(fails.map(f => `  - ${f}`).join("\n")); process.exit(1); }
  console.log("ok - guide scan: the plugin reads the vault, exact and look-alike apart, the neighbour rule, empty and failed scans, presets from the rules");
})();
