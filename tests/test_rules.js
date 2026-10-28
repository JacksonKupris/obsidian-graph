#!/usr/bin/env node
// Regression tests for the shared rulebook (src/rules.js + a rules file) and the code that uses it.
//   node tests/test_rules.js [--vault [dir]]        exit 0 = pass
// 1. the rules themselves; 3. no surface re-grows its own copy of a shared rule (the drift this module ended);
// 4. one action path; 6. note actions, scenes, shared state; the graph data and search on the vault under test.
// (2 and 5, Python parity and the vault's dashboards, are the vault's own tests.)
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const env = require("./env"), S = path.join(env.ROOT, "src"), S_DIR = S, build = require("../build");
const srcOf = f => (f === "view.js" ? build.viewSource() : fs.readFileSync(path.join(S, f), "utf8"));   // the renderer: src/view/*.js joined
const PY = process.platform === "win32" ? "python" : "python3";   // Linux has no plain "python"
const R = env.rules;
const VGRules = new Function(`${require("../build").rulesSource(R)}; return VGRules;`)();
const fails = [];
const check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// ---- 1. rules
const old = { id: "a/Plan.md", name: "Plan", tags: [], age: R.stale_days + 1 };
check("old note is stale", VGRules.isStale(old), true);
check("done is a record", VGRules.isStale({ ...old, tags: ["status/done"] }), false);
check("archived is a record", VGRules.isStale({ ...old, tags: ["status/archived"] }), false);
check("in-progress is not", VGRules.isStale({ ...old, tags: ["status/in-progress"] }), true);
check("dated name is a record", VGRules.isStale({ ...old, name: "Fix 2026-01-02" }), false);
check("release notes folder", VGRules.isStale({ ...old, id: "03-Resources/Release-Notes/x.md" }), false);
check("young note", VGRules.isStale({ ...old, age: 3 }), false);
check("custom days", VGRules.isStale({ ...old, age: 40 }, 30), true);
// a map candidate: a tagged map in a topic folder, never in the archive (the rules file's folder, at any depth)
const moc = { tags: ["meta/moc"] }, A = R.folders.archive;
check("a tagged map is a map", VGRules.isMapCandidate("02-Systems/Kiosk/Kiosk.md", moc), true);
check("an archived map isn't", VGRules.isMapCandidate(`${A}/Kiosk/Old Kiosk.md`, moc), false);
{ const r = { ...R, not_map_name: R.not_map_name + "|x$&y$'z" };   // the build puts rule data in as written, "$" and all
  check("a rule pattern with $ survives the build", new Function(`${require("../build").rulesSource(r)}; return VGRules;`)().RULES.not_map_name, r.not_map_name); }
// the names prose uses for a note: distinctive titles only, aliases always (vault_graph_rules.mention_names: same)
check("a two-word title is a mention", VGRules.mentionNames("Kiosk Server"), ["Kiosk Server"]);
check("a Context note is named by its topic", VGRules.mentionNames("Kiosk Server - Context"), ["Kiosk Server - Context", "Kiosk Server"]);
check("a plain one-word title isn't", VGRules.mentionNames("kiosk"), []);
check("an acronym is", VGRules.mentionNames("AWS Console"), ["AWS Console"]);
check("a generic title isn't, its alias is", VGRules.mentionNames("Index", ["vault index"]), ["vault index"]);
check("a map archived inside a folder isn't", VGRules.isMapCandidate(`02-Systems/Kiosk/${A}/Old Kiosk.md`, moc), false);

const map = { id: "M.md", title: "M", nav: false, clusters: [1], members: ["x/Alpha.md"], missing: {} };
check("on map by path", VGRules.onMap(map, "x/Alpha.md"), true);
check("on map by same-name copy", VGRules.onMap(map, "y/alpha.md"), true);
check("not on map", VGRules.onMap(map, "x/Beta.md"), false);
map.members.push("x/Beta.md");
check("onMap sees a pushed member", VGRules.onMap(map, "x/Beta.md"), true);
map.members = ["x/Gamma.md"];
check("onMap sees a replaced list", [VGRules.onMap(map, "x/Beta.md"), VGRules.onMap(map, "x/Gamma.md")], [false, true]);
check("first map wins", VGRules.mapForCluster([{ id: "N", nav: true, clusters: [1] }, map, { id: "M2", clusters: [1] }], 1).id, "M.md");

const data = {
  nodes: [{ id: "a.md", age: 5 }, { id: "b.md", age: 0 }, { id: "c.md", age: 300, isolated: true }],
  links: [{ source: "a.md", target: "b.md", kind: "link" }, { source: "a.md", target: "c.md", kind: "gap" }],
  mocs: [{ ...map, members: ["a.md"] }, { id: "Nav.md", nav: true, clusters: [2], members: [] }],
  clusters: [{ id: 1 }], wanted: [{ id: "w.md" }],
};
const g = VGRules.graph(data, { review: { done: { "k1": "2026-10-20" } } });
check("quest link done", VGRules.questDone({ kind: "link", a: "b.md", b: "a.md" }, g), true);
check("quest link open", VGRules.questDone({ kind: "link", a: "a.md", b: "c.md" }, g), false);
check("quest map done (listed)", VGRules.questDone({ kind: "map", key: "map|M.md", id: "a.md" }, g), true);
check("quest map open", VGRules.questDone({ kind: "map", key: "map|M.md", id: "c.md" }, g), false);
check("quest map, nav map counts as gone", VGRules.questDone({ kind: "map", key: "map|Nav.md", id: "c.md" }, g), true);
check("quest write open", VGRules.questDone({ kind: "write", id: "w.md" }, g), false);
check("quest write done", VGRules.questDone({ kind: "write", id: "z.md" }, g), true);
check("quest hub reviewed today", VGRules.questDone({ kind: "hub", id: "b.md", key: "k0" }, g), true);
check("quest via review queue", VGRules.questDone({ kind: "stub", key: "k1" }, g), true);
check("quest already flagged", VGRules.questDone({ kind: "stub", key: "zz", done: true }, g), true);

check("a link pick stays while suggested", VGRules.missionValid({ kind: "link", a: "a.md", b: "c.md" }, g), true);
check("a link pick goes when no longer suggested", VGRules.missionValid({ kind: "link", a: "b.md", b: "c.md" }, g), false);
check("chart done when its topic has a map", VGRules.questDone({ kind: "chart", c: 1 }, g), true);
check("chart dropped when its topic is gone", VGRules.missionValid({ kind: "chart", c: 9 }, g), false);
check("map pick dropped when its map is gone", VGRules.missionValid({ kind: "map", key: "map|Gone.md|a.md", id: "a.md" }, g), false);
check("adopt done once linked", [VGRules.questDone({ kind: "adopt", id: "c.md" }, g), VGRules.questDone({ kind: "adopt", id: "a.md" }, g)], [false, true]);

