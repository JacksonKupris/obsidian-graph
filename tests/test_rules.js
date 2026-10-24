#!/usr/bin/env node
// Regression tests for the shared rulebook (src/rules.js + a rules file) and the code that uses it.
//   node tests/test_rules.js [--vault [dir]]        exit 0 = pass
// 1. the rules themselves; 3. no surface re-grows its own copy of a shared rule (the drift this module ended);
// 4. one action path; 6. note actions, scenes, shared state; the graph data and search on the vault under test.
// (2 and 5, Python parity and the vault's dashboards, are the vault's own tests.)
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const env = require("./env"), S = path.join(env.ROOT, "src");
const PY = process.platform === "win32" ? "python" : "python3";   // Linux has no plain "python"
const R = env.rules;
const VGRules = new Function(`${fs.readFileSync(path.join(S, "rules.js"), "utf8").replace("__RULES_JSON__", JSON.stringify(R))}; return VGRules;`)();
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

check("wormhole open while suggested", VGRules.missionOpen({ kind: "wormhole", a: "a.md", b: "c.md" }, g), true);
check("wormhole closed once linked", VGRules.missionOpen({ kind: "wormhole", a: "a.md", b: "b.md" }, g), false);
check("wormhole dropped when unsuggested", VGRules.missionValid({ kind: "wormhole", a: "b.md", b: "c.md" }, g), false);
check("chart done when topic has a map", VGRules.missionOpen({ kind: "chart", c: 1 }, g), false);
check("chart dropped when topic gone", VGRules.missionValid({ kind: "chart", c: 9 }, g), false);
check("drift needs a topic map", VGRules.missionValid({ kind: "drift", m: "Nav.md" }, g), false);
check("drift progress counts same-name copies", VGRules.missionProgress({ kind: "drift", m: "M.md", baseline: ["q/A.md"] }, g)[0], 1);
check("horizon progress", VGRules.missionProgress({ kind: "horizon", baseline: ["a.md", "c.md"] }, g), [1, 3]);
check("nebula progress", VGRules.missionProgress({ kind: "nebula", baseline: ["a.md", "c.md"] }, g), [1, 3]);

// ---- 3. no private copies of shared rules in the surfaces
const banned = [
  [/RECORD_TAG\s*=/, "record rule (use VGRules.isRecord / isStale)"],
  [/\.members\.includes\(/, "map membership (use VGRules.onMap: it matches same-name copies)"],
  [/\.members\.some\(/, "map membership (use VGRules.onMap)"],
  [/function (questDone|stillValid)\b|const liveDone = q => \{/, "quest/mission rule (use VGRules.questDone / missionValid)"],
  [/find\(\w+ => !\w+\.nav && \w+\.clusters\.includes/, "map-for-cluster (use VGRules.mapForCluster)"],
  [/outlinks \+ 0\.5\)/, "food-web level (use VGRules.trophicLevels)"],
];
for (const f of ["view.js", "plugin.js"]) {
  const src = fs.readFileSync(path.join(S, f), "utf8");
  for (const [re, what] of banned) if (re.test(src)) fails.push(`${f} has its own ${what}`);
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
    const view = fs.readFileSync(path.join(S, "view.js"), "utf8"), plugin = fs.readFileSync(path.join(S, "plugin.js"), "utf8");
    const viewIcons = new Set([...view.slice(0, view.indexOf("const icon = ")).matchAll(/^    ([a-z0-9]+): '/gm)].map(m => m[1]));
    const lucide = new Set([...plugin.match(/const LUCIDE = \{([^}]*)\}/)[1].matchAll(/([a-z]+):/g)].map(m => m[1]));
    VGActions.ACTIONS.forEach(a => { if (!viewIcons.has(a.icon)) fails.push(`action ${a.key}: icon "${a.icon}" missing from the view's ICON set`);
      if (!lucide.has(a.icon)) fails.push(`action ${a.key}: icon "${a.icon}" missing from the plugin's LUCIDE map`); });
    // folder names come from the rules file's "folders" (so the plugin works in another vault): none in code
    const scenes = fs.readdirSync(path.join(S, "scenes")).map(f => [f, fs.readFileSync(path.join(S, "scenes", f), "utf8")]);
    [["view.js", view], ["plugin.js", plugin], ["actions.js", fs.readFileSync(path.join(S, "actions.js"), "utf8")], ...scenes].forEach(([f, t]) =>
      t.split(/\r?\n/).forEach((l, i) => { const code = l.replace(/\/\/.*$/, ""); if (/["'`/(](00-Inbox|01-Daily|04-People|05-Archive|_scripts|_System|_templates|03-Resources)\b/.test(code) || /\$\{[^}]*\}\s*in 00-Inbox/.test(code)) fails.push(`${f}:${i + 1} names a vault folder (use VGRules.folders)`); }));
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
    [["view.js", view], ...scenes.map(([f, t]) => ["scenes/" + f, t])].forEach(([f, t]) => t.split(/\r?\n/).forEach((l, i) => {
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
        entity: [{ when: "stale", as: "gem", motion: "orbit", colour: "#abcdef" }, { when: "else", as: "tower" }], events: [{ verb: "spark", target: "unlinked", every: "tasks" }, { verb: "spar", every: "activity" }] };
      let parsed = null;
      try { parsed = JSON.parse(execFileSync(PY, ["-c", "import sys, json, yaml; print(json.dumps(yaml.safe_load(sys.stdin.read())))"], { input: VGRules.sceneYaml(o), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] })); }
      catch (e) { console.log("  (skipped the scene block round trip: needs Python with PyYAML)"); }
      const back = parsed && VGRules.sceneSpec(parsed);
      if (back) check("a written scene block reads back without errors", back.errors, []);
      if (back) check("a written scene block reads back the same", [back.spec.name, back.spec.place, back.spec.angle, back.spec.wall, back.spec.entity.map(r => [r.when, r.as, r.motion, r.colour]), back.spec.events.map(e => [e.verb, e.target, e.every])],
        ["Night #1: market", "rows", "tilt", "activity", [["stale", "gem", "orbit", "#abcdef"], ["else", "tower", "none", null]], [["spark", "unlinked", "tasks"], ["spar", null, "activity"]]]);
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
