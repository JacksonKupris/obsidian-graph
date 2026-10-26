#!/usr/bin/env node
// The sample vault the tests run on: a small fictional bike-rental company, generated so every view and lens has
// something to show (topics with and without a map, dailies and standups, people, stale notes, records, duplicates,
// links to notes not written yet, short notes others rely on, tasks, code, a scene block).
//   node fixtures/make_sample.js                     writes fixtures/sample-vault/ (dates relative to today)
//   node fixtures/make_sample.js --analyse [--vault <dir>]
//       also runs this repo's analysis (analysis/*.py) on a copy of it and writes
//       fixtures/sample-graph.json, the graph data the browser tests load
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const OUT = path.join(__dirname, "sample-vault");
const R = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "rules.json"), "utf8"));
const F = R.folders;

// deterministic: the same vault every run (only the dates move with today)
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = xs => xs[Math.floor(rand() * xs.length)];
const DAY = 864e5, TODAY = new Date(new Date().toISOString().slice(0, 10) + "T12:00:00Z");
const iso = d => d.toISOString().slice(0, 10);
const ago = n => iso(new Date(TODAY - n * DAY));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const files = new Map();
const note = (rel, fm, body) => {
  const head = Object.entries(fm).filter(([, v]) => v != null).map(([k, v]) => Array.isArray(v) ? `${k}:\n${v.map(x => `  - ${x}`).join("\n")}` : `${k}: ${v}`).join("\n");
  files.set(rel, (head ? `---\n${head}\n---\n` : "") + body.trim() + "\n");
};
const filler = (topic, n) => Array.from({ length: n }, () => pick([
  `The ${topic} work depends on clear owners and a short list of next steps.`,
  `We agreed to keep the ${topic} notes current after each change, so the team can find the latest decision.`,
  `Most questions about ${topic} come up during the weekly review, and the answers end up here.`,
  `When something in ${topic} breaks, the first check is the last change that went out.`,
  `The ${topic} checklist is short on purpose: anything longer gets skipped under pressure.`,
  `Customers notice ${topic} problems before we do, so support tickets are an early signal.`,
])).join(" ");

// ---- topics: notes link within their topic, a few across
const TOPICS = {
  "Rental App": { dir: "02-Projects/Rental App", tag: "project/rental-app", map: true,
    notes: ["Booking Flow", "Payment Integration", "Push Notifications", "App Store Release", "Offline Mode", "Map Screen", "Login Timeout Bug", "API Design"] },
  "Warehouse": { dir: "02-Projects/Warehouse", tag: "project/warehouse", map: true,
    notes: ["Inventory Counts", "Barcode Scanner Setup", "Stock Transfer Procedure", "Supplier List", "Reorder Rules", "Shelf Layout"] },
  "Infrastructure": { dir: "03-Resources/Infrastructure", tag: "technology/servers", map: true,
    notes: ["Server Backup", "VPN Setup", "Database Upgrade", "Monitoring Alerts", "SSL Certificates", "Disaster Recovery Plan"] },
  "Customer Support": { dir: "03-Resources/Support", tag: "activity/support", map: false,   // no map yet: "draft a map" and the chart mission
    notes: ["Refund Policy", "Ticket Triage", "Common Questions", "Escalation Process", "Support Macros"] },
  // more topics, so a shuffled topic order (Randomize layout) is rarely the same one
  "Fleet Maintenance": { dir: "02-Projects/Fleet", tag: "project/fleet", map: true,
    notes: ["Tyre Checks", "Brake Service Schedule", "Battery Swaps", "Repair Log Template", "Parts Inventory"] },
  "Marketing": { dir: "03-Resources/Marketing", tag: "activity/marketing", map: false,
    notes: ["Spring Campaign", "Newsletter Plan", "Partner Shops", "Social Posts"] },
};
const PEOPLE = ["Ana Lopez", "Ben Carter", "Chloe Kim", "Dev Patel"];
const all = Object.values(TOPICS).flatMap(t => t.notes);
// the last note of most topics hasn't changed in a year, and the dailies don't mention it
const isStale = (topic, i) => i === TOPICS[topic].notes.length - 1 && topic !== "Rental App";
const active = Object.entries(TOPICS).flatMap(([topic, t]) => t.notes.filter((n, i) => !isStale(topic, i)));
const topicOf = n => Object.keys(TOPICS).find(k => TOPICS[k].notes.includes(n));

