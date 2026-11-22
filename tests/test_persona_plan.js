#!/usr/bin/env node
// Every view the page lists is assigned to at least three personas, and every assigned persona has an agent file: a view added later can't go untested by people.
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit"), { forKind, plan, views } = require("../scripts/persona_plan");
const { fails, ok: check } = checks();
(async () => {
  try {
    const vs = await views(), { by, thin } = plan(vs);
    check(vs.length > 30, "the page should list its views (got " + vs.length + ")");
    check(!thin.length, "views with fewer than 3 personas: " + thin.map(v => v.key));
    for (const p of Object.keys(by)) check(fs.existsSync(path.join(__dirname, "..", ".claude", "agents", p + ".md")), `${p} has no agent file`);
    check(forKind("a kind nobody has thought of yet").length >= 3, "an unknown kind of view still gets 3 personas");
    const ids = new Set(Object.values(by).flat().map(v => v.key));
    check(vs.every(v => ids.has(v.key)), "every view key appears in the plan");
  } catch (e) { fails.push("crashed: " + e.message); }
  finish(fails, "Every view is assigned to personas");
})();
