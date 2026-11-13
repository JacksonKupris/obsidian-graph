#!/usr/bin/env node
// The shared helpers (src/shared.js) do their job, every part of the plugin uses them, and no second copy has come back.
//   node tests/test_shared.js        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path"), build = require("../build"), env = require("./env");
const SRC = path.join(build.ROOT, "src");
const S = new Function(`${fs.readFileSync(path.join(SRC, "shared.js"), "utf8")}; return VGShared;`)();

// ---- what they do
assert.deepStrictEqual(S.scopeOf({ folder: "/Work/Kiosk/", tag: "#Project/Kiosk" }), { folder: "Work/Kiosk", tag: "project/kiosk" });
assert.deepStrictEqual(S.scopeOf(null), { folder: "", tag: "" });
assert.strictEqual(S.scopeHas(null, "a.md", []), true, "no scope: every note"); assert.strictEqual(S.scopeHas({}, "a.md"), true);
assert.strictEqual(S.scopeHas({ folder: "Work" }, "Work/a.md", []), true); assert.strictEqual(S.scopeHas({ folder: "Work" }, "Workshop/a.md", []), false, "a folder isn't a prefix of a name");
assert.strictEqual(S.scopeHas({ tag: "project/kiosk" }, "a.md", ["#Project/Kiosk"]), true); assert.strictEqual(S.scopeHas({ tag: "project" }, "a.md", ["project/kiosk"]), true, "a tag holds the tags under it");
assert.strictEqual(S.scopeHas({ tag: "project/kiosk" }, "a.md", ["project/kiosks"]), false); assert.strictEqual(S.scopeHas({ tag: "project" }, "a.md"), false, "no tags, not in a tag");
assert.strictEqual(S.scopeHas({ folder: "Work", tag: "x" }, "Work/a.md", ["y"]), false, "a folder and a tag: both");
// the Guide scan and the Cas9 scene ask the same rule which notes a scan covers
for (const f of ["plugin/45-tasks-and-maps.js", "scenes/cas9.js"]) assert.ok(fs.readFileSync(path.join(SRC, f), "utf8").includes("VGShared.scopeHas("), `${f} has its own idea of what a scan covers`);
assert.strictEqual(S.escapeHtml(`<a b="c" d='e'>&`), "&lt;a b=&quot;c&quot; d=&#39;e&#39;&gt;&amp;");
assert.strictEqual(S.escapeHtml(null), ""); assert.strictEqual(S.escapeHtml(undefined), ""); assert.strictEqual(S.escapeHtml(0), "0");
for (const t of ["a.b*c", "C++ (notes)", "$&", "x|y", "[z]", "a/b", "back\\slash", "{1}", "^q?"]) {
  assert.ok(new RegExp(`^${S.escapeRegex(t)}$`).test(t), `escapeRegex doesn't match "${t}" literally`);
  assert.ok(new RegExp(`^${S.escapeRegex(t)}$`, "u").test(t), `escapeRegex isn't valid in unicode mode for "${t}"`); }
assert.ok(!new RegExp(S.escapeRegex("a.b")).test("axb"), "escapeRegex left a dot as a wildcard");

assert.strictEqual(S.nameOf("a/b/My Note.md"), "My Note"); assert.strictEqual(S.nameOf("a/b/x.MD"), "x"); assert.strictEqual(S.nameOf("x.png"), "x.png"); assert.strictEqual(S.nameOf(null), ""); assert.strictEqual(S.baseOf("a/b.md"), "b.md");
assert.strictEqual(S.shortDate(""), ""); assert.strictEqual(S.shortDate("not a date"), "not a date"); assert.ok(/4/.test(S.shortDate("2026-11-04")), "a date keeps its day");
assert.strictEqual(S.plural(1, "note"), "1 note"); assert.strictEqual(S.plural(2, "note"), "2 notes"); assert.strictEqual(S.plural(2, "person", "people"), "2 people");
assert.strictEqual(S.plainLinks("see [[a/b|the note]] and [[c]]"), "see the note and c"); assert.strictEqual(S.stripFrontmatter("---\na: 1\n---\nbody"), "body"); assert.strictEqual(S.stripFrontmatter("---\r\na: 1\r\n---\r\nbody"), "body"); assert.strictEqual(S.stripFrontmatter("no front"), "no front");
assert.strictEqual(S.shiftDay("2026-03-01", -1), "2026-02-28"); assert.strictEqual(S.shiftDay("2026-11-01", 1), "2026-11-02", "across a clock change"); assert.strictEqual(S.daysBetween("2026-01-01", "2026-03-01"), 59); assert.strictEqual(S.noon("2026-11-03").getDate(), 3); assert.strictEqual(S.noon("2026-11-03").getHours(), 12); assert.strictEqual(S.pad2(3), "03"); assert.strictEqual(S.pad2(12), "12");

