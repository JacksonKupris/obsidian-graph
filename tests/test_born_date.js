#!/usr/bin/env node
// A note's birth date must not depend on which PC worked it out. It's the earliest of what the note says and when it was made, and a
// date an earlier run found is kept, so a run on a PC with worse file dates can't lose it (the reorganization on Ubuntu once made
// 352 notes look a week old). A month in the note's name counts too. Time-lapse is only as true as these dates.
//   node tests/test_born_date.js        exit 0 = pass
const env = require("./env"), stub = require("./plugin_stub");
const { VGRules: R } = stub.load(env.rules), fails = [], check = (name, got, want) => { if (got !== want) fails.push(`${name}: got ${got}, want ${want}`); };
for (const [name, want] of Object.entries({ "Dispatch Console Release Notes 2025-01": "2025-01-01", "Backup RTI Database April 2025": "2025-04-01", "Sep 2024 review": "2024-09-01", "Notes 2025-13": "2026-06-01", "Kiosk 2025-01-02": "2025-01-02" })) check(`a date in "${name}"`, R.bornDate(name, null, "2026-06-01"), want);
check("created wins when it's earliest", R.bornDate("Note", "2020-02-03T10:00:00", "2026-06-01"), "2020-02-03");
check("the file's date when that's all there is", R.bornDate("Note", null, "2026-06-01"), "2026-06-01");
console.log(fails.length ? "FAIL - " + fails.join("; ") : "ok - birth dates: the earliest the note gives, months in names count");
process.exit(fails.length ? 1 : 0);
