// kit.js - what the tests share, so each one holds only what it checks.
//   const { sleep, checks, finish, openPage, tools } = require("./kit")
//   sleep(ms)
//   const { fails, check, ok, that } = checks()   check(name, got, want) compares as JSON; ok(pass, what) and that(what, pass, detail) want pass true
//   finish(fails, "what passed", "what failed")   prints the result and exits: 1 when anything failed
//   const tab = await openPage({ html, mobile })   a page on a free port (tests/cdp.js). Without Chrome the test says it was skipped and ends
//   const { click, screen, shot } = tools(tab, { wait, shots })   click a selector, go to an HQ screen and wait, screenshot into a folder when shots is set
const fs = require("fs"), path = require("path");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function checks() {
  const fails = [];
  return { fails,
    ok: (pass, what) => { if (!pass) fails.push(what); },
    check: (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); },
    that: (what, pass, detail) => { if (!pass) fails.push(what + (detail ? `\n      ${detail}` : "")); } };
}
function finish(fails, passed, failed) {
  console.log(fails.length ? `FAIL - ${failed ? failed + ":" : ""}\n  ${fails.join("\n  ")}` : `ok - ${passed}`);
  process.exit(fails.length ? 1 : 0);
}
async function openPage(o) {
  const tab = await require("./cdp").open(o);   // here, not at the top: cdp.js uses sleep from this file
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  return tab;
}
function tools(tab, o = {}) {
  return {
    click: sel => tab.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`),
    screen: async s => { await tab.ev(`window.vaultHQ.setScreen(${JSON.stringify(s)})`); await sleep(o.wait === undefined ? 100 : o.wait); },
    shot: async name => { if (!o.shots) return; fs.mkdirSync(o.shots, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(o.shots, `${name}.png`), Buffer.from(r.result.data, "base64")); },
  };
}
module.exports = { sleep, checks, finish, openPage, tools };