// Today: one ranked list (todayList) for the graph, its game panel and the sidebar; today's three are its first three
{
  const D = {
    nodes: [{ id: "t/A.md", name: "A", age: 5, bc: 3, cluster: 1 }, { id: "t/B.md", name: "B", age: 0, bc: 1, cluster: 1 },
      { id: "t/C.md", name: "C", age: 300, isolated: true, words: 300, cluster: -1 }, { id: "t/M.md", name: "M", cluster: 1 },
      ...[1, 2, 3, 4, 5, 6, 7].map(i => ({ id: `big/N${i}.md`, name: `N${i}`, age: 1, cluster: 2 }))],
    links: [{ source: "t/A.md", target: "t/C.md", kind: "gap", why: "named together" }, { source: "t/A.md", target: "t/B.md", kind: "link" }],
    mocs: [{ id: "t/M.md", title: "M", clusters: [1], members: ["t/A.md"], missing: { 1: ["t/B.md"] } }],
    clusters: [{ id: 1, name: "T", size: 3 }, { id: 2, name: "Big", size: 7 }],
    wanted: [{ id: "wanted:x", name: "X", refs: ["t/A.md", "t/B.md", "t/C.md"], creatable: true }],
  };
  const L = VGRules.todayList(D, { today: "2026-10-25" }), kinds = new Set(L.map(i => i.kind));
  check("today: every kind of next step", ["link", "map", "write", "chart", "adopt"].filter(k => !kinds.has(k)), []);
  const link = L.find(i => i.kind === "link");
  check("today: a link goes in the staler note", [link.from, link.to], ["t/C.md", "t/A.md"]);
  // a map Create map made keeps its topic's name: a rename is offered when the topic is called something else now,
  // never for a map you made yourself
  { const R2 = { ...D, clusters: [{ id: 1, name: "Topic Now", size: 3 }, { id: 2, name: "Big", size: 7 }],
      mocs: [{ ...D.mocs[0], title: "Old Name", generated: true }, { id: "t/Mine.md", title: "Mine", clusters: [2], members: [], missing: {}, generated: false }] };
    const items = VGRules.todayList(R2, { today: "2026-10-25" }).filter(i => i.kind === "rename");
    check("today: rename a made map to its topic's name, not yours", items.map(i => [i.m, i.name]), [["t/M.md", "Topic Now"]]);
    const g2 = VGRules.graph({ ...R2, mocs: [{ ...R2.mocs[0], title: "Topic Now" }] });
    check("today: a rename is done once the map has the name", VGRules.questDone(items[0], g2), true);
    const kept = { ...R2, clusters: [{ id: 1, name: "Ted Bundy", keywords: "Serial · Ripper", core: ["Ted Bundy", "Serial Killers"], size: 3 }, R2.clusters[1]],
      mocs: [{ ...R2.mocs[0], title: "Serial Killers" }, R2.mocs[1]] };
    check("today: a made map's name that still describes its topic is kept", VGRules.todayList(kept, { today: "2026-10-25" }).filter(i => i.kind === "rename").length, 0); }
  check("today: a map item names its map", [L.find(i => i.kind === "map").m, L.find(i => i.kind === "chart").c], ["t/M.md", 2]);
  check("today: the same order all day", VGRules.todayList(D, { today: "2026-10-25" }).map(i => i.key), L.map(i => i.key));
  check("today: hidden items stay out", VGRules.todayList(D, { today: "2026-10-25", hidden: [link.key] }).some(i => i.key === link.key), false);
  const skip = d => VGRules.todayList(D, { today: d, review: { skipped: { [link.key]: "2026-10-20" } } }).some(i => i.key === link.key);
  check("today: a skip lasts two weeks", [skip("2026-10-25"), skip("2026-11-10")], [false, true]);
  check("today: three picks, each an item", VGRules.todayPick(L).map(p => L.some(i => i.key === p.key) && p.done === false), [true, true, true]);
  const A = new Function("VGRules", `${fs.readFileSync(path.join(S, "actions.js"), "utf8")}; return VGActions;`)(VGRules);
  check("today: every kind has an action", Object.keys(VGRules.TODAY_XP).filter(k => !A.TODAY[k]), []);
}

