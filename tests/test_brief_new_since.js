#!/usr/bin/env node
// The waiting-on-you line says how many are new since the last visit (round B of the Home persona rerun).
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
const list = [{ kind: "approval", key: "a", title: "A", group: "needs" }, { kind: "review", key: "r", title: "R", group: "needs" }, { kind: "inbox", key: "i", title: "I", group: "needs" }];
const line = review => VGRules.hqBrief({}, list, review, "2026-10-28", []).find(s => /waiting on you/.test(s));
assert.ok(!/new/.test(line({})), `a first visit has nothing to compare with: ${line({})}`);
assert.ok(/3 waiting on you.*1 new since you were last here/.test(line({ hqVisit: { keys: ["a", "r"] } })), `one item is new: ${line({ hqVisit: { keys: ["a", "r"] } })}`);
assert.ok(!/new/.test(line({ hqVisit: { keys: ["a", "r", "i"] } })), "nothing new, nothing said");
assert.ok(/3 new since you were last here/.test(line({ hqVisit: { keys: [] } })), "all new after an empty visit");
console.log("ok - the brief says how many waiting items are new since the last visit");
// the screen: it compares with the visit before it, then records this one
const { sleep, checks, finish, openPage } = require("./kit");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.__visit = null; window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { state: { review: { hqTour: true, hqVisit: { at: "2026-01-01T00:00:00Z", keys: [] } } }, api: { hqVisit: async k => { window.__visit = k; } } }); })()`);
    await sleep(300);
    const rec = await tab.ev(`JSON.stringify(window.__visit)`), text = await tab.ev(`document.querySelector(".vg-hq").innerText`);
    check(Array.isArray(JSON.parse(rec)), `this visit wasn't recorded (got ${rec})`);
    check(JSON.parse(rec).length === 0 || /\d+ new since you were last here/.test(text), "items waiting but the brief doesn't count the new ones");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "the screen counts new items against the last visit and records this one", "new since last visit");
})();
