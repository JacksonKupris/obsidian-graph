#!/usr/bin/env node
// The shared helpers (src/shared.js) do their job, every part of the plugin uses them, and no second copy has come back.
//   node tests/test_shared.js        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path"), build = require("../build"), env = require("./env");
const SRC = path.join(build.ROOT, "src");
const S = new Function(`${fs.readFileSync(path.join(SRC, "shared.js"), "utf8")}; return VGShared;`)();

// ---- what they do
assert.strictEqual(S.escapeHtml(`<a b="c" d='e'>&`), "&lt;a b=&quot;c&quot; d=&#39;e&#39;&gt;&amp;");
assert.strictEqual(S.escapeHtml(null), ""); assert.strictEqual(S.escapeHtml(undefined), ""); assert.strictEqual(S.escapeHtml(0), "0");
for (const t of ["a.b*c", "C++ (notes)", "$&", "x|y", "[z]", "a/b", "back\\slash", "{1}", "^q?"]) {
  assert.ok(new RegExp(`^${S.escapeRegex(t)}$`).test(t), `escapeRegex doesn't match "${t}" literally`);
  assert.ok(new RegExp(`^${S.escapeRegex(t)}$`, "u").test(t), `escapeRegex isn't valid in unicode mode for "${t}"`); }
assert.ok(!new RegExp(S.escapeRegex("a.b")).test("axb"), "escapeRegex left a dot as a wildcard");

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
  const COPIES = [["HTML escaping", /["']&amp;["']/], ["regex escaping", /\.replace\(\/\[\.\*\+\?\^/], ["starting a worker", /new Worker\(/]];
  const shared = path.join(SRC, "shared.js");
  for (const [what, rx] of COPIES) {
    assert.ok(rx.test(fs.readFileSync(shared, "utf8")), `the guard for ${what} doesn't match the shared copy, so it can't catch another`);
    const copies = walk(SRC).filter(f => f !== shared && rx.test(fs.readFileSync(f, "utf8"))).map(f => path.relative(SRC, f));
    assert.deepStrictEqual(copies, [], `${what} is written again in ${copies.join(", ")}: use src/shared.js`); }
  console.log("ok - shared helpers");
})().catch(e => { console.log(`FAIL - ${e.message}`); process.exit(1); });
