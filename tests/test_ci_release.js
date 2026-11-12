#!/usr/bin/env node
// The rules for a release made after a merge: what releases, what doesn't, which step, and that the workflows are wired to it.
const assert = require("assert"), fs = require("fs"), path = require("path");
const { plan } = require("../scripts/ci_release"), { nextVersion, shipsInPlugin, stepFromMessages } = require("../scripts/lib");
const base = { last: "0.6.84", tagHasRelease: true, files: ["src/engine.js"], messages: "Fix a thing", headMessage: "Fix a thing", current: "0.6.84", behind: false };
const p = over => plan({ ...base, ...over });

// a change to what ships releases the next patch
assert.deepStrictEqual([p({}).action, p({}).version], ["release", "0.6.85"]);
// docs, tests, scripts and workflows release nothing (a docs merge must not reach every device)
for (const f of ["README.md", "docs/a.md", "tests/x.js", "scripts/ship.js", ".github/workflows/test.yml", "fixtures/s.json"]) assert.strictEqual(p({ files: [f] }).action, "skip", f);
for (const f of ["src/view/a.js", "config/rules.json", "build.js", "package.json", "package-lock.json"]) assert.strictEqual(p({ files: [f] }).action, "release", f);
assert.strictEqual(shipsInPlugin("src\\view\\a.js"), true);
// the step comes from the merge messages; the highest wins
assert.strictEqual(p({ messages: "Merge pull request #1\nAdded a view [minor]" }).version, "0.7.0");
assert.strictEqual(p({ messages: "a [minor]\nb [MAJOR]" }).version, "1.0.0");
assert.strictEqual(stepFromMessages("nothing"), "patch");
assert.strictEqual(nextVersion("0.6.9", "patch"), "0.6.10");
assert.strictEqual(nextVersion("0.6.9", "2.0.1"), "2.0.1");
assert.strictEqual(nextVersion("0.6.9", "huge"), undefined);
// [no release] on the head commit skips; a newer commit on main skips (its run releases both)
assert.strictEqual(p({ headMessage: "Docs [no release]" }).action, "skip");
assert.strictEqual(p({ behind: true }).action, "skip");
// a tag that never got its GitHub release (a run that died after the push) is published on the next run, even with nothing new
assert.deepStrictEqual([p({ tagHasRelease: false, files: [] }).action, p({ tagHasRelease: false, files: [] }).version], ["publish", "0.6.84"]);

// the wiring: the release job needs the aggregate check, which needs every shard; release.yml shares the publish step
const test = fs.readFileSync(path.join(__dirname, "../.github/workflows/test.yml"), "utf8"), rel = fs.readFileSync(path.join(__dirname, "../.github/workflows/release.yml"), "utf8");
assert.match(test, /release:\n(?:.*\n)*?\s+needs: tests/, "the release job must need the tests check");
assert.match(test, /tests:\n(?:.*\n)*?\s+needs: test\n/, "the tests check must need the shards");
assert.match(test, /fetch-depth: 0/, "the release job needs the tags and history");
assert.match(rel, /ci_release\.js --publish/, "release.yml must publish through the shared step");
assert.ok(!/gh release create/.test(rel), "release.yml must not keep its own copy of the publish command");
console.log("ok - ci release: what releases, the step, the skips, and the workflow wiring");
