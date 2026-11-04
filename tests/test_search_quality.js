#!/usr/bin/env node
// Is search finding the right note? Questions the way a person types them, on a real vault, each with what should come up.
// The scores are a floor: a change that makes search worse fails here, however good it looks on one query. It also times
// a search on a vault 10 times the size, so slowness shows before it's felt.
//   node tests/test_search_quality.js --vault [dir]     without a vault there's nothing to measure, and it says so
const { finish } = require("./kit");
const assert = require("assert"), env = require("./env");
if (!env.VAULT) { console.log("ok - search quality: runs on a real vault (--vault)"); process.exit(0); }
const { VGRules, list } = env.notes(), today = VGRules.today();
const FLOOR = { top1: 0.8, top3: 0.9, top10: 0.95, ms: 60 };
const CASES = [
  ["ses suppression", ["SES Suppression"]], ["dispatchers not getting email", ["Dispatchers Group Email", "SES Suppression"]], ["mail bounces", ["SES", "Bounce"]],
  ["how do I restart the console", ["Console Recovery"]], ["console down recovery", ["Console Recovery"]], ["heartbeat check", ["Heartbeat"]],
  ["punch out error", ["Punch", "2026-10-30"]], ["time clock employee missing", ["Punch", "Attendance", "Timesheet", "2026-10-30"]],
  ["paper change", ["Paper"]], ["sticker count", ["Sticker"]], ["stickers running out", ["Sticker", "Paper"]], ["printer jam", ["Printer", "Datamax", "Troubleshooting"]], ["datamax power", ["Datamax"]],
  ["kiosk wont print", ["Print", "Datamax", "Troubleshooting"]], ["hamachi", ["Hamachi"]], ["vpn network kiosk", ["Hamachi", "Network", "Tailscale"]],
  ["mysql upgrade", ["MySQL"]], ["rds backup", ["RDS", "Backup"]], ["database backup", ["Backup"]], ["twilio error", ["Twilio"]], ["texting alerts", ["Twilio", "SMS", "Alert"]],
  ["service alarm", ["Service Alarm"]], ["what did brian decide about aws", ["AWS", "Decision"]], ["inventory receiving", ["Receipt", "Receiving", "Purchase"]], ["return to stock", ["Return"]],
  ["odoo chat pictures", ["ChatPictures", "Chat"]], ["mms", ["MMS"]], ["cvr failure", ["CVR"]], ["plate type", ["Plate"]], ["credit card reader", ["Hardware Troubleshooting", "Tech Support FAQ", "Card"]],
  ["silcone", ["Print Consumption", "Silicone", "Sticker"]], ["suppresion", ["Suppression"]], ["release notes october", ["Release Notes"]], ["kpi dashboard", ["KPI"]], ["route planner", ["Route", "KPI"]],
  ["last week standup", ["Standup"]], ["security incident template", ["Security Incident", "RCA"]], ["ec2 high cpu", ["EC2"]], ["how to file a transaction update", ["Transaction"]],
];
VGRules.recallSearch(list, "warm up", { n: 1, today });   // the index is built once, when notes change; every search after that reads it
const res = CASES.map(([q, want]) => { const t = performance.now(), hits = VGRules.recallSearch(list, q, { n: 10, today }), ms = performance.now() - t;
  return { q, ms, rank: hits.findIndex(h => want.some(w => h.path.toLowerCase().includes(w.toLowerCase()))), top: hits[0] && hits[0].path.split("/").pop() }; });
const share = f => res.filter(f).length / res.length, top1 = share(r => r.rank === 0), top3 = share(r => r.rank >= 0 && r.rank < 3), top10 = share(r => r.rank >= 0), ms = res.reduce((s, r) => s + r.ms, 0) / res.length;
// the same search on ten times the notes
const big = []; for (let i = 0; i < 10; i++) list.forEach(n => big.push({ ...n, path: `copy${i}/${n.path}`, chunks: n.chunks.map(c => c.slice()) }));
const t0 = performance.now(); VGRules.recallSearch(big, "warm up", { n: 1, today }); const built = performance.now() - t0, t1 = performance.now(); ["ses suppression", "how do I restart the console", "stickers running out"].forEach(q => VGRules.recallSearch(big, q, { n: 10, today })); const bigMs = (performance.now() - t1) / 3;
console.log(`  search: right note first ${(top1 * 100).toFixed(0)}%, top 3 ${(top3 * 100).toFixed(0)}%, top 10 ${(top10 * 100).toFixed(0)}%; ${ms.toFixed(0)} ms a search on ${list.length} notes; on ${big.length} notes ${bigMs.toFixed(0)} ms (index ${(built / 1000).toFixed(1)} s)`);
if (process.argv.includes("--show")) res.filter(r => r.rank !== 0).forEach(r => console.log(`  ${r.rank < 0 ? "MISS" : "#" + (r.rank + 1)}  "${r.q}" -> ${r.top}`));
const fails = [];
if (top1 < FLOOR.top1) fails.push(`first ${top1.toFixed(2)} < ${FLOOR.top1}`); if (top3 < FLOOR.top3) fails.push(`top 3 ${top3.toFixed(2)} < ${FLOOR.top3}`); if (top10 < FLOOR.top10) fails.push(`top 10 ${top10.toFixed(2)} < ${FLOOR.top10}`);
if (ms > FLOOR.ms) fails.push(`${ms.toFixed(0)} ms a search`);
finish(fails, "search quality: the right notes, fast", "search quality");
