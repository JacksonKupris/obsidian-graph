#!/usr/bin/env node
// The page driver never hangs: a page that crashes fails the waiting request at once (tests/cdp.js), so a broken
// page ends a test with a message instead of stalling npm test.
//   node tests/test_cdp.js        exit 0 = pass
const cdp = require("./cdp");
(async () => {
  const tab = await cdp.open({ html: "<!doctype html><title>t</title><p>page</p>", port: 9338 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [];
  if (await tab.ev("1 + 1") !== 2) fails.push("a plain evaluate didn't answer");
  setTimeout(() => tab.send("Page.crash").catch(() => {}), 500);
  const t0 = Date.now(); let err = null;
  try { await tab.waitFor("window.never || null", 60000); } catch (e) { err = e.message; }
  if (!err) fails.push("waiting on a crashed page returned instead of failing");
  else if (!/crashed/.test(err)) fails.push(`a crashed page failed with "${err}"`);
  if (Date.now() - t0 > 15000) fails.push(`a crashed page took ${Math.round((Date.now() - t0) / 1000)} s to fail`);
  try { await tab.ev("1"); fails.push("a request after the crash was sent"); } catch (e) { /* refused at once */ }
  await tab.close();
  console.log(fails.length ? "FAIL - " + fails.join("; ") : "ok - page driver: a crashed page fails at once");
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log("FAIL - " + e.message); process.exit(1); });