// ---- a worker that can't start falls back, and says so; without one, the job runs here
(async () => {
  { const stats = {}; assert.strictEqual(await S.offThread({ makers: {}, listen: "", message: 0, here: () => "here", label: "x is", stats }), "here"); assert.strictEqual(stats.via, "here"); }
  { const G = { Worker: function () { throw new Error("blocked"); }, Blob: function () {}, URL: Object.assign(function () {}, { createObjectURL: () => "blob:x", revokeObjectURL() {} }) };
    const T = new Function("Worker", "Blob", "URL", `${fs.readFileSync(path.join(SRC, "shared.js"), "utf8")}; return VGShared;`)(G.Worker, G.Blob, G.URL);
    const warn = console.warn; let warned = ""; console.warn = (...a) => { warned = a.join(" "); };
    const stats = {}; const r = await T.offThread({ makers: {}, listen: "", message: 0, here: () => "here", label: "the job is", stats }); console.warn = warn;
    assert.strictEqual(r, "here"); assert.strictEqual(stats.via, "here"); assert.ok(/the job is running on the main thread: blocked/.test(warned), `no warning: ${warned}`); }

  // ---- every surface gets the same one
  const bundle = build.buildPlugin(env.rules)["main.js"];
  assert.strictEqual((bundle.match(/^const VGShared = VGSharedMake\(\);/gm) || []).length, 1, "the plugin bundle should define the shared helpers exactly once");
  assert.ok(bundle.indexOf("const VGShared =") < bundle.indexOf("const VGRules"), "the shared helpers have to come before the rules");
  for (const f of ["view/00-core.js", "hq/00-core.js", "tour.js"]) assert.ok(fs.readFileSync(path.join(SRC, f), "utf8").includes("const esc = VGShared.escapeHtml;"), `${f} has its own escaping`);
  const rulesAlone = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)(); assert.ok(rulesAlone.RULES, "the rules need to load on their own");
  assert.ok(new Function(`${build.engineSource()}; return VGEngine;`)().run, "the engine needs to load on its own");

  // ---- no copy comes back. Each pattern must find shared.js's own, or this guard couldn't fail.
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []);
  const COPIES = [["HTML escaping", /["']&amp;["']/], ["regex escaping", /\.replace\(\/\[\.\*\+\?\^/], ["starting a worker", /new Worker\(/], ["taking a path apart", /\.split\("\/"\)\.pop\(\)/], ["the length of a day", /\b864e5\b/], ["padding to two digits", /padStart\(2, "0"\)/], ["a local noon", /new Date\([^)]*"T12:00(:00)?"\)/], ["a link's alias", /\/\\\[\\\[\(\?:\[\^\\\]\|\]\*\\\|\)\?/], ["plural", /\$\{n === 1 \? /]];
  const shared = path.join(SRC, "shared.js");
  for (const [what, rx] of COPIES) {
    assert.ok(rx.test(fs.readFileSync(shared, "utf8")), `the guard for ${what} doesn't match the shared copy, so it can't catch another`);
    const copies = walk(SRC).filter(f => f !== shared && rx.test(fs.readFileSync(f, "utf8"))).map(f => path.relative(SRC, f));
    assert.deepStrictEqual(copies, [], `${what} is written again in ${copies.join(", ")}: use src/shared.js`); }
  // ---- the plugin's parts join into a plugin: one class, with the settings tab after it
  assert.strictEqual((build.pluginSource().match(/extends Plugin \{/g) || []).length, 1, "the plugin class should start once");
  assert.ok(build.pluginSource().startsWith("// plugin/*.js"), "the parts are joined out of order");
  // ---- the plugin's own services: one lookup, one frontmatter read, one JSON read. The counts are the services' own lines.
  const plugin = build.pluginSource(), count = rx => (plugin.match(rx) || []).length;
  assert.strictEqual(count(/getAbstractFileByPath\(/g), 2, "look notes up with fileAt, or pathTaken for whether a path is in use");
  assert.strictEqual(count(/getFileCache\(\w+\) \|\| \{\}\)\.frontmatter/g), 1, "read frontmatter with fmOf");
  assert.ok(count(/JSON\.parse\(await/g) <= 2, "read JSON files with readJson");   // readJson, and loading the graph data
  // ---- the scripts have one of each too. Each pattern has to find lib.js's own.
  const LIB = path.join(build.ROOT, "scripts", "lib.js"), scripts = fs.readdirSync(path.dirname(LIB)).filter(f => f !== "lib.js").map(f => path.join(path.dirname(LIB), f)).concat(path.join(build.ROOT, "tests", "env.js"));
  for (const [what, rx] of [["reading local.json", /"local\.json"\)/], ["choosing Python", /"win32" \? "python"/], ["a GitHub address", /github\\\.com\[:\/\]/], ["failing out", /const fail = msg/]]) {
    assert.ok(rx.test(fs.readFileSync(LIB, "utf8")), `the guard for ${what} doesn't match scripts/lib.js`);
    const copies = scripts.filter(f => rx.test(fs.readFileSync(f, "utf8"))).map(f => path.basename(f)); assert.deepStrictEqual(copies, [], `${what} is written again in ${copies.join(", ")}: use scripts/lib.js`); }
  // Undo and Redo: every surface that changes notes has the one pair (VGParts.historyButtons), none draws its own
  for (const f of ["hq/70-frame.js", "view/70-shell.js", "plugin/10-views.js"]) assert.ok(/VGParts\.historyButtons\(/.test(fs.readFileSync(path.join(SRC, f), "utf8")), `${f} has no Undo and Redo pair (VGParts.historyButtons)`);
  for (const f of ["view/70-shell.js", "plugin/10-views.js", "hq/70-frame.js"]) assert.ok(/VGActions\.history\.subscribe\(/.test(fs.readFileSync(path.join(SRC, f), "utf8")), `${f} doesn't follow the shared history`);
  console.log("ok - shared helpers");
})().catch(e => { console.log(`FAIL - ${e.message}`); process.exit(1); });