// Vault HQ: the notes it reads (hqKind), what it reads from them (hqGather), the items it makes in the one Today list,
// the task writes it uses, its marks in the shared file, scheduled jobs and projects. With this test's own hq rules,
// so it doesn't depend on the vault under test's.
{
  const H = { journal: "/Journal/([0-9]{4}-[0-9]{2}-[0-9]{2})[.]md$", standup: "/Standups/Daily Standup ([0-9]{4}-[0-9]{2}-[0-9]{2})[.]md$", plan_heading: "Work Expected",
    carry_days: 30, completion_field: "completion", delegate_field: "delegate", delegate_to: "claude",
    project_types: { "scope-of-work": "Scope", project: "Project", "user-story": "Story" },
    statuses: { active: ["in-progress"], planned: ["planned"], waiting: ["proposed"], closed: ["complete", "cancelled"] }, approval_overdue_days: 3,
    status_choices: ["planned", "in-progress"], status_tags: { active: "status/in-progress", planned: "status/open", waiting: "status/open", closed: "status/done", cancelled: "status/cancelled" },
    backlog: "Tools/Vault Backlog.md", reports: ["Gaps & Bridges"], review_folder: "Inbox/For Review", review_type: "review-draft", decision_type: "decision",
    automation_status: "Sys/runs", automations_note: "Sys/Automations.md", run_log: "Sys/Run Log",
    automations: [{ name: "backup", every_hours: 24 }, { name: "watch", every_hours: 1, work_hours_only: true }, { name: "garden", every_hours: 168, report: "Gardener Report" }, { name: "new-job", every_hours: 24 }] };
  const Q = new Function(`${build.rulesSource({ ...R, hq: H })}; return VGRules;`)(), D = R.folders.daily, day = "2026-10-26";
  const J = d => `${D}/2026/10-October/Journal/${d}.md`, S = d => `${D}/2026/10-October/Standups/Daily Standup ${d}.md`;
  check("hq: a journal in the window", [Q.hqKind(J(day), {}, day), Q.hqKind(J("2026-09-26"), {}, day), Q.hqKind(J("2026-09-25"), {}, day), Q.hqKind(J("2026-10-27"), {}, day)], ["journal", "journal", null, null]);
  check("hq: every kind of note", [Q.hqKind(S("2026-10-23"), {}, day), Q.hqKind("P/Scope.md", { type: "scope-of-work" }, day), Q.hqKind(H.backlog, {}, day),
    Q.hqKind(`${R.folders.reports}/Gaps & Bridges 2026-10-25.md`, {}, day), Q.hqKind(`${R.folders.reports}/Gardener Report 2026-10-24.md`, {}, day),
    Q.hqKind("Inbox/For Review/D.md", { type: "review-draft" }, day), Q.hqKind("Inbox/D.md", { type: "review-draft" }, day), Q.hqKind("W/Dec.md", { type: "decision" }, day),
    Q.hqKind("Sys/Run Log 2026-10.md", {}, day), Q.hqKind(`${R.folders.archive}/P/Scope.md`, { type: "scope-of-work" }, day), Q.hqKind("P/Plain.md", {}, day)],
    ["standup", "project", "backlog", "report", "report", "review", null, "decision", "runlog", null, null]);
  check("hq: projects are scopes, project notes and user stories, by their type field", [Q.hqKind("P/Story.md", { type: "user-story" }, day), Q.hqKind("P/Proj.md", { type: "Project" }, day),
    Q.hqKind("P/Tagged hub.md", { tags: ["type/project", "project/odoo"] }, day), Q.tagsOf({ tags: "#type/user-story, project/x" }),
    Q.hqKind(`${R.folders.system}/memory/project_x.md`, { type: "project" }, day), Q.hqKind(H.backlog, { type: "project" }, day), Q.hqKind("P/Other.md", { type: "note", tags: ["type/project"] }, day)],
    ["project", "project", null, ["type/user-story", "project/x"], null, "backlog", null]);
  check("hq: a project's status tag, by status then group, replacing the old one", [Q.projectStatusTag("cancelled"), Q.projectStatusTag("complete"), Q.projectStatusTag("Planned"), Q.projectStatusTag("odd"),
    Q.withStatusTag({ tags: ["type/user-story", "status/done"] }, "in-progress"), Q.withStatusTag({ tags: ["status/done"] }, "odd")],
    ["status/cancelled", "status/done", "status/open", null, ["type/user-story", "status/in-progress"], ["status/done"]]);
  check("hq: which mark closing a project gives its tasks", [Q.closeMark("complete"), Q.closeMark("cancelled"), Q.closeMark("planned"), Q.closeMark("odd")], ["x", "-", null, null]);
  { const E = new Function(`${build.rulesSource({ ...R, hq: { ...H, completion_field: "✅" } })}; return VGRules;`)();
    check("hq: done stamps the emoji form, and either form already there counts", [E.taskLine("- [ ] Ship it", "x", "2026-10-27"), E.taskLine("- [ ] Ship it ✅ 2026-10-20", "x", "2026-10-27"),
      E.taskLine("- [ ] Ship it [completion:: 2026-10-20]", "x", "2026-10-27"), Q.taskLine("- [ ] Ship it", "x", "2026-10-27"), Q.taskLine("- [ ] Ship it ✅ 2026-10-20", "x", "2026-10-27")],
      ["- [x] Ship it ✅ 2026-10-27", "- [x] Ship it ✅ 2026-10-20", "- [x] Ship it [completion:: 2026-10-20]", "- [x] Ship it [completion:: 2026-10-27]", "- [x] Ship it ✅ 2026-10-20"]); }
  check("hq: a project carries its open tasks, subtasks marked", Q.hqGather([{ path: "P/Story.md", text: "---\ntype: user-story\nstatus: planned\n---\n# User Story: S\n\n- [ ] **Build** it\n\t- [ ] Sub\n- [x] Done\n" }], { today: day })
    .projects[0].tasks.map(({line, text, title, sub}) => ({line, text, title, sub})), [{ line: 6, text: "**Build** it", title: "Build it", sub: false }, { line: 7, text: "Sub", title: "Sub", sub: true }]);
  check("hq: open tasks to close, subtasks too, not in code", Q.openTaskLines("- [ ] A\n\t- [ ] B\n- [x] C\n```\n- [ ] D\n```\n").map(t => [t.line, t.text]), [[0, "A"], [1, "B"]]);
  const journal = "---\ntags:\n  - daily/journal\n---\n# 2026-10-26\n\n### Today's Tasks\n- [ ] Ship the fix\n\t- [ ] a subtask\n- [x] Done already [completion:: 2026-10-26]\n- [ ]  Two spaces after the box\n"
    + "1. [ ] A numbered task\n- [-] Cancelled\n\n```\n- [ ] not a task: code\n```\n\n## Notes\n- [ ] Under notes\n";
  check("hq: top-level tasks with their section, subtasks and code left out", Q.tasksIn(journal).map(t => [t.mark, t.text, t.section]),
    [[" ", "Ship the fix", "Today's Tasks"], ["x", "Done already [completion:: 2026-10-26]", "Today's Tasks"], [" ", " Two spaces after the box", "Today's Tasks"],
      [" ", "A numbered task", "Today's Tasks"], ["-", "Cancelled", "Today's Tasks"], [" ", "Under notes", "Notes"]]);
  const standup = "---\ntype: standup\ndeviation_hours: 2\nrelated-projects:\n  - \"[[Odoo - Context]]\"\n---\n## 3. Work Expected To Be Done Tomorrow\n\n1. **Finish** the alarms.\n\t1. a detail\n2. Count the stickers\n- A bullet too\n\n---\n\n## 4. User Stories\n1. Not the plan\n";
  check("hq: the plan is the top-level items under its heading", Q.itemsUnder(standup, /Work Expected/i).map(i => i.text), ["**Finish** the alarms.", "Count the stickers", "A bullet too"]);
  check("hq: a scope's summary line, else its What paragraph", [Q.scopeSummary("# S\n\n**Summary:** Adds **webhooks** for [[AWS|alarms]].\n"),
    Q.scopeSummary("---\nstatus: x\n---\n# S\n\n## What is it\n\nFirst line\nsecond line.\n\nLater paragraph.\n"), Q.scopeSummary("# S\n\nNo summary.\n"),
    Q.scopeSummary("# S\n\n**Summary**: Colon outside.\n"), Q.scopeSummary("# User Story: S\n\n## Story\n\nAs a tech, I want it.\n")], ["Adds webhooks for alarms.", "First line second line.", "", "Colon outside.", "As a tech, I want it."]);
  check("hq: an estimate as written, not from a table row", [Q.scopeEstimate("- Estimate: 3–5 days of work"), Q.scopeEstimate("## Time estimate\n\nProvisional allowance: **4–8 engineering days**"),
    Q.scopeEstimate("| A | Estimate |\n| x | 2 days |"), Q.scopeEstimate("A 30 day range takes 2 s")], ["3–5 days", "4–8 days", "", ""]);
  check("hq: Done stamps the day once; cancel doesn't", [Q.taskLine("- [ ]  Two spaces", "x", day), Q.taskLine("- [ ] Had it [completion:: 2026-10-01]", "x", day), Q.taskLine("1. [ ] N", "-", day)],
    ["- [x]  Two spaces [completion:: 2026-10-26]", "- [x] Had it [completion:: 2026-10-01]", "1. [-] N"]);
  // Done adds the task to today's standup; report rows are ticked without a stamp (the gardener reads them back)
  { const Q2 = new Function(`${build.rulesSource({ ...R, hq: { ...H, completed_heading: "Work Completed" } })}; return VGRules;`)();
    const su = "## Daily Work Summary\n\n## 1. Work Completed Today\n\n1. **Alarms**\n\t1. Wrote the scope\n2. Updated packages\n\n---\n\n## 2. Blocks\n\n1. Waiting on access\n";
    check("hq: a done task is the next numbered item in the standup's work completed", Q2.addWorkLine(su, "Ship the **fix** [completion:: 2026-10-26]"), su.replace("2. Updated packages\n", "2. Updated packages\n3. Ship the fix\n"));
    check("hq: the same work isn't added twice", Q2.addWorkLine(su, "Updated packages"), su);
    check("hq: an empty section starts at 1, and a standup without the heading isn't touched", [Q2.addWorkLine("## Work Completed\n\n## Blocks\n", "A"), Q2.addWorkLine("# Notes\n", "A")], ["## Work Completed\n\n1. A\n\n## Blocks\n", null]);
    check("hq: CRLF standups keep their line endings", Q2.addWorkLine("## Work Completed\r\n\r\n1. One\r\n", "Two"), "## Work Completed\r\n\r\n1. One\r\n2. Two\r\n");
    const report = "# Gaps\n\n## Gaps\n- [ ] [[A]] ↔ [[B]] — 0.8\n- [x] [[C]] ↔ [[D]]\n## Overlapping MOCs\n- [[README]] (6 notes) overlaps [[Comms]]\n  - [ ] merge [[README]] into [[Comms]] %%act:{\"op\": \"merge\"}%%\n- [ ] `a/b/Some Note.md` ↔ `c/Other.md` — same text\n";
    check("hq: report rows with their section and the line they sit under", Q2.reportRows(report).map(r => [r.line, r.mark, r.section, r.context]),
      [[3, " ", "Gaps", ""], [4, "x", "Gaps", ""], [7, " ", "Overlapping MOCs", "[[README]] (6 notes) overlaps [[Comms]]"], [8, " ", "Overlapping MOCs", ""]]);
    check("hq: a row in words", Q2.reportRows(report).map(r => Q2.plainRow(r.text)), ["A ↔ B — 0.8", "C ↔ D", "merge README into Comms", "Some Note ↔ Other — same text"]);
    check("hq: a report row isn't stamped; a journal task is", [Q2.stampsDone(`${R.folders.reports}/Gaps & Bridges 2026-10-25.md`), Q2.stampsDone(J(day)), Q2.taskLine("  - [ ] row", "x", day, false)], [false, true, "  - [x] row"]); }
  check("hq: a task field is added once", [Q.taskField("- [ ] T", "delegate", "claude"), Q.taskField("- [ ] T [delegate:: claude]", "delegate", "other")], ["- [ ] T [delegate:: claude]", "- [ ] T [delegate:: claude]"]);
  // a small vault's HQ notes, and the items they make
  const files = [
    { path: J(day), text: journal }, { path: J("2026-10-20"), text: "- [ ] Old open task\n- [x] Old done task\n- [ ] Delegated [delegate:: claude]\n" }, { path: J("2026-09-01"), text: "- [ ] Too old\n" },
    { path: S("2026-10-23"), text: standup }, { path: S(day), text: "## Work Expected Tomorrow\n1. Tomorrow's, not today's\n" },
    { path: "P/Scope of Work — X_Waiting.md", text: "---\ntype: scope-of-work\nstatus: proposed\nupdated: 2026-10-20\n---\n# Scope of Work — Waiting One\n\n**Summary:** Waits.\n" },
    { path: "P/Scope of Work — X_Fresh.md", text: "---\ntype: scope-of-work\nstatus: proposed\nupdated: 2026-10-25\n---\n# Fresh One\n" },
    { path: "P/Scope of Work — X_Live.md", text: "---\ntype: scope-of-work\nstatus: in-progress\nupdated: 2026-10-24\n---\n# Live One\n\n- Estimate: 2 days\n" },
    { path: H.backlog, text: "- [ ] Decide the archive\n- [x] Done one\n" },
    { path: `${R.folders.reports}/Gaps & Bridges 2026-10-20.md`, text: "- [ ] old\n" }, { path: `${R.folders.reports}/Gaps & Bridges 2026-10-25.md`, text: "- [ ] a\n- [ ] b\n- [x] c\n" },
    { path: `${R.folders.reports}/Gardener Report 2026-10-24.md`, text: "# Gardener\n" },
    { path: "Inbox/For Review/Draft A.md", text: "---\ntype: review-draft\nstatus: waiting\ntask: Write the email\n---\n# Draft A\n" },
    { path: "Inbox/For Review/Draft B.md", text: "---\ntype: review-draft\nstatus: accepted\n---\n# Draft B\n" },
    { path: "W/Live Decision.md", text: "---\ntype: decision\ndate: 2026-10-25\nstatus: active\nproject: \"[[Scope of Work — X_Live]]\"\n---\n# Live Decision\n" },
    { path: "Sys/runs/pc.json", json: { backup: { last_run: "2026-10-26T02:00:00", ok: false, summary: "disk full" }, watch: { last_run: "2026-10-25T09:00:00", ok: true } } },
    { path: "Sys/runs/laptop.json", json: { backup: { last_run: "2026-10-25T02:00:00", ok: true } } },
    { path: "Sys/Run Log 2026-10.md", text: "# Run Log\n\n- 2026-10-26 · PC · Vault · Did a thing · here\n" },
    { path: J("2026-10-24"), text: "Worked on X_Live today.\n" },
  ];
  const hq = Q.hqGather(files.filter(f => f.json || Q.hqKind(f.path, Q.frontOf(f.text), day)), { today: day });
  check("hq: what it gathers", [hq.journals.length, hq.standups.length, hq.projects.length, hq.backlog.length, hq.reports.map(r => [r.name, r.open]), hq.reviews.length, hq.decisions.length, hq.runlog.length],
    [3, 2, 3, 1, [["Gaps & Bridges 2026-10-25", 2], ["Gardener Report 2026-10-24", 0]], 2, 1, 1]);
  check("hq: the newest run of a job across devices", hq.runs.backup.ok, false);
  const now = new Date("2026-10-26T10:00:00");
  const L = Q.todayList({ nodes: [], links: [], hq }, { today: day, now }), kinds = L.map(i => i.kind);
  check("hq: every kind of item", ["task", "plan", "carried", "approval", "review", "job", "backlog", "report"].filter(k => !kinds.includes(k)), []);
  check("hq: an approval waiting past its days comes first, then today's journal, then the plan", L.slice(0, 5).map(i => [i.kind, i.title]),
    [["approval", "Waiting One"], ["task", "Ship the fix"], ["task", "Two spaces after the box"], ["task", "A numbered task"], ["task", "Under notes"]]);
  check("hq: the plan is the last standup before today's", L.filter(i => i.kind === "plan").map(i => i.title), ["Finish the alarms.", "Count the stickers", "A bullet too"]);
  check("hq: carried over from the window only, newest first", L.filter(i => i.kind === "carried").map(i => [i.title, i.delegated]), [["Old open task", ""], ["Delegated", "claude"]]);
  check("hq: a failed or late job needs you; a never-run one doesn't", L.filter(i => i.kind === "job").map(i => i.name), ["backup", "watch"]);
  check("hq: reports only with rows to tick", L.filter(i => i.kind === "report").map(i => i.title), ["Gaps & Bridges 2026-10-25: 2 rows to tick"]);
  check("hq: groups filter the one list", [Q.todayList({ nodes: [], links: [], hq }, { today: day, now, groups: ["needs"] }).every(i => i.group === "needs"),
    Q.todayList({ nodes: [], links: [], hq }, { today: day, now, groups: ["upkeep"] }).length], [true, 0]);
  const task = L.find(i => i.kind === "task"), plan = L.find(i => i.kind === "plan");
  check("hq: a task item carries what the write needs", [task.path, task.line, task.text], [J(day), 7, "Ship the fix"]);
  const carried = L.find(i => i.kind === "carried"), marks = { [task.key]: `later:${day}`, [carried.key]: "later:2026-10-25", [plan.key]: `done:${day}` };
  const has = it => Q.todayList({ nodes: [], links: [], hq }, { today: day, now, review: { hq: marks } }).some(i => i.key === it.key);
  check("hq: Later lasts the day; Done takes a plan item off", [has(task), has(carried), has(plan)], [false, true, false]);
  const g = Q.graph({ nodes: [], links: [], hq }, { review: { hq: marks } });
  check("hq: an item is done once the notes no longer hold it, or it's marked done", [Q.questDone({ ...task, key: "task|gone|x" }, g), Q.questDone(task, g), Q.questDone(plan, g)], [true, false, true]);
  // the marks live in the shared file: a mark from the other device is kept, one taken back here stays gone
  const m1 = Q.mergeShared({ review: { hq: { a: "later:x" } } }, { review: { hq: {} } }, { review: { hq: { a: "later:x", b: "done:y" } } });
  check("hq: marks merge across devices", m1.review.hq, { b: "done:y" });
  const jobs = Q.hqJobs(hq, now);
  check("hq: job states", jobs.map(j => [j.name, j.state]), [["backup", "failed"], ["watch", "late"], ["garden", "ok"], ["new-job", "never"]]);
  check("hq: a work-hours job isn't late at night", Q.hqJobs(hq, new Date("2026-10-26T23:00:00")).find(j => j.name === "watch").state, "ok");
  const P = Q.hqProjects({ hq });
  check("hq: projects with status group, estimate, days named and decisions", P.map(p => [p.title, p.group, p.estimate, p.days, p.decisions.map(d => d.title)]),
    [["Fresh One", "waiting", "", [], []], ["Live One", "active", "2 days", ["2026-10-24"], ["Live Decision"]], ["Waiting One", "waiting", "", [], []]]);   // newest first
  const A = new Function("VGRules", `${fs.readFileSync(path.join(S_DIR, "actions.js"), "utf8")}; return VGActions;`)(Q);
  check("hq: every kind has an action", Object.keys(Q.TODAY_GROUP).filter(k => !A.TODAY[k]), []);
  const api = { setTaskStatus: 1, setTaskField: 1, setNoteStatus: 1, hqMark: 1, openNote: 1 }, more = it => A.todayMore(it, { api }).map(m => m.key);
  check("hq: the other buttons each item offers", [more(task), more(L.find(i => i.kind === "review")), more(L.find(i => i.kind === "approval")), more(L.find(i => i.kind === "carried" && i.delegated))],
    [["later", "delegate", "open"], ["later", "reject", "open"], ["later"], ["later", "open"]]);
}

