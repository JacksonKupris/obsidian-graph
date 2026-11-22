#!/usr/bin/env node
// Hunt for what nobody thought of: random walks over every view with fresh seeds, then the sweeps that visit every view.
// A failure prints its seed, so the walk can be replayed (`node tests/test_monkey.js --seed N`) and pinned as a plain test.
//   npm run hunt [-- --walks 3 --steps 150]      weekly in CI (.github/workflows/hunt.yml); run it before a release too
const { spawnSync } = require("child_process"), path = require("path");
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const walks = Number(arg("--walks", 3)), steps = arg("--steps", "150"), t = p => path.join(__dirname, "..", "tests", p);
let bad = 0;
const run = (label, args) => { const r = spawnSync(process.execPath, args, { encoding: "utf8" }), out = (r.stdout + r.stderr).trim(); console.log(`${r.status ? "FAIL" : "ok  "} ${label}\n${r.status ? out.split("\n").map(l => "     " + l).join("\n") : ""}`); if (r.status) bad++; };
for (let i = 0; i < walks; i++) { const seed = Math.floor(Math.random() * 1e6); run(`random walk, seed ${seed}, ${steps} steps`, [t("test_monkey.js"), "--seed", String(seed), "--steps", steps]); }
run("every view: tap sizes on a phone", [t("test_every_tap_target.js")]);
run("every view: assigned to personas", [t("test_persona_plan.js")]);
if (bad) { console.log(`\n${bad} failed. Replay a walk with its seed, write what it found as a failing test, then fix it.`); process.exit(1); }
console.log("\nNothing found. Run it again with different seeds, or add a sweep for a rule that only some views are checked against.");
