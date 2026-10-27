#!/usr/bin/env node
// Vault HQ in the plugin (the built main.js under a stand-in Obsidian): it reads the same HQ notes as the rules do on
// a folder (one gathering, VGRules.hqGather), its writes do what HQ's buttons say (Done stamps the day in the task's
// own journal, Delegate adds the field, Accept/Reject set the draft's status and reason, a task that changed since is
// refused), and its marks (Later, a plan item Done) go in the shared file and can be taken back.
//   node tests/test_hq_plugin.js [--vault [dir]]        exit 0 = pass
const fs = require("fs"), path = require("path"), env = require("./env"), stub = require("./plugin_stub");
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const { Plugin, VGRules, TFile } = stub.load(env.rules);
const H = env.rules.hq;

(async () => {
  if (!H) { console.log("ok - (skipped: no hq rules in this vault's rules file)"); process.exit(0); }
  // 1. the plugin reads what the rules read on the folder: same notes, same run records
  { const dir = env.dir(), app = stub.fakeVault(dir, TFile), a = app.vault.adapter, read = a.read, exists = a.exists, runs = path.join(dir, H.automation_status);
    a.exists = async p => (p === H.automation_status ? fs.existsSync(runs) : exists(p));
    a.list = async p => ({ files: fs.readdirSync(path.join(dir, p)).map(f => `${p}/${f}`), folders: [] });
    a.read = async p => (p.startsWith(H.automation_status + "/") ? fs.readFileSync(path.join(dir, p), "utf8") : read(p));
    const p = Object.assign(Object.create(Plugin.prototype), { app, settings: {} });
    const got = await p.hqData(), want = env.hqData();
    for (const k of Object.keys(want)) check(`the plugin reads the same ${k}`, got[k], want[k]);
    check("the plugin reads HQ notes", got.journals.length > 0, true); }

  // 2. the writes, on an in-memory vault
  const day = VGRules.today(), J = `${VGRules.folders.daily}/2026/Journal/${day}.md`, DRAFT = `${H.review_folder}/Draft.md`;
  const files = new Map(), mk = (p, text) => { const f = Object.assign(new TFile(), { path: p, basename: p.split("/").pop().replace(/\.md$/, ""), name: p.split("/").pop(), extension: "md" }); files.set(p, { f, text }); };
  mk(J, "# Today\n\n- [ ]  Ship the fix\n- [ ] Write it up\n- [ ] Changed since\n");
  mk(DRAFT, "---\ntype: review-draft\nstatus: waiting\n---\n# Draft\n\nText.\n");
  const STORY = "Systems/User Stories/Story.md";
  mk(STORY, "---\ntype: user-story\nstatus: planned\nmodified: '2026-03-13'\ntags:\n  - type/user-story\n  - status/done\n---\n# User Story: Story\n");
  const at = p => (files.get(p) || {}).f || null, shared = {};
  const app = { vault: { getAbstractFileByPath: at, read: async f => files.get(f.path).text, cachedRead: async f => files.get(f.path).text,
      process: async (f, fn) => { const e = files.get(f.path); e.text = fn(e.text); return e.text; }, modify: async (f, t) => { files.get(f.path).text = t; },
      adapter: { read: async p => { if (p in shared) return shared[p]; throw new Error("no file"); }, write: async (p, t) => { shared[p] = t; }, exists: async p => p in shared, list: async () => ({ files: [], folders: [] }), mkdir: async () => {} } },
    // Obsidian's frontmatter write, for these notes: read it, change it, write every key back (lists as items)
    fileManager: { processFrontMatter: async (f, fn) => { const e = files.get(f.path), fm = VGRules.frontOf(e.text); fn(fm);
      const yaml = Object.entries(fm).map(([k, v]) => (Array.isArray(v) ? [`${k}:`, ...v.map(x => `  - ${x}`)].join("\n") : `${k}: ${v}`)).join("\n");
      e.text = /^---\n/.test(e.text) ? e.text.replace(/^---\n[\s\S]*?\n---/, `---\n${yaml}\n---`) : `---\n${yaml}\n---\n${e.text}`; } },
    metadataCache: {}, workspace: { getLeavesOfType: () => [] }, loadLocalStorage: () => "test-device", saveLocalStorage() {} };
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { sharedPath: "shared.json" } });
  const line = t => files.get(J).text.split("\n").find(l => l.includes(t));
  await p.setTaskStatus(J, 2, " Ship the fix", "x");
  check("Done checks the task off in its journal and stamps the day", line("Ship the fix"), `- [x]  Ship the fix [${H.completion_field}:: ${day}]`);
  await p.setTaskField(J, 3, "Write it up", H.delegate_field, H.delegate_to);
  check("Delegate adds the field to the task", line("Write it up"), `- [ ] Write it up [${H.delegate_field}:: ${H.delegate_to}]`);
  let refused = false; try { await p.setTaskStatus(J, 4, "Changed since — no", "x"); } catch (e) { refused = e.message === "stale"; }
  check("a task that changed since is refused", [refused, line("Changed since")], [true, "- [ ] Changed since"]);
  await p.setNoteStatus(DRAFT, "rejected", "Wrong customer list");
  check("Reject sets the draft's status and writes the reason", [/status: rejected/.test(files.get(DRAFT).text), files.get(DRAFT).text.trim().endsWith("**Why rejected:** Wrong customer list")], [true, true]);
  // a project's status from its drawer: the status, the updated date and the one status tag the rules give it
  await p.setProjectStatus(STORY, "in-progress");
  const sfm = VGRules.frontOf(files.get(STORY).text);
  check("Set status writes the status, the day and its status tag", [sfm.status, sfm.updated, sfm.tags], ["in-progress", day, ["type/user-story", VGRules.projectStatusTag("in-progress")]]);
  // Done in HQ: checked off in the journal and added to today's standup; without today's standup only the task
  const SU = `${VGRules.folders.daily}/2026/Standups/Daily Standup ${day}.md`, REP = `${VGRules.folders.reports}/${H.reports[0]} ${day}.md`;
  files.get(J).text += "- [ ] Tell Ben\n- [ ] Order parts\n";
  p.app.vault.getMarkdownFiles = () => [...files.values()].map(e => e.f);
  check("Done with no standup today checks off the task only", [await p.completeTask(J, 5, "Tell Ben"), line("Tell Ben")], [false, `- [x] Tell Ben [${H.completion_field}:: ${day}]`]);
  mk(SU, "## 1. Work Completed Today\n\n1. Wrote the scope\n\n---\n\n## 2. Blocks\n");
  check("Done adds the task to today's standup", [await p.completeTask(J, 6, "Order parts"), files.get(SU).text], [true, "## 1. Work Completed Today\n\n1. Wrote the scope\n2. Order parts\n\n---\n\n## 2. Blocks\n"]);
  // the sweep: several tasks in one action; one that changed since is left alone
  files.get(J).text += "- [ ] Old one\n- [ ] Old two\n";
  check("the sweep cancels several at once, skipping one that changed", [await p.setTasksStatus([{ path: J, line: 7, text: "Old one" }, { path: J, line: 8, text: "Changed" }], "-"), line("Old one"), line("Old two")], [1, "- [-] Old one", "- [ ] Old two"]);
  // a report row ticked in HQ: [x] with no stamp, so the gardener reads the row as written
  mk(REP, "# Gaps\n\n- [ ] [[A]] ↔ [[B]] — 0.8\n");
  await p.setTaskStatus(REP, 2, "[[A]] ↔ [[B]] — 0.8", "x");
  check("a report row is ticked without a stamp", files.get(REP).text, "# Gaps\n\n- [x] [[A]] ↔ [[B]] — 0.8\n");

  // marks: Later for today, Done on a plan item, Undo takes one back; marks from another day go
  shared["shared.json"] = JSON.stringify({ v: 1, review: { hq: { "carried|old": "later:2000-01-01" } } });
  await p.hqMark("task|a", "later"); await p.hqMark("plan|b", "done");
  check("marks go in the shared file; yesterday's Later is gone", JSON.parse(shared["shared.json"]).review.hq, { "task|a": `later:${day}`, "plan|b": `done:${day}` });
  await p.hqMark("task|a", null);
  check("Undo takes a mark back", JSON.parse(shared["shared.json"]).review.hq, { "plan|b": `done:${day}` });

  console.log(fails.length ? "FAIL - " + fails.join("\n  ") : "ok - HQ in the plugin: same notes as the rules, Done/Delegate/Reject write the note, marks in the shared file");
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log("FAIL - " + (e && e.stack || e)); process.exit(1); });
