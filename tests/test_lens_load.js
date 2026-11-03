#!/usr/bin/env node
// What made the app lag, and what the lenses count as reliance. As a neural net works in a worker and isn't worked out again unless a
// link really changes; the picture slows behind an open lens; generated Related sections don't count as one note relying on another;
// and a journal with an open task stays in HQ whatever its age.
//   node tests/test_lens_load.js [--vault [dir]]        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env"), { VGRules: R } = env.notes();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- written links, through the rule the plugin calls, on the rules file under test
assert.ok(env.rules.generated_link_sections, "the rules file has no generated_link_sections");
assert.ok(new RegExp(env.rules.generated_link_sections, "i").test("Related (added 2026-10-26)"), "a Related section isn't treated as generated");
assert.ok(!new RegExp(env.rules.generated_link_sections, "i").test("Process"), "an ordinary section is treated as generated");
const at = line => ({ start: { line } }), head = (heading, level, line) => ({ heading, level, position: at(line) }), link = (l, line) => ({ link: l, position: at(line) });
{
  const resolved = { "a.md": { "b.md": 1, "c.md": 2, "d.md": 1, "e.md": 1 }, "plain.md": { "b.md": 1 } };
  const cache = { "a.md": { headings: [head("Process", 2, 1), head("Related (added 2026-10-26)", 2, 5), head("Inner", 3, 7), head("After", 2, 9)],
    links: [link("b", 2), link("c", 3), link("c", 6), link("d", 8), link("e", 10)] } };
  const out = R.writtenLinks(resolved, p => cache[p], l => `${l}.md`);
  assert.deepStrictEqual(Object.keys(out["a.md"]).sort(), ["b.md", "c.md", "e.md"], "generated links are off, written ones stay, a section's subheading stays in it, the next section isn't in it");
  assert.strictEqual(out["a.md"]["c.md"], 1, "a link both written and generated stays, once");
  assert.strictEqual(out["plain.md"]["b.md"], 1, "a note with no cache keeps its links");
  assert.strictEqual(resolved["a.md"]["d.md"], 1, "Obsidian's own index was changed");
}

// ---- a journal with an open task stays in HQ whatever its age; one with none only for carry_days
if (env.rules.hq && env.rules.hq.journal) {
  const old = `${env.rules.folders.daily}/2026/01-January/Journal/2026-01-05.md`;
  assert.strictEqual(R.hqKind(old, {}, "2026-11-02", true), "journal", "an old journal with an open task left HQ");
  assert.strictEqual(R.hqKind(old, {}, "2026-11-02", false), null, "an old journal with no open task is read");
  const text = "# Day\n- [ ] Old job\n- [x] Done one\n";
  const hq = R.hqGather([{ path: old, text, fm: {} }], { today: "2026-11-02" });
  assert.strictEqual(hq.journals.length, 1, "hqGather dropped the old journal");
  const items = R.todayList({ nodes: [], links: [], hq }, { today: "2026-11-02" });
  assert.ok(items.some(i => i.kind === "carried" && /Old job/.test(i.title)), "the old open task isn't in HQ's list");
}