for (const [topic, t] of Object.entries(TOPICS)) {
  t.notes.forEach((n, i) => {
    const next = t.notes[(i + 1) % t.notes.length], other = t.notes[(i + 2) % t.notes.length];
    const stale = isStale(topic, i);
    const links = [`[[${next}]]`, `[[${other}]]`, i === 0 ? `[[${topic} - Context]]` : null].filter(Boolean);
    const body = `# ${n}\n\n${filler(topic.toLowerCase(), 4)}\n\nSee ${links.join(", ")}.\n\n## Notes\n\n${filler(topic.toLowerCase(), 3)}\n`
      + (i === 1 ? `\n## Tasks\n\n- [ ] Review ${n.toLowerCase()} with ${pick(PEOPLE).split(" ")[0]}\n- [x] Draft the first version [completion:: ${ago(20)}]\n` : "")
      + (stale ? `\n## Tasks\n\n- [ ] Check the ${n.toLowerCase()} still matches what we do\n` : "")   // stale with open tasks: Complete, Cancel, Still current
      + (n === "Database Upgrade" ? "\n```sql\nSELECT id, status FROM rentals WHERE returned_at IS NULL;\n```\n" : "")
      + (n === "Booking Flow" ? "\nThe booking screen is in `booking.js`; payments go through `payments.js`.\n" : "");
    note(`${t.dir}/${n}.md`, { created: stale ? ago(420) : ago(60 + i * 3), updated: stale ? ago(400) : null, tags: [t.tag, i === 0 ? "status/in-progress" : null].filter(Boolean) }, body);
  });
  note(`${t.dir}/../${topic} - Context.md`.replace(/\/[^/]+\/\.\.\//, "/"), { created: ago(90), tags: ["meta/context"] },
    `# ${topic} - Context\n\nWhat ${topic} is, who works on it and where things stand.\n\n${filler(topic.toLowerCase(), 3)}\n\n## People\n\n- [[${PEOPLE[0]}]]\n- [[${PEOPLE[1]}]]\n\n## Notes\n\n${t.notes.slice(0, 3).map(n => `- [[${n}]]`).join("\n")}\n`);
  if (t.map) note(`${t.dir}/${topic} MOC.md`, { created: ago(80), tags: ["type/moc"] },
    `# ${topic} MOC\n\nThe map of ${topic}.\n\n${t.notes.slice(0, -2).map(n => `- [[${n}]]`).join("\n")}\n`);   // two notes left off the map
}
// cross-topic links, so topics have bridges and gaps
note("02-Projects/Rental App/Fleet Dashboard.md", { created: ago(30), tags: ["project/rental-app"] },
  `# Fleet Dashboard\n\nPulls stock from [[Inventory Counts]] and alerts from [[Monitoring Alerts]] into one screen for [[Booking Flow]].\n\n${filler("dashboard", 4)}\n`);

// ---- people
PEOPLE.forEach((p, i) => note(`${F.people}/${p}.md`, { tags: ["meta/people"], type: "person" },
  `# ${p}\n\n${["Mobile developer.", "Warehouse lead.", "Support lead.", "Runs the servers."][i]}\n\nWorks on [[${Object.keys(TOPICS)[i]} - Context]].\n`));
note(`${F.people}/People.md`, { tags: ["meta/people"] }, `# People\n\n${PEOPLE.map(p => `- [[${p}]]`).join("\n")}\n`);

// ---- gaps on purpose
note("03-Resources/Support/Warranty Claims.md", { created: ago(15), tags: ["activity/support"] },   // short, relied on: a stub
  `# Warranty Claims\n\nSee [[Refund Policy]].\n`);
["Refund Policy", "Ticket Triage", "Escalation Process"].forEach(n => files.set(`${TOPICS["Customer Support"].dir}/${n}.md`,
  files.get(`${TOPICS["Customer Support"].dir}/${n}.md`).trimEnd() + `\n\nClaims follow [[Warranty Claims]]. Parts come from the [[Spare Parts Catalogue]].\n`));   // a note not written yet
note("03-Resources/Infrastructure/Backup Restore Test.md", { created: ago(40), tags: ["technology/servers"] },   // near-duplicate wording of Server Backup
  files.get("03-Resources/Infrastructure/Server Backup.md").split("---\n").pop().replace("# Server Backup", "# Backup Restore Test"));
note("05-Archive/Old Rental App/Booking Flow.md", { created: ago(500), tags: ["status/archived"] }, `# Booking Flow\n\nThe first booking flow, replaced in the spring.\n`);   // same name, two folders
note("03-Resources/Warehouse Handbook (duplicate to merge).md", { created: ago(25) }, `# Warehouse Handbook\n\nCopy of [[Shelf Layout]] and [[Reorder Rules]] from the shared drive.\n\n${filler("warehouse", 3)}\n`);
note("03-Resources/Release Notes 2026-03-02.md", { created: ago(230), tags: ["type/release-notes"] }, `# Release Notes 2026-03-02\n\nFixed [[Login Timeout Bug]]. Faster [[Map Screen]].\n`);   // a record, never stale
note("03-Resources/Personal/Cycling Training Plan.md", { created: ago(10) }, `# Cycling Training Plan\n\nThree rides a week, one long. ${filler("training", 3)}\n`);   // unlinked
note(`${F.inbox}/Ideas for the Spring Sale.md`, { created: ago(3) }, `# Ideas for the Spring Sale\n\nBundle helmets with rentals. Ask [[Ana Lopez]].\n`);
note(`${F.scenes}/Night Market (scene).md`, {}, "# Night Market\n\n```vault-graph-scene\nname: Night market\nblurb: Stalls by topic\nplace: rows\nangle: tilt\nentity:\n  - when: stale\n    as: gem\n  - when: else\n    as: tower\n```\n");

// ---- dailies: journals every day, standups on weekdays, for six weeks. The standups' numbered sections are what
// follow-through reads; yesterday's plan shows up as done on most days, so it has every outcome.
let planned = null;
for (let d = 42; d >= 0; d--) {
  const day = new Date(TODAY - d * DAY), date = iso(day), [y, m] = date.split("-"), folder = `${F.daily}/${y}/${m}-${MONTHS[+m - 1]}`;
  const a = pick(active), b = pick(active), who = pick(PEOPLE);
  note(`${folder}/Journal/${date}.md`, { tags: ["daily/journal"] },
    `# ${date}\n\n## Tasks\n\n- [ ] Follow up on ${a} with ${who.split(" ")[0]}\n${d % 3 ? `- [x] Check ${b} [completion:: ${date}]\n` : ""}\n## Notes\n\nTalked with [[${who}]] about [[${a}]] and ${b}.\n`
    + (d % 4 === 1 ? "Worked on the RA_Deposits scope.\n" : ""));   // a scope named in the dailies (HQ's project activity)
  if (day.getUTCDay() % 6) {
    const done = planned && d % 3 ? `2. ${topicOf(planned)}\n   - Finished the ${planned.toLowerCase()} changes\n` : "";
    planned = pick(active);
    note(`${folder}/Standups/Daily Standup ${date}.md`, { tags: ["daily/standup"], "related-projects": [`"[[${topicOf(a)} - Context]]"`], deviation_hours: d % 4 ? 0 : 1 },
      `# Daily Standup ${date}\n\n## 1. Work Completed\n\n1. ${topicOf(a)}\n   - Finished the ${a.toLowerCase()} changes\n   - Reviewed ${b.toLowerCase()} with ${who.split(" ")[0]}\n${done}\n`
      + `## 2. Work Expected Tomorrow\n\n1. Finish the ${planned.toLowerCase()} changes\n2. Start the ${pick(active).toLowerCase()} rollout\n`);
  }
}

// ---- Vault HQ's notes (rules file "hq"): scopes of work in each state, the vault backlog, drafts to review, a
// decision, reports with rows to tick, scheduled jobs' runs (one failed) and the agents' run log
const H = R.hq, SCOPES = [
  ["RA_Deposits", "Card Deposits", "in-progress", ago(2), "Take a card deposit when a bike is booked, released when it comes back.", "- Estimate: 3–5 days"],
  ["RA_GroupBookings", "Group Bookings", "planned", ago(9), "Book several bikes in one go for a group, with one payment.", "## Time estimate\n\nAbout 2 days of work."],
  ["RA_LoyaltyPoints", "Loyalty Points", "proposed", ago(6), "Points for every rental, spent as a discount. Waiting on approval.", ""],
  ["WH_ScannerUpgrade", "Scanner Upgrade", "complete", ago(30), "", ""],
];
SCOPES.forEach(([code, title, status, updated, summary, est]) => note(`02-Projects/Rental App/User Stories/Scope of Work — ${code}.md`,
  { type: H.scope_type, status, created: ago(40), updated, tags: ["project/rental-app"] },
  `# Scope of Work — ${title}\n\n${summary ? `**Summary:** ${summary}\n\n` : ""}## What it is\n\n${summary ? "" : `What ${title.toLowerCase()} changes for the shop and the riders.\n`}\n${est}\n\nSee [[Booking Flow]].\n`));
note(H.backlog, { tags: ["meta/backlog"] }, "# Vault Backlog\n\n- [ ] Decide whether the old warehouse notes move to the archive\n- [ ] Merge the two warehouse handbooks\n- [x] Name the support topic's map\n");
note(`${H.review_folder}/Refund email to riders.md`, { type: H.review_type, status: "waiting", task: "Draft the refund email for riders", created: ago(1) }, "# Refund email to riders\n\nA draft of the email.\n");
note(`${H.review_folder}/Shelf labels.md`, { type: H.review_type, status: "accepted", task: "Shelf label wording", created: ago(8) }, "# Shelf labels\n\nAccepted.\n");
note(`02-Projects/Decisions/Deposits Go Through the Card Reader ${ago(2)}.md`, { type: H.decision_type, date: ago(2), decided_by: `"[[${PEOPLE[0]}]]"`, project: '"[[Scope of Work — RA_Deposits]]"', status: "active" },
  "# Deposits Go Through the Card Reader\n\n**Decision:** deposits are taken on the card reader, not online.\n");
note(`${F.reports}/Gaps & Bridges ${ago(3)}.md`, { tags: ["type/report"] }, "# Gaps & Bridges\n\n- [ ] [[Refund Policy]] ↔ [[Ticket Triage]]\n- [ ] [[Server Backup]] ↔ [[VPN Setup]]\n- [x] [[Booking Flow]] ↔ [[Map Screen]]\n");
note(`${F.reports}/${H.automations[1].report} ${ago(4)}.md`, { tags: ["type/report"] }, "# Cleanup Report\n\nMoved 12 files.\n");
files.set(`${H.automation_status}/office-server.json`, JSON.stringify({ "nightly-backup": { last_run: `${ago(1)}T02:00:00+00:00`, ok: false, exit_code: 1, summary: "disk full", device: "office-server" } }, null, 1) + "\n");
note(`${H.run_log} ${ago(0).slice(0, 7)}.md`, { tags: ["meta/tracking"] }, `# Run Log\n\n- ${ago(1)} · Office PC · Rental App · Wrote the deposits scope · [[Scope of Work — RA_Deposits]]\n- ${ago(0)} · Office PC · Vault · Filed the inbox · ${F.inbox}\n`);

// ---- write
fs.rmSync(OUT, { recursive: true, force: true });
for (const [rel, text] of files) { const p = path.join(OUT, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
console.log(`Wrote ${files.size} notes to ${path.relative(process.cwd(), OUT)}`);

// ---- the graph data: the analysis run on a copy (it writes its own state files, which the fixture leaves out)
if (process.argv.includes("--analyse")) {
  const i = process.argv.indexOf("--vault"), local = path.join(__dirname, "..", "local.json");
  const vault = i > 0 ? process.argv[i + 1] : fs.existsSync(local) ? JSON.parse(fs.readFileSync(local, "utf8")).vault : null;
  if (!vault) { console.error("--analyse needs --vault <dir> (or local.json's vault): the analysis uses that vault's _System/vault_lib.py"); process.exit(2); }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vg-sample-")), "Sample Vault");
  try {
    fs.cpSync(OUT, tmp, { recursive: true });
    const S = path.join(tmp, F.scripts), sys = path.join(tmp, F.system);
    fs.mkdirSync(S, { recursive: true });
    for (const f of fs.readdirSync(path.join(__dirname, "..", "analysis")).filter(f => f.endsWith(".py"))) fs.copyFileSync(path.join(__dirname, "..", "analysis", f), path.join(S, f));   // this repo's analysis
    fs.copyFileSync(path.join(vault, F.system, "vault_lib.py"), path.join(sys, "vault_lib.py"));
    // a small code repo for the Code lens (never this PC's repos): commits over the last weeks to files the notes name
    const code = path.join(path.dirname(tmp), "code"), repo = path.join(code, "rental-app");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    // this PC's git config stays out (commit signing, hooks): the sample repo is the same everywhere. An empty file,
    // not os.devNull: git on Windows can't read \\.\nul as a config file
    const noConfig = path.join(path.dirname(tmp), "empty.gitconfig"); fs.writeFileSync(noConfig, "");
    const git = (args, env = {}) => execFileSync("git", ["-C", repo, "-c", "user.name=Sample", "-c", "user.email=sample@example.com", ...args],
      { stdio: "ignore", env: { ...process.env, GIT_CONFIG_GLOBAL: noConfig, GIT_CONFIG_NOSYSTEM: "1", ...env } });
    git(["init", "-q"]);
    [["src/booking.js", 30], ["src/payments.js", 24], ["src/booking.js", 12], ["src/map.js", 9], ["src/payments.js", 3]].forEach(([f, daysAgo], i) => {
      fs.appendFileSync(path.join(repo, f), `// change ${i}\n`);
      const when = new Date(TODAY - daysAgo * DAY).toISOString();
      git(["add", "-A"]); git(["commit", "-q", "-m", `change ${i}`], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
    });
    fs.writeFileSync(path.join(S, "vault_graph_rules.json"), JSON.stringify({ ...R, code_roots: [code] }, null, 2));
    const py = process.platform === "win32" ? "python" : "python3";
    execFileSync(py, [path.join(S, "vault_graph.py")], { cwd: tmp, stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const data = JSON.parse(fs.readFileSync(path.join(tmp, R.files.data), "utf8"));
    delete data.built;   // which PC ran it
    fs.writeFileSync(path.join(__dirname, "sample-graph.json"), JSON.stringify(data, null, 1) + "\n");
    console.log(`Wrote fixtures/sample-graph.json (${data.nodes.length} notes, ${data.links.length} links, ${data.clusters.length} topics)`);
  } finally { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); }   // the temp copy goes, even when a step fails
}
