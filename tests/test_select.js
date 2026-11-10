#!/usr/bin/env node
// run.js --only and --changed pick the right steps: a shared file runs everything, a part's file runs the tests that
// load that part, a typo is refused, and the real runner lists what the picker says.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const { checks, finish } = require("./kit"), S = require("./select");
const { fails, check, ok } = checks();
const run = a => spawnSync(process.execPath, [path.join(__dirname, "run.js"), ...a], { encoding: "utf8" });
const all = run(["--list"]).stdout.split("\n").filter(Boolean);
const src = s => { try { return fs.readFileSync(path.join(__dirname, s), "utf8"); } catch (e) { return ""; } };
const changed = files => S.pickChanged(files, all, src).names;
ok(all.length >= 40 && all.includes("test_hq.js") && all.includes("test_dungeon.js") && all.includes("smoke_page.js"), "the step list is missing or short: " + all.length);

// --only
check("only: three spellings name one test", S.pickOnly(["lens_load", "test_lens_load", "tests/test_lens_load.js"], all), { names: ["test_lens_load.js"], unknown: [] });
check("only: a name that matches nothing is reported", S.pickOnly(["rules", "lens_lod"], all), { names: ["test_rules.js"], unknown: ["lens_lod"] });

// --changed
check("a shared file runs everything", changed(["src/rules.js"]).length, all.length);
check("the build runs everything", changed(["build.js"]).length, all.length);
check("the test kit runs everything", changed(["tests/kit.js"]).length, all.length);
check("a file nobody has classified runs everything", changed(["src/something_new.js"]).length, all.length);
check("docs alone run only the quick checks", changed(["README.md", "docs/x.md"]), S.ALWAYS.filter(s => all.includes(s)));
const hq = changed(["src/hq/10-screens.js"]), graph = changed(["src/scenes/dungeon.js"]), eng = changed(["src/engine.js"]);
ok(hq.includes("test_hq.js") && hq.includes("test_hq_layout.js") && !hq.includes("test_dungeon.js") && !hq.includes("test_cosmos_views.js"), "an HQ change should run the HQ tests and not the graph's: " + hq);
ok(graph.includes("test_dungeon.js") && graph.includes("test_lens_load.js") && !graph.includes("test_hq.js") && !graph.includes("test_engine.js"), "a scene change should run the graph tests and not HQ's: " + graph);
ok(eng.includes("test_engine.js") && eng.includes("test_science.js") && !eng.includes("test_dungeon.js"), "an analysis change should run the engine tests: " + eng);
ok([hq, graph, eng].every(xs => S.ALWAYS.every(s => xs.includes(s))), "the quick checks run on every change");
ok(hq.length < all.length * 0.7 && graph.length < all.length * 0.7, `a change to one part should leave out a good share of the suite: hq ${hq.length}, graph ${graph.length} of ${all.length}`);
check("a changed test runs itself", changed(["tests/test_queue.js"]).includes("test_queue.js"), true);
check("a windows path is read the same", changed(["src\\hq\\10-screens.js"]), hq);
// a test that names no part runs with any part, so a new test is never left out by default
const none = all.filter(s => /^test_|smoke/.test(s) && !S.AREAS.some(a => a.uses.test(src(s))));
ok(none.every(s => hq.includes(s) && graph.includes(s)), "a test that names no part was left out: " + none);
// every part has files in the repo and a test that loads it (a renamed folder or loader would make a part match nothing)
const tracked = spawnSync("git", ["ls-files"], { cwd: path.join(__dirname, ".."), encoding: "utf8" }).stdout.split("\n");
ok(tracked.length > 50, "git ls-files gave no list");
S.AREAS.forEach(a => { ok(tracked.some(f => a.files.test(f)), `no file is in the part "${a.name}"`); ok(all.some(s => a.uses.test(src(s))), `no test loads the part "${a.name}"`); });

// the runner itself
check("run.js --only lists just those", run(["--list", "--only", "rules,test_kit"]).stdout.split("\n").filter(Boolean).sort(), ["test_kit.js", "test_rules.js"]);
const typo = run(["--only", "lens_lod"]);
ok(typo.status === 1 && /lens_lod/.test(typo.stdout + typo.stderr), "a mistyped --only should be refused, naming it");
const bad = run(["--list", "--changed=no-such-branch-xyz"]);
ok(bad.status === 1 && /no-such-branch-xyz/.test(bad.stdout + bad.stderr), "--changed against a branch that isn't there should be refused, naming it");
finish(fails, `test selection: --only and --changed pick from ${all.length} steps`, "test selection");