// ---- the plugin hands the view the written links, not Obsidian's raw index
{ const dir = path.join(__dirname, "..", "src"), plugin = fs.readFileSync(path.join(dir, "plugin.js"), "utf8"), view = fs.readFileSync(path.join(dir, "view", "62-science.js"), "utf8");
  assert.ok(/writtenLinks: \(\) => this\.plugin\.writtenLinks\(\)/.test(plugin) && /VGRules\.writtenLinks\(mc\.resolvedLinks/.test(plugin), "the plugin doesn't pass written links");
  assert.ok(!/outLinks/.test(plugin + view), "something still reads every link as reliance"); }

(async () => {
  const links = env.data().links.filter(l => l.kind === "link"), out = {}; links.forEach(l => { (out[l.source] = out[l.source] || {})[l.target] = 1; });
  const tab = await cdp.open({ html: env.pageWith(`writtenLinks: () => (window.__written || ${JSON.stringify(out)}),`), port: 9395 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); }, D = "window.vaultGraph._debug";
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    await tab.ev(`void (window.__long = [], new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(e.duration))).observe({ entryTypes: ["longtask"] }))`);
    const finished = () => `(() => { const t = document.querySelector(".vg-lens-body").textContent.trim(); return t && !/^Loading/.test(t) ? 1 : 0; })()`;
    await tab.ev(`${D}.setView("2d")`); await sleep(500); await tab.ev(`window.__long.length = 0`);
    await tab.ev(`${D}.openLens("netlens")`);
    check(await tab.waitFor(finished(), 120000), "As a neural net never finished");
    const stats = await tab.ev(`VGScience.netStats`), text = await tab.ev(`document.querySelector(".vg-lens-body").textContent`);
    if (!/needs/.test(text.slice(0, 100))) {
      check(stats.via === "worker", `the network tests ran on the main thread (${stats.via})`); check(stats.runs === 1, `worked out ${stats.runs} times on opening`);
      check(/steps of memory/.test(text), "no result from the worker");
      // a single setTimeout between runs would still show here: nothing in the app may stall for long while they run
      const worst = await tab.ev(`Math.max(0, ...window.__long)`); check(worst < 1000, `the app stalled ${Math.round(worst)} ms during the network tests`);
      // shut and reopened: the same answer, not worked out again
      await tab.ev(`${D}.closeLens()`); await tab.ev(`${D}.openLens("netlens")`); check(await tab.waitFor(finished(), 5000), "reopening didn't reuse the result");
      check((await tab.ev(`VGScience.netStats.runs`)) === 1, "reopening worked it out again");
      // new link objects with the same links: the same network
      const same = await tab.ev(`(() => { const a = ${D}.noteGraph(); ${D}.renewLinks(); return ${D}.noteGraph() === a; })()`); check(same, "a refresh that changed no link made a new network");
      const changed = await tab.ev(`(() => { const a = ${D}.noteGraph(), l = ${D}.dropLink(); ${D}.renewLinks(); const b = ${D}.noteGraph(); l(); ${D}.renewLinks(); return b !== a; })()`); check(changed, "a real link change kept the old network");
    }
    // behind a lens the picture slows; with none it doesn't
    await tab.ev(`${D}.closeLens()`); check((await tab.ev(`${D}.lensFps(30)`)) === 30, "no lens open, and the picture still slows");
    await tab.ev(`${D}.openLens("spof")`); const slow = await tab.ev(`${D}.lensFps(30)`); check(slow > 0 && slow <= 12, `30 fps behind a lens became ${slow}`);
    check((await tab.ev(`${D}.lensFps(0)`)) === 0, "moving the picture behind a lens lost its full rate");
    await tab.ev(`${D}.closeLens()`);
    // Two-way links on a real pair from the page's data: it shows, suggests the softer side, and Drop reaches the host once
    await tab.ev(`(() => { const ls = DATA.links.filter(l => l.kind === "link"), w = {}; ls.forEach(l => { (w[l.source] = w[l.source] || {})[l.target] = 1; (w[l.target] = w[l.target] || {})[l.source] = 1; }); window.__written = w; })()`); await tab.ev(`${D}.renewLinks()`);
    await tab.ev(`${D}.openLens("twoway")`); check(await tab.waitFor(finished(), 20000), "Two-way links never finished");
    const tw = await tab.ev(`document.querySelector(".vg-lens-body").textContent`);
    check(/two-way pairs/.test(tw) && /Suggested side to drop/.test(tw) && /How to read this/.test(tw), `Two-way links: ${tw.slice(0, 200)}`); check(!/NaN|undefined/.test(tw), "Two-way links shows a broken number");
    await tab.ev(`${D}.closeLens()`); await tab.ev(`void (window.__written = null)`); await tab.ev(`${D}.renewLinks()`);
    // Knowledge debt and Blast radius follow the written links: with none, nothing rests on anything
    await tab.ev(`void (window.__written = Object.fromEntries(${JSON.stringify(Object.keys(out).slice(0, 1))}.map(k => [k, {}])))`); await tab.ev(`${D}.renewLinks()`);
    await tab.ev(`${D}.openLens("debt")`); await sleep(300); const debt = await tab.ev(`document.querySelector(".vg-lens-body").textContent`);
    check(/notes haven't changed/.test(debt), `The old Knowledge debt key doesn't open Stale notes: ${debt.slice(0, 120)}`); check(!/note-years owed/.test(debt), "Stale notes still counts links that aren't written");
    check(!(await tab.ev(`${D}.lenses()`)).some(k => k === "debt" || k === "stale"), "a merged lens is still listed");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  if (fails.length) { console.error(fails.map(f => `  - ${f}`).join("\n")); process.exit(1); }
  console.log("ok - lens load: network tests in a worker, reused until a link changes, slower picture behind a lens, written links only, old tasks in HQ");
})();
