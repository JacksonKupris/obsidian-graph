#!/usr/bin/env node
// "No references" is only a problem in a vault that uses references. Before, a vault where no note had a `references:` property
// had every note flagged (3D persona round, 0.6.229: "No references on every note"). Now the rule is one shared function.
const { checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    const r = await tab.ev(`(() => { const R = VGRules; if (typeof R.settleRefs !== "function") return null; const note = (id, refs) => ({ id, refs }), refs = l => l.map(n => n.refs);
      const none = R.settleRefs([note("a", false), note("b", false)]), some = R.settleRefs([note("a", true), note("b", false), note("c", false)]), mixed = R.settleRefs([{ id: "p", person: true }, note("a", false)]);
      return { none: refs(none), some: refs(some), person: mixed[0].refs === undefined, liveUsed: R.noRefsValue([note("a", true)]), liveUnused: R.noRefsValue([note("a", null)]) }; })()`);
    check(!!r, "VGRules.settleRefs exists (the check can't pass without it)");
    if (r) {
      check(JSON.stringify(r.none) === "[null,null]", "a vault with no references flags nothing: " + JSON.stringify(r.none));
      check(JSON.stringify(r.some) === "[true,false,false]", "a vault that uses references still flags the rest: " + JSON.stringify(r.some));
      check(r.person, "people and maps (no refs field) are left alone");
      check(r.liveUsed === false && r.liveUnused === null, "a new live note starts with the same value the rule gives");
    }
  } catch (e) { fails.push("crashed: " + e.message); }
  const fs = require("fs"), path = require("path");
  for (const [f, w] of [["src/plugin/50-analysis.js", "VGRules.settleRefs("], ["src/plugin/80-live.js", "VGRules.noRefsValue("]]) check(fs.readFileSync(path.join(env.ROOT, f), "utf8").includes(w), f + " uses the shared rule (" + w + ")");
  await tab.close(); finish(fails, "references are only flagged where the vault uses them");
})();
