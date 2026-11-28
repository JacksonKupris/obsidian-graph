#!/usr/bin/env node
// Every tests/test_*.js is a step of tests/run.js without being listed there (five were silently never run: genome, hq_layouts_work,
// menu_order, phone_app, phone_server), so a new test needs no registration and two branches adding tests don't conflict.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process"), { checks, finish } = require("./kit");
const { fails, ok: check } = checks();
const r = spawnSync(process.execPath, [path.join(__dirname, "run.js"), "--list"], { encoding: "utf8" });
check(r.status === 0, "run.js --list works");
const listed = new Set(r.stdout.split("\n").filter(Boolean));
const files = fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f));
check(files.length > 100, `the test files are found (${files.length})`);
for (const f of files) check(listed.has(f), `${f} is a step of run.js`);
finish(fails, `all ${files.length} test files run`, "every test runs");