// ---- 3. no private copies of shared rules in the surfaces
const banned = [
  [/RECORD_TAG\s*=/, "record rule (use VGRules.isRecord / isStale)"],
  [/\.members\.includes\(/, "map membership (use VGRules.onMap: it matches same-name copies)"],
  [/\.members\.some\(/, "map membership (use VGRules.onMap)"],
  [/function (reviewItems|missionPool|ensureQuests)\b|cos\.missions/, "list of next steps (use VGRules.todayList: one list for every surface)"],
  [/function (questDone|stillValid)\b|const liveDone = q => \{/, "quest/mission rule (use VGRules.questDone / missionValid)"],
  [/find\(\w+ => !\w+\.nav && \w+\.clusters\.includes/, "map-for-cluster (use VGRules.mapForCluster)"],
  [/outlinks \+ 0\.5\)/, "food-web level (use VGRules.trophicLevels)"],
  [/kind === "gap" \|\||kind === "similar" \|\|/, "test for a suggested pair (use VGRules.isSuggestion: one list of suggestion kinds)"],
  [/\bNice\.|everything's tidy|they move up as you/, "reassuring filler in an empty state (state the fact; emptyNext adds the next step)"],
  [/Start Here|OdooERP|\/ - Context\$\//, "vault-specific name (use the rules file: not_map_tops, context_suffix; or derive it from the data)"],
  [/opts\.stampReviewed\(/,"reviewed stamp (use VGActions.run(\"current\", ...): one confirm, Undo and announcement)"],
  [/(?<!isRecord\(n\) && n\.)\bage\s*(<=|>)\s*(Q\.)?stale_days/, "stale rule (use VGRules.isStale: records are never stale)"],
];
for (const f of ["view.js", "plugin.js", "hq.js"]) {
  const src = srcOf(f);
  for (const [re, what] of banned) if (re.test(src)) fails.push(`${f} has its own ${what}`);
}
// adding to a map goes through addToMap (which also updates the open view), gated on canAddToMap()
{
  const src = srcOf("view.js");
  check("only addToMap calls the map write", (src.match(/addToMapAction\(/g) || []).length, 1);
  check("Add-to-map buttons ask canAddToMap()", (src.match(/opts\.appendSection\b/g) || []).length, 5);   // the comment, canAddToMap, the fallback write, Log update ×2
}

// ---- 4. one action path: every vault write in the plugin sits in a WRITE_PRIMITIVES method (which records it for
// undo) or a STATE_WRITERS method (the plugin's own state files). WRITE_ACTIONS methods (wrapped to announce the
// change to every surface) write only through the primitives, so every action can be undone.
{
  const src = fs.readFileSync(path.join(S, "plugin.js"), "utf8");
  const list = name => JSON.parse(src.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1].replace(/\s+/g, " "));
  const prims = list("WRITE_PRIMITIVES"), allowed = new Set([...prims, ...list("STATE_WRITERS")]);
  const bodies = {};
  let cur = "?";
  src.split(/\r?\n/).forEach((l, i) => {
    const m = l.match(/^  (?:async )?([a-zA-Z]+)\(.*\) \{/); if (m) cur = m[1];
    bodies[cur] = (bodies[cur] || "") + l + "\n";
    if (/vault\.(process|modify|create|createBinary|createFolder|rename|delete|trash)\(|adapter\.(write|writeBinary|remove)\(|processFrontMatter\(|fileManager\.(renameFile|trashFile)\(/.test(l) && !allowed.has(cur))
      fails.push(`plugin.js:${i + 1} writes from ${cur}(), which isn't in WRITE_PRIMITIVES (use this.io…)`);
  });
  // a primitive that changes a note records it (noteBefore, or an op in undoCur); folders, trash and data files are the exceptions
  prims.filter(p => !["ioFolder", "ioTrash", "ioData"].includes(p)).forEach(p => {
    if (!bodies[p]) fails.push(`WRITE_PRIMITIVES names ${p}(), which doesn't exist`);
    else if (!/noteBefore\(|undoCur\.ops\.push/.test(bodies[p])) fails.push(`${p}() writes without recording it for undo`);
  });
}

// ---- 6. note actions (actions.js): one catalog, rendered by the inspector and the sidebar
{
  const VGActions = new Function("VGRules", `${fs.readFileSync(path.join(S, "actions.js"), "utf8")}; return VGActions;`)(VGRules);
  const calls = [], api = {};
  ["openNote", "linkNotes", "moveNote", "setNoteTasks", "stampReviewed", "addToMap", "addReference", "linkMentions"].forEach(k => api[k] = async (...a) => { calls.push([k, ...a]); return k === "linkMentions" ? ["d.md"] : 2; });
  const map = { id: "Map.md", title: "Map", clusters: [4], members: [] };
  const done = [], ctx = { api, data: { mocs: [map], quality: { stale_days: R.stale_days }, said_unlinked: [] }, ask: async () => true, pick: async () => "Other.md", done: m => done.push(m), fail: m => done.push("FAIL " + m) };
  const note = { id: "02-Projects/x/Plan.md", name: "Plan", cluster: 4, tasks: 2, refs: false, age: R.stale_days + 5, tags: [] };
  check("actions for a stale note with tasks", VGActions.forNote(note, ctx).map(a => a.key), ["open", "link", "map", "current", "reference", "complete", "cancel", "archive"]);
  check("standalone page (no api) offers none", VGActions.forNote(note, { ...ctx, api: {} }).map(a => a.key), []);
  check("archived notes aren't archived again", VGActions.forNote({ ...note, id: "05-Archive/x/Plan.md" }, ctx).some(a => a.key === "archive"), false);
  check("archive keeps the folder", VGActions.archiveFolder("02-Projects/x/Plan.md"), "05-Archive/02-Projects/x");
  check("root note archives to 05-Archive", VGActions.archiveFolder("Plan.md"), "05-Archive");
  // search: a chunk's line is the file's line, frontmatter included (where Obsidian opens the note)
  check("search: chunk lines count the frontmatter", VGRules.recallChunks("---\ntags:\n  - a\n---\nIntro text that is long enough to be a chunk.\n## Part\nBody text under the heading, long enough to count.\n").map(c => c[2]), [5, 6]);
  // search: a misspelled word's correction counts only for that word, so the chunk with both words wins
  {
    const mk = (path, text) => ({ path, date: "", chunks: VGRules.recallChunks(text) });
    const notes = [mk("a/Both.md", "Connect to exchange online with powershell, then list the mailbox groups for the team."),
      mk("b/One.md", "Exchange notes: the exchange mailbox, the exchange groups, exchange rules."),
      mk("c/Filler.md", "Notes about the paper rolls, a powershell printer script and stickers this month."),
      mk("d/Filler2.md", "More notes about databases, powershell backups and the weekly warehouse report.")];
    const hits = VGRules.recallSearch(notes, "exchnge powershell", { n: 3, today: "2026-10-24" });
    const score = p => (hits.find(h => h.path === p) || { score: 0 }).score;
    check("search: the chunk with both words beats the one with only the corrected word", hits[0] && hits[0].path, "a/Both.md");
    check("search: the corrected word alone counts as one word of two", score("b/One.md") < score("a/Both.md") / 2, true);
  }
  // the plugin's task lines are the ones Obsidian counts as tasks: bullets and numbered items (Complete and Cancel act
  // on them). One rule (VGRules.TASK_LINE), which the plugin and HQ's reading of notes share.
  {
    const TL = VGRules.TASK_LINE;
    check("task lines: the plugin uses the shared rule", /const \{ TASK_LINE \} = VGRules;/.test(fs.readFileSync(path.join(S, "plugin.js"), "utf8")), true);
    check("task lines: -, *, +, 1. and 2) count; plain text doesn't", ["- [ ] a", "  * [ ] b", "+ [x] c", "1. [ ] d", "12) [ ] e", "[ ] f", "1. plain"].map(l => TL.test(l)), [true, true, true, true, true, false, false]);
  }
  // Add reference offers holders: any note the graph treats as a map (a system's map has a plain name), or a hub or index
  {
    let offered = null;
    const rctx = { ...ctx, data: { ...ctx.data, mocs: [map, { id: "02-Systems/Kiosk/Kiosk.md", clusters: [1], members: [] }] },
      pick: async (ph, f) => { offered = ["02-Systems/Kiosk/Kiosk.md", "x/Odoo Hub.md", "x/Release Notes Index.md", "x/Plain Note.md"].map(f); return null; } };
    VGActions.run("reference", note, rctx).then(() => check("Add reference offers maps, hubs and indexes as holders", offered, [true, true, true, false]));
  }
  // problems: each is paired with a real action, shown with its fix where it can run and without one where it can't
  VGActions.PROBLEMS.forEach(p => { if (!VGActions.ACTIONS.some(a => a.key === p.fix)) fails.push(`problem ${p.key}: fix "${p.fix}" isn't an action`); });
  const sick = { ...note, inlinks: 0, outlinks: 3, words: 12 }, qctx = { ...ctx, data: { ...ctx.data, quality: { stale_days: R.stale_days, stub_words: R.stub_words } } };
  check("a note's problems, in order", VGActions.problems(sick, qctx).map(p => p.key + ">" + (p.fix ? p.fix.key : "-")), ["unmapped>map", "stale>current", "orphan>link", "refs>reference", "stub>open"]);
  check("problems as facts", VGActions.problems(sick, qctx).map(p => p.text).slice(0, 2), ["Not listed in Map, its topic's map", `Unchanged for ${R.stale_days + 5} days`]);
  check("without the plugin: the problems, no fixes", VGActions.problems(sick, { ...qctx, api: {} }).map(p => p.fix), [null, null, null, null, null]);
  check("the inspector's top row leaves the fixes to the problems", VGActions.forNote(note, ctx, null, { skip: ["fix"] }).map(a => a.key), ["open", "link", "complete", "cancel", "archive"]);
  (async () => {
    await VGActions.run("archive", note, ctx); await VGActions.run("complete", note, ctx); await VGActions.run("cancel", note, ctx); await VGActions.run("link", note, ctx);
    check("actions call the shared write actions", calls.map(c => c.slice(0, 3)), [["moveNote", note.id, "05-Archive/02-Projects/x"], ["setNoteTasks", note.id, "x"], ["setNoteTasks", note.id, "-"], ["linkNotes", note.id, "Other.md"]]);
    check("actions report what happened", done, ["Archived Plan", "Completed 2 tasks in Plan", "Cancelled 2 tasks in Plan", "Linked Plan ↔ Other"]);
    // undo: offered on the message when the plugin recorded a change for the action, and undoes exactly that one
    {
      let seq = 0; const undone = [], shown = [];
      const uapi = { ...api, moveNote: async () => { seq++; }, openNote: () => {}, lastUndo: () => seq, undo: async id => { undone.push(id); } };
      const uctx = { ...ctx, api: uapi, done: (m, u) => shown.push([m, typeof u]), fail: m => shown.push(["FAIL " + m]) };
      await VGActions.run("archive", note, uctx);
      check("a recorded action offers Undo", shown[0], ["Archived Plan", "function"]);
      await VGActions.run("open", note, uctx);   // records nothing: no Undo
      check("open offers no Undo", shown.length, 1);
      seq = 5;
      const doneWithUndo = []; await VGActions.run("archive", note, { ...uctx, done: (m, u) => doneWithUndo.push([m, u]) });
      await doneWithUndo[0][1]();
      check("Undo undoes that action's entry", undone, [6]);
      check("Undo reports it", doneWithUndo[1][0], "Undone: Archived Plan");
      check("no Undo without the plugin's undo", (await (async () => { const s = []; await VGActions.run("archive", note, { ...ctx, done: (m, u) => s.push(u) }); return s; })()), [null]);
    }
    // every icon an action uses exists on both surfaces
    const view = srcOf("view.js"), plugin = srcOf("plugin.js");
    const viewIcons = new Set([...view.slice(0, view.indexOf("const icon = ")).matchAll(/^    ([a-z0-9]+): '/gm)].map(m => m[1]));
    const lucide = new Set([...plugin.match(/const LUCIDE = \{([^}]*)\}/)[1].matchAll(/([a-z]+):/g)].map(m => m[1]));
    VGActions.ACTIONS.forEach(a => { if (!viewIcons.has(a.icon)) fails.push(`action ${a.key}: icon "${a.icon}" missing from the view's ICON set`);
      if (!lucide.has(a.icon)) fails.push(`action ${a.key}: icon "${a.icon}" missing from the plugin's LUCIDE map`); });
    // folder names come from the rules file's "folders" (so the plugin works in another vault): none in code
    const scenes = fs.readdirSync(path.join(S, "scenes")).map(f => [f, fs.readFileSync(path.join(S, "scenes", f), "utf8")]);
    [["view.js", view], ["plugin.js", plugin], ["actions.js", fs.readFileSync(path.join(S, "actions.js"), "utf8")], ...scenes].forEach(([f, t]) =>
      t.split(/\r?\n/).forEach((l, i) => { const code = l.replace(/\/\/.*$/, ""); if (/["'`/(](00-Inbox|01-Daily|04-People|05-Archive|_scripts|_System|_templates|03-Resources)\b/.test(code) || /\$\{[^}]*\}\s*in 00-Inbox/.test(code)) fails.push(`${f}:${i + 1} names a vault folder (use VGRules.folders)`); }));
    // one vault's own systems (its stack words, platform tags) live in the rules file's "stack", not in the engine or
    // the analysis: a quoted system name in their code (comments aside) fails
    const SYSTEM_WORD = /["'](?:project\/)?(rti|cvr|odoo|resgrid|clickup|rti-console|us-cellular)["']/i;
    [["engine.js", fs.readFileSync(path.join(S, "engine.js"), "utf8"), /\/\/.*$/],
     ...fs.readdirSync(path.join(S, "..", "analysis")).filter(f => f.endsWith(".py")).map(f => [f, fs.readFileSync(path.join(S, "..", "analysis", f), "utf8"), /#.*$/])].forEach(([f, t, comment]) =>
      t.split(/\r?\n/).forEach((l, i) => { if (SYSTEM_WORD.test(l.replace(comment, ""))) fails.push(`${f}:${i + 1} names one vault's system (put it in the rules file's "stack")`); }));
    // the content log's paths come from the rules file's "files": the backup outside the plugin folder is what
    // survives a plugin reinstall (2026-10-22), so no part names its own path
    check("the plugin can read the content log's paths", VGRules.files, R.files);   // the plugin failed to load without them (2026-10-22)
    check("content log in the plugin folder, backup outside it", [R.files.content_log.startsWith(".obsidian/plugins/jk-vault-graph/"), R.files.content_backup.startsWith(".obsidian/")], [true, false]);
    // the plugin's id isn't a published plugin's: "vault-graph" is one, and Obsidian swapped this plugin for it (2026-10-22)
    check("plugin id isn't the published vault-graph", R.files.content_log.split("/")[2] === "vault-graph", false);
    [["plugin.js", plugin]].forEach(([f, t]) => t.split(/\r?\n/).forEach((l, i) => {
      if (/["'`/]content-log\.json/.test(l.replace(/(\/\/|#).*$/, ""))) fails.push(`${f}:${i + 1} names the content log's path (use the rules' "files")`); }));
    // scenes use the shared topic helpers (topicNotes, topicBusy, topicPair, topicsWithNotes, daylight, topicLabel), not their own copies
    scenes.forEach(([f, t]) => [[/n\.cluster === c(\.id)?\b/, "topicNotes"], [/DATA\.(pairs|gaps)\b/, "topicPair"], [/getHours\(\)/, "daylight"], [/reduce\(\(s, n\) => s \+ activity\(n\)/, "topicBusy"], [/l\.kind === "(gap|similar)"[^;]*l\.kind === "(gap|similar)"|near_dupes/, "reactionsAmong"]]
      .forEach(([re, helper]) => { if (re.test(t)) fails.push(`scenes/${f} repeats what ${helper}() does`); }));
    // the shared parts (UI settings, gridDims, chance) aren't rewritten by a view or scene: a square grid, a random
    // event per frame, or the selection colour as a literal
    [...build.viewParts(), ...scenes.map(([f, t]) => ["scenes/" + f, t])].forEach(([f, t]) => t.split(/\r?\n/).forEach((l, i) => {
      const code = l.replace(/\/\/.*$/, "");
      if (/Math\.ceil\(Math\.sqrt\(/.test(code) && !/const gridDims/.test(code)) fails.push(`${f}:${i + 1} sizes its own grid (use gridDims)`);
      if (/Math\.random\(\) [<>] [^;]*\bdt\b/.test(code) && !/const chance/.test(code)) fails.push(`${f}:${i + 1} times its own random event (use chance)`);
      if (/selected[^;]*(strokeStyle|fillStyle) = "#[0-9a-f]{6}"/.test(code)) fails.push(`${f}:${i + 1} colours the selection itself (use UI.colour.selected)`);
    }));
    // scene blocks: every word a block may use has its part in the renderer (a word without one would draw nothing),
    // and sceneSpec reports unknown words instead of guessing
    const P_ = VGRules.SCENE_PARTS, sprites = view.slice(view.indexOf("const SPRITES = {"), view.indexOf("const drawSprite = ")), motions = view.slice(view.indexOf("const MOTION = {"), view.indexOf("const gridDims"));
    P_.as.forEach(w => { if (!new RegExp(`\\n    ${w}: \\(`).test(sprites)) fails.push(`scene part as: ${w} has no sprite in SPRITES`); });
    P_.motion.filter(w => w !== "none" && w !== "lurch-in").forEach(w => { if (!new RegExp(`\\n    ${w}: \\(`).test(motions)) fails.push(`scene part motion: ${w} isn't in MOTION`); });
    P_.angle.forEach(w => { if (!new RegExp(`ISO_VIEWS = \\{[^}]*\\b${w}:`).test(view)) fails.push(`scene part angle: ${w} isn't in ISO_VIEWS`); });
    const specSrc = view.slice(view.indexOf("function specScene("), view.indexOf("const scr = "));
    [...P_.place.filter(w => w !== "grid"), ...P_.wall.filter(w => w !== "none"), ...P_.every.filter(w => w !== "stale"), ...P_.verb.filter(w => w !== "shoot" && w !== "spark")]
      .forEach(w => { if (!view.includes(`=== "${w}"`)) fails.push(`scene word "${w}" isn't handled in the renderer`); });
    check("specScene draws through the shared parts", ["placeGroups(", "packIn(", "ringAround(", "drawSprite(", "MOTION.", "chance(", "topicLabel("].filter(x => !specSrc.includes(x)), []);
    const good = VGRules.sceneSpec({ name: "T", place: "ring", entity: [{ when: "stale", as: "gem", colour: "#abc", motion: "orbit" }, { else: "tree" }], events: [{ do: "dispatch nearest tasks", from: "active" }] });
    check("a good block has no errors", good.errors, []);
    check("a good block's parts", [good.spec.place, good.spec.entity.map(r => r.when + ":" + r.as), good.spec.events[0].verb + ">" + good.spec.events[0].target], ["ring", ["stale:gem", "else:tree"], "dispatch>tasks"]);
    const bad = VGRules.sceneSpec({ name: "B", place: "spiral", entity: [{ when: "sleepy", as: "walker" }, { when: "stale", as: "dragon" }], events: [{ do: "explode" }] });
    check("a bad block reports each unknown word", bad.errors.length, 4);
    check("a bad block falls back to defaults", [bad.spec.place, bad.spec.entity.map(r => r.as)], ["grid", ["walker"]]);
    // what the New scene form writes (sceneYaml) reads back as the same scene once parsed as YAML, as Obsidian does
    {
      const o = { name: "Night #1: market", blurb: "Stalls", group: "topic", place: "rows", angle: "tilt", wall: "activity",
        entity: [{ when: "stale", as: "gem", motion: "orbit", colour: "#abcdef" }, { when: "else", as: "tower" }], events: [{ verb: "spark", target: "unlinked", every: "tasks", colour: "#f00" }, { verb: "spar", every: "activity" }] };
      let parsed = null;
      try { parsed = JSON.parse(execFileSync(PY, ["-c", "import sys, json, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: VGRules.sceneYaml(o), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] })); }
      catch (e) { console.log("  (skipped the scene block round trip: needs Python with PyYAML)"); }
      const back = parsed && VGRules.sceneSpec(parsed);
      if (back) check("a written scene block reads back without errors", back.errors, []);
      if (back) check("a written scene block reads back the same", [back.spec.name, back.spec.place, back.spec.angle, back.spec.wall, back.spec.entity.map(r => [r.when, r.as, r.motion, r.colour]), back.spec.events.map(e => [e.verb, e.target, e.every, e.colour])],
        ["Night #1: market", "rows", "tilt", "activity", [["stale", "gem", "orbit", "#abcdef"], ["else", "tower", "none", null]], [["spark", "unlinked", "tasks", "#f00"], ["spar", null, "activity", null]]]);
    }
    // two devices writing the shared game file keep each other's changes (mergeShared, used by the plugin's saveShared)
    {
      const M = VGRules.mergeShared;
      const base = { v: 1, review: { skipped: { a: "2026-10-20" }, ft: { f: { how: "x" } }, pinned: [] }, cosmos: { xp: 100, hidden: ["h1"], done: [{ id: "d1" }], log: [{ date: "2026-10-20", text: "old" }], daily: { date: "2026-10-23", quests: [{ key: "q1" }, { key: "q2" }] } }, pending: ["p1"] };
      const mine = { v: 1, review: { skipped: { a: "2026-10-20", here: "2026-10-23" }, ft: {}, pinned: [] }, cosmos: { xp: 130, hidden: ["h1"], done: [{ id: "d1" }], log: [{ date: "2026-10-23", text: "here" }, { date: "2026-10-20", text: "old" }], daily: { date: "2026-10-23", quests: [{ key: "q1", done: true }, { key: "q2" }] }, theme: "gold" }, pending: [] };
      const disk = { v: 1, review: { skipped: { a: "2026-10-20", there: "2026-10-23" }, ft: { f: { how: "x" } }, pinned: [] }, cosmos: { xp: 120, hidden: ["h1", "h2"], done: [{ id: "d1" }, { id: "d2" }], log: [{ date: "2026-10-22", text: "there" }, { date: "2026-10-20", text: "old" }], daily: { date: "2026-10-23", quests: [{ key: "q1" }, { key: "q2", done: true }] }, theme: "prism" }, pending: ["p1", "p2"] };
      const out = M(base, mine, disk);
      check("shared merge: both devices' skips kept", Object.keys(out.review.skipped).sort(), ["a", "here", "there"]);
      check("shared merge: an entry removed here stays removed", out.review.ft, {});
      check("shared merge: hidden items, finished missions and log from both", [out.cosmos.hidden, out.cosmos.done.map(d => d.id), out.cosmos.log.map(l => l.text)], [["h1", "h2"], ["d1", "d2"], ["here", "there", "old"]]);
      check("shared merge: XP adds both devices' gains", out.cosmos.xp, 150);
      { const al = (b, m, d) => M({ cosmos: { alchemyRuns: b } }, { cosmos: { alchemyRuns: m } }, { cosmos: { alchemyRuns: d } }).cosmos.alchemyRuns;
        check("shared merge: Alchemy reactions add up like XP", [al(5, 7, 6), al(undefined, 3, undefined)], [8, 3]); }
      check("shared merge: today's quests done on either device", out.cosmos.daily.quests.map(q => !!q.done), [true, true]);
      check("shared merge: queued actions taken here stay taken, new ones kept", out.pending, ["p2"]);
      check("shared merge: settings follow this device", out.cosmos.theme, "gold");
      // the next save from here (base = what it wrote) still keeps the other device's additions it never loaded
      const again = M(mine, { ...mine, cosmos: { ...mine.cosmos, xp: 140 } }, out);
      check("shared merge: the other device's changes survive the next save", [Object.keys(again.review.skipped).sort(), again.cosmos.hidden, again.cosmos.xp], [["a", "here", "there"], ["h1", "h2"], 160]);
      check("shared merge: no file yet", M(null, mine, null), mine);
      const plug = fs.readFileSync(path.join(S, "plugin.js"), "utf8");
      check("the graph view saves the shared file through the merge", /mergeShared\(store && store\.base, mine, disk\)/.test(plug), true);
      // device ledgers: a stale device's save (Sync keeps its copy, which never saw the other device's marks) loses nothing
      {
        const today = "2026-10-23";
        const phone = { v: 1, review: { skipped: { s1: "2026-10-20" }, done: {} }, cosmos: { hidden: ["h-phone"], done: [{ id: "d-phone" }], daily: { date: today, quests: [{ key: "q1", done: true }, { key: "q2" }] }, missions: [{ id: "h-phone" }, { id: "m2" }] } };
        const pcCopy = { v: 1, review: { skipped: { s1: "2026-10-01" }, done: {} }, cosmos: { hidden: [], done: [], daily: { date: today, quests: [{ key: "q1" }, { key: "q2" }, { key: "h-phone" }] }, missions: [{ id: "h-phone" }, { id: "m2" }] } };
        const ledger = VGRules.ledgerAdd(null, phone, [{ a: "x/A.md", b: "y/B.md", kind: "similar", date: today }], today);
        const seen = VGRules.applyLedgers(pcCopy, [ledger]);
        check("ledger: marks from a device whose save Sync dropped come back", [seen.cosmos.hidden, seen.cosmos.done.map(d => d.id), seen.cosmos.daily.quests.map(q => [q.key, !!q.done])],
          [["h-phone"], ["d-phone"], [["q1", true], ["q2", false]]]);
        check("ledger: a hidden item drops out of missions too", seen.cosmos.missions.map(m => m.id), ["m2"]);
        check("ledger: a skip keeps its newest date, so it still expires", seen.review.skipped.s1, "2026-10-20");
        check("ledger: dismissals carried", VGRules.ledgerDismissed([ledger]).map(p => p.b), ["y/B.md"]);
        check("ledger: adding the same marks again changes nothing", JSON.stringify(VGRules.ledgerAdd(ledger, phone, [{ a: "y/b.md", b: "x/a.md" }], today)), JSON.stringify(ledger));
        check("ledger: old days' quests are dropped", Object.keys(VGRules.ledgerAdd({ quests: { "2026-09-01": ["old"] } }, null, null, today).quests), []);
        check("ledger: no ledgers leaves the shared state as it is", VGRules.applyLedgers(pcCopy, []), pcCopy);
        check("linked by name either way, a same-name copy counting", [VGRules.linkedByName({ "a/One.md": { "b/Two.md": 1 } }, "a/One.md", "b/Two.md"),
          VGRules.linkedByName({ "b/Two.md": { "z/one.md": 1 } }, "a/One.md", "b/Two.md"), VGRules.linkedByName({ "a/One.md": { "c/Three.md": 1 } }, "a/One.md", "b/Two.md")], [true, true, false]);
        check("a near-duplicate pair you've linked stops showing (liveMerge)", /data\.near_dupes = [^\n]*VGRules\.linkedByName\(resolved, a, b\)/.test(plug), true);
        check("the shared file is written only by writeShared", (plug.match(/adapter\.write\(normalizePath\(this\.settings\.sharedPath\)/g) || []).length, 1);
        check("loadShared folds in every device's ledger", /async loadShared\(\) \{[\s\S]{0,400}VGRules\.applyLedgers\(sh, ledgers\)/.test(plug), true);
      }
      // missions carry helper functions (e.g. a stale-notes list): the copy taken before a save must not throw on them
      const live = { v: 1, review: { skipped: {} }, cosmos: { xp: 1, missions: [{ id: "m1", c: 3, stale: () => [] }] } };
      let snap = null, err = "";
      try { snap = VGRules.sharedSnapshot(live); } catch (e) { err = e.message; }
      check("shared state with mission functions can be saved", [err, snap && snap.cosmos.missions[0].id, snap && "stale" in snap.cosmos.missions[0]], ["", "m1", false]);
      check("the shared store copies state with sharedSnapshot, not structuredClone", /structuredClone/.test(plug.slice(plug.indexOf("sharedStore() {"), plug.indexOf("// The latest MOC Alignment report"))), false);
    }
    check("scene keys are the same for plugin and view",[VGRules.sceneKey("_System/Vault Graph Scenes/Superhero Dispatch (scene).md"), VGRules.sceneKey("a/B.md", 1)], ["note-superhero-dispatch-scene", "note-b-1"]);
    // the polish layer (pulses, select wave, reticle) is one copy: every map view and scene draws it after its picture,
    // and Neural calls the same functions instead of its own
    check("every map view and scene draws the polish layer", /function draw\(now\) \{\s*const r = drawView\(now\);\s*if \(mapView\(\) && W\) polishLayer\(now\);/.test(view), true);
    check("pulses, wave and reticle have one copy", [(view.match(/pulses\.push\(/g) || []).length, (view.match(/a0 \+ 0\.7\); ctx\.stroke\(\)/g) || []).length], [1, 1]);
    check("Neural draws through the shared polish", ["drawPulses(now, visLinks", "drawWaveLinks(now, visLinks", "drawReticle(now, hudCol)"].filter(x => !view.includes(x)), []);
    // no surface writes its own archive / close-all-tasks again (they go through VGActions)
    [["view.js", view], ["plugin.js", plugin]].forEach(([f, t]) => {
      if (/"05-Archive\/" \+/.test(t)) fails.push(`${f} builds its own archive path (use VGActions)`);
      if (/setNoteTasks\([^)]*\)/.test(t.replace(/setNoteTasks\(notePath, status\)|setNoteTasks: \(notePath, status\) => this\.setNoteTasks\(notePath, status\)|async setNoteTasks\(notePath, status = "x"\)/g, "")))
        fails.push(`${f} calls setNoteTasks itself (use VGActions "complete"/"cancel")`);
    });
    // the cache folder isn't synced, so on another PC it doesn't exist yet: the plugin creates it before writing there
    check("live-state.json is written after creating the cache folder", /mkdir\(dir\);[^\n]*live-state\.json/.test(plugin), true);
    check("the cache folder is a dot-folder (Sync leaves it out)", /^\./.test(R.folders.cache || ""), true);
    // the graph data is whole: every link ends at a note or a ghost (a note not written yet), every note is one file
    {
      const GD = env.data(), dir = env.dir();
      const ends = new Set([...GD.nodes.map(n => n.id), ...(GD.wanted || []).map(w => w.id)]);
      check("every graph link ends at a note or a ghost", GD.links.filter(l => !ends.has(l.source) || !ends.has(l.target)).map(l => `${l.kind}: ${l.source} → ${l.target}`).slice(0, 5), []);
      check("every graph note is one file", GD.nodes.filter(n => !n.ghost && !n.person && !fs.existsSync(path.join(dir, n.id))).map(n => n.id).slice(0, 5), []);
      // search (VGRules.recallSearch): the ways people look for what they half-remember, on the sample vault
      if (!env.VAULT) {
        const { list } = env.notes(), today = new Date().toISOString().slice(0, 10);
        const graph = { links: GD.links.filter(l => l.kind === "link" || l.kind === "similar").map(l => [l.source, l.target, l.kind]),
          use: Object.fromEntries(GD.nodes.map(n => [n.id, (n.inlinks || 0) + (n.opens90 || 0)])) };
        const people = ["ana", "ben", "chloe", "dev"];
        const cases = [
          ["vpn setup", h => h.path.endsWith("VPN Setup.md"), "the VPN note"],                                  // words
          ["vpn setp", h => h.path.endsWith("VPN Setup.md"), "the same, misspelled"],                             // close spelling
          ["sql query rentals", h => h.lang === "sql", "the SQL block"],                                          // kind (query) + words
          ["escalation near refund policy", h => /Escalation Process/.test(h.path) && h.why.includes("near"), "a note linked to Refund Policy"],   // near
        ];
        for (const [q, ok, what] of cases) {
          const hits = VGRules.recallSearch(list, q, { n: 3, people, today, graph });
          check(`search "${q}" finds ${what} first`, !!(hits[0] && ok(hits[0])), true);
        }
        // search keeps each note's words between queries (typing doesn't re-read the vault): a note whose text changed
        // (new chunks, as the plugin caches them) is searched as it is now, and one that's gone isn't found
        const word = "zanzibarquokka", i = list.findIndex(n => n.path.endsWith("VPN Setup.md"));
        check("search: a word no note has", VGRules.recallSearch(list, word, { n: 3, today }).length, 0);
        const edited = list.map((n, k) => k === i ? { ...n, chunks: [...n.chunks, ["section", "New", 99, `The ${word} gateway replaced the old tunnel last week.`, ""]] } : n);
        check("search: a note's new text is found", (VGRules.recallSearch(edited, word, { n: 3, today })[0] || {}).path, list[i].path);
        check("search: and gone once the note is", VGRules.recallSearch(list.filter((n, k) => k !== i), word, { n: 3, today }).length, 0);
      }
    }
    if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); process.exit(1); }
    console.log("ok - shared rules");
  })();
}
