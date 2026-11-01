#!/usr/bin/env node
// A note's birth date must not depend on which PC ran the analysis: Linux's st_ctime is the last change, not the creation
// (the reorganization on Ubuntu made 352 notes look a week old), so it counts only on Windows, and a date an earlier run
// found is kept. A month in the note's name counts too. Time-lapse is only as true as these dates.
//   node tests/test_born_date.js        exit 0 = pass
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const fails = [], src = fs.readFileSync(path.join(__dirname, "..", "analysis", "vault_graph.py"), "utf8");
const body = src.slice(src.indexOf("def born_date("), src.indexOf("TIMELINE_WEEKS = "));
if (!/sys\.platform == "win32"/.test(body)) fails.push("st_ctime isn't limited to Windows");
if (!/known_born\(r\)/.test(body)) fails.push("born_date ignores what earlier analyses found");
// name_month on its own, without loading a vault
const fn = src.slice(src.indexOf("MONTH_NAMES = "), src.indexOf("_known_born = None"));
const cases = { "Dispatch Console Release Notes 2025-01": "2025-01-01", "Backup RTI Database April 2025": "2025-04-01", "Sep 2024 review": "2024-09-01", "Notes 2025-13": null, "Kiosk 2025-01-02 log": null, "Plain name": null, "Ticket 2025-01234": null };
const py = `import re, json\n${fn}\nprint(json.dumps({k: name_month(k) for k in ${JSON.stringify(Object.keys(cases))}}))`;
const r = ["python3", "python"].map(c => spawnSync(c, ["-c", py], { encoding: "utf8" })).find(x => x.status === 0);
if (!r) { console.log("  (skipped name_month: no Python)"); }
else { const got = JSON.parse(r.stdout); for (const [k, want] of Object.entries(cases)) if (got[k] !== want) fails.push(`name_month("${k}"): got ${got[k]}, want ${want}`); }
console.log(fails.length ? "FAIL - " + fails.join("; ") : "ok - birth dates: creation time only where it exists, earlier finds kept, months in names count");
process.exit(fails.length ? 1 : 0);
