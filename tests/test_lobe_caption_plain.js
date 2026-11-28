#!/usr/bin/env node
// Neural lobe captions say what "active" and "stale" mean: edited in the last 7 days, and not edited in N days
// (explainer persona, 0.6.249: "12 active · 40% stale" with no day limit). The How to read this entry gives the day limit too.
//   node tests/test_lobe_caption_plain.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const data = env.data(), days = (data.quality || {}).stale_days || 180;
  const tab = await openPage({ html: env.pageWith("", data), mobile: false });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(1500);
    await tab.ev(`${D}.openView("neural")`); await sleep(1500);
    const lines = await tab.ev(`window.vaultGraph._debug.topicReadouts ? window.vaultGraph._debug.topicReadouts() : null`);
    check(Array.isArray(lines) && lines.length > 0, "the debug hook lists the lobe captions (the test can't fail without them)");
    (lines || []).forEach(t => { check(/this week/.test(t) && !/\bactive\b/.test(t), "a caption says 'this week', not a bare 'active': " + t); check(t.includes(`stale (${days}d+)`), `a caption carries the ${days}-day limit: ` + t); });
  } finally { await tab.close(); }
  finish(fails, "lobe captions say what active and stale mean");
})().catch(e => { console.error(e); process.exit(1); });
