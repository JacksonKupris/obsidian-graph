#!/usr/bin/env node
// A sample cached yesterday must regenerate before HQ looks for today's tasks.
const assert = require("assert"), fs = require("fs"), path = require("path"), env = require("./env");
if (!env.VAULT) {
  const dir = env.dir(), marker = path.join(dir, ".generated-day");
  fs.writeFileSync(marker, "2000-01-01\n");
  env.dir();
  const hq = env.hqData(), rules = env.notes().VGRules, today = rules.today();
  assert.strictEqual(fs.readFileSync(marker, "utf8").trim(), today);
  assert(hq.journals.some(j => j.date === today && j.tasks.some(t => t.mark === " ")), "fresh fixture needs today's open task");
  fs.unlinkSync(marker);
  env.dir();
  assert.strictEqual(fs.readFileSync(marker, "utf8").trim(), today, "old caches without a marker regenerate too");
}
console.log("ok - sample fixture refreshes on local-day rollover and missing date marker");
