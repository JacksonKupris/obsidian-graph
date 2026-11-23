#!/usr/bin/env node
// Triage Run's words: the card says the age once (VGRules.triageFrom leaves it out of the source line), Delegate says why
// when it can't be done instead of doing nothing, and the end screen blames what actually went wrong.
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
(async () => {
  const rec = k => `async (...a) => { (window.__calls = window.__calls || []).push(["${k}", ...a]); if (window.__failNext) { window.__failNext = false; throw new Error("the task changed"); } return ${k === "setTasksStatus" ? "a[0].length" : "true"}; }`;
  const stubs = ["completeTask", "setTaskStatus", "setTasksStatus", "hqMark"].map(k => `${k}: ${rec(k)},`).join(" ");   // no setTaskField: Delegate is not offered
  const tab = await openPage({ html: env.pageWith(stubs) });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug", S = `${D}.scenes().triage`, G = `${S}.state`, A = `${S}.api`;
    const from = await tab.ev(`(() => typeof VGRules === "undefined" || !VGRules.triageFrom ? null : VGRules.triageFrom({ kind: "carried", date: "2026-11-18", age: 4, under: "Release" }))()`);
    check(from, "VGRules.triageFrom should exist");
    if (from) check(/2026-11-18/.test(from) && !/\bago\b|days?\b/.test(from), `the source line repeats the age: "${from}"`);
    const task = (key, kind, age, title) => ({ key, kind, age, title, why: "x", path: `J/${key}.md`, line: 3, text: title, ids: [`J/${key}.md`], date: "2026-10-01" });
    await tab.ev(`${D}.setView("triage")`); await sleep(300);
    await tab.ev(`${A}.start(${JSON.stringify([task("a", "carried", 5, "One"), task("b", "carried", 3, "Two")])})`);
    await tab.ev(`void ${A}.swipe("delegate")`); await sleep(250);
    check(/delegat/i.test(await tab.ev(`${G}.said`)), `Delegate that can't run says nothing: "${await tab.ev(G + ".said")}"`);
    check(await tab.ev(`${G}.waiting`) === false && await tab.ev(`${G}.at`) === 0, "Delegate that can't run should leave the card where it was");
    await tab.ev(`(window.__failNext = true, ${A}.swipe("done"))`); await sleep(400);
    check(/changed/i.test(await tab.ev(`${G}.failWhy || ""`)), `a failed write should keep why it failed: "${await tab.ev(G + ".failWhy")}"`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "triage run: age once, Delegate says why, failures say what went wrong", "triage words");
})();
