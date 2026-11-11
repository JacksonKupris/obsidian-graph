#!/usr/bin/env node
// The graphs library (vault-graph-views, pinned to a tag in package.json) draws this plugin's data, so the data has to fit
// the shape the library's views read. The library's own check runs on the plugin's data (the sample, or a vault with --vault):
// a changed or dropped field fails here, before a release, with the field named. It also proves the check can fail: each
// field the library names is taken away and has to be reported.
//   node tests/test_views_contract.js [--vault [dir]]        exit 0 = pass
//   "Cannot find module 'vault-graph-views/contract'": run `npm install` (it needs the internet once; see CONTRIBUTING).
const { checks, finish } = require("./kit");
const env = require("./env");
(async () => {
  const { fails, ok } = checks();
  let lib;
  try { lib = await import("vault-graph-views/contract"); }
  catch (e) { console.error(`FAIL  the graphs library isn't installed (${e.message.split("\n")[0]}). Next: npm install`); process.exit(1); }
  const { check, DATA_SHAPE } = lib;
  const copy = () => JSON.parse(JSON.stringify(env.data()));

  const problems = check(env.data());
  ok(problems.length === 0, `the plugin's data fits the library's contract${problems.length ? ": " + problems.join("; ") : ""}`);

  // the check can fail: every field the contract names is reported when it is missing from the plugin's data
  const PART = { node: d => d.nodes[0], link: d => d.links[0], cluster: d => d.clusters[0], top: d => d };
  ok(Object.keys(DATA_SHAPE).filter(p => p !== "strand").every(p => PART[p]), "every part of the contract's shape is covered here (a new part needs a line in PART)");
  for (const part of Object.keys(PART)) {
    const keys = Object.keys(DATA_SHAPE[part] || {});
    ok(keys.length > 0, `the contract names the fields of ${part}`);
    for (const key of keys) {
      const gone = copy(); delete PART[part](gone)[key];
      ok(check(gone).some(p => p.includes("." + key + " ")), `a plugin ${part} without ${key} is reported by the library`);
    }
  }
  finish(fails, "the plugin's data fits the graphs library's contract", "the plugin's data doesn't fit the graphs library");
})();
