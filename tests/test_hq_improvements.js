#!/usr/bin/env node
const assert = require("assert"), env = require("./env"), build = require("../build");
const Q = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)();
const H = env.rules.hq, day = "2026-10-28", daily = Q.folders.daily, reports = Q.folders.reports;
const canonical = `${daily}/2026/10-October/Journal/${day}.md`;
const duplicate = `${daily}/2026/08-August/Journal/${day}.md`;
const review = `${reports}/Backlog Reconciliation ${day} 120000.md`;
const older = `${reports}/Backlog Reconciliation 2026-10-27 120000.md`;
const files = [
  { path: duplicate, text: "- [ ] Wrong month task" },
  { path: canonical, text: "- [ ] Real current task" },
  { path: review, text: "---\ntype: review-draft\nstatus: pending\n---\n# Review\n- [ ] Never apply automatically" },
  { path: older, text: "---\ntype: review-draft\nstatus: pending\n---\n# Older review" },
  { path: "Projects/Child.md", text: "---\ntype: user-story\nstatus: in-progress\nparent: '[[Parent]]'\nrelated:\n  - '[[Other Scope]]'\ntags:\n  - project/odoo\n---\n# Child\n## Acceptance\n- [ ] Check behavior\n  - [ ] Child check\n## Testing\n  - [ ] Standalone test" },
];
const hq = Q.hqGather(files, { today: day });
assert.equal(Q.canonicalJournalPath([duplicate, canonical], day), canonical);
assert.equal(Q.canonicalJournalPath([`Archive/2026/10-October/Journal/${day}.md`, duplicate, canonical], day), canonical);
assert.equal(Q.canonicalJournalPath([duplicate, `${daily}/2026/08-August/October/Journal/${day}.md`, canonical], day), canonical);
assert.deepEqual(Q.frontOf("---\nParent task:\n  - '[[Scope]]'\n---")["Parent task"], ["[[Scope]]"]);
assert.equal(hq.journalDuplicates[0].canonical, canonical);
const items = Q.todayList({ nodes: [], links: [], hq }, { today: day });
assert.equal(items.find(i => i.kind === "task").path, canonical);
assert(!items.some(i => i.title === "Wrong month task"));
assert.deepEqual(items.filter(i => i.reviewOnly).map(i => i.path).sort(), [review, older].sort());
assert(!hq.reports.some(r => r.path === review), "review-only report must not offer gardener rows");
assert.deepEqual(hq.projects[0].parents, ["Parent"]);
assert.deepEqual(hq.projects[0].related, ["Other Scope"]);
assert.deepEqual(hq.projects[0].systems, ["project/odoo"]);
assert.equal(hq.projects[0].tasks[0].section, "Acceptance");
assert.equal(hq.projects[0].tasks[1].parent.title, "Check behavior");
assert(!hq.projects[0].tasks[2].parent, "headings reset parent context");
const searchData = {nodes:[],links:[],hq:Q.hqGather([
  {path:"Projects/Print Consumption.md",text:"---\ntype: user-story\nstatus: in-progress\n---\n# Print Consumption\n## Summary\nTrack roll balances from kiosk printing.\n## Acceptance criteria\n- [ ] Verify silicone reconciliation after paper replacement."},
  {path:"Projects/Other.md",text:"---\ntype: project\nstatus: planned\n---\n# Other\n## Summary\nA completely unrelated network maintenance project."},
],{today:day})};
const projects = Q.hqProjects(searchData);
assert(Q.fuzzyScore("prnt cons", "Print Consumption") >= 0);
assert.equal(Q.fuzzyScore("zzzz", "Print Consumption"), -1);
for (const query of ["prnt cons", "consumption print", "silcone", "reconcil", "roll balances"]) {
  const found = Q.hqProjectSearch(searchData, projects, query, {today:day});
  assert.equal(found[0]?.path, "Projects/Print Consumption.md", `graph matching: ${query}`);
}
assert(Q.hqProjectSearch(searchData,projects,"silcone")[0].searchHit.why.includes("close spelling"));
assert.equal(Q.hqProjectSearch(searchData,projects,"zzzzzz").length, 0);
assert.strictEqual(Q.hqProjectSearch(searchData,projects,"   "), projects, "clearing search preserves original order");
assert.equal(Q.hqProjectSearch(searchData,projects.filter(p=>p.group==="planned"),"silcone").length,0,"search respects project filters");
assert.equal(Q.hqProjectSearch(searchData,projects,"print")[0].path,"Projects/Print Consumption.md","name matches rank first");
assert.equal(Q.stripAnsi("\x1b[1mWorked\x1b[0m"), "Worked");
assert(Q.plainRowFull("merge `A/README.md` into `B/README.md`").includes("A/README.md"));
assert(Q.plainRowFull("merge `A/README.md` into `B/README.md`").includes("B/README.md"));
const reviewed = Q.hqGather(files.map(f => f.path === review ? { ...f, text: f.text.replace("status: pending", "status: reviewed") } : f), { today: day });
assert.equal(Q.todayList({nodes: [], links: [], hq: reviewed}, {today: day}).filter(i => i.reviewOnly).length, 1, "older review stays pending");
Q.configure({...env.rules, hq:{...H, automations:[{name:"review-job",review_report:"Backlog Reconciliation",every_hours:168}]}});
hq.runs["review-job"] = {last_run:day+"T12:00:00",ok:true,summary:"\x1b[32mCollected\x1b[0m"};
assert.equal(Q.hqJobs(hq)[0].report, review, "automation points at latest evidence without creating application rows");
assert.equal(Q.hqJobs(hq)[0].summary, "Collected");
console.log("ok - canonical journals, independent pending reports, task context, relationships and full report paths");
