#!/usr/bin/env node
// tests/run.js lists one test per line, so two branches that each add a test don't conflict on the same line.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit");
const { fails, ok: check } = checks();
const lines = fs.readFileSync(path.join(__dirname, "run.js"), "utf8").split("\n");
const start = lines.findIndex(l => l.startsWith("const steps = ["));
check(start >= 0, "the steps array is in run.js");
let n = 0;
for (let i = start + 1; i < lines.length && !lines[i].startsWith("const stop"); i++) {
  const heads = (lines[i].match(/\["[\w.]+\.js", \[/g) || []).length;
  n += heads;
  check(heads <= 1, `run.js line ${i + 1} registers ${heads} tests; one per line`);
}
check(n > 100, `the registry holds the tests (found ${n})`);
finish(fails, "the test registry is one test per line", "registry lines");
