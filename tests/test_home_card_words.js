#!/usr/bin/env node
// Persona rerun of Home (0.6.191): each card says what it counts and against what, in words a colleague could repeat and check.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
const { VGRules } = env.notes();
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`);
    await sleep(500);
    const text = await tab.ev(`document.querySelector(".vg-hq").innerText`);
    for (const [bad, why] of [[/off plan/, "'off plan' doesn't say against what"], [/none picked/, "'picked' is undefined"], [/in the dailies/, "'the dailies' is jargon"], [/co-mentions/, "'co-mentions' is jargon"], [/not touched lately/, "'lately' has no cut-off"]])
      check(!bad.test(text), `Home still says ${why}`);
    check(/deviation from plan/.test(text), "the standups card says its hours are deviation from the plan");
    check(/named together in \d+ daily notes?/.test(text) || !/gap between notes/i.test(text),"the gap card says how many daily notes name the pair");
    check(/untouched for over \d+ days/.test(text) || !/much-linked note/.test(text), "the stale card gives its cut-off in days");
    check(/in your daily notes over the last \d+ days/.test(text), "the busiest-topic card says where its mentions are counted");
    check(/Decided [A-Z][a-z]{2} \d+/.test(text), "the decided card gives the decision's date");
    // the brief line: what "planned" means and what to do
    const hq = { journals: [], standups: [], decisions: [], reports: [], inbox: [], jobs: [] };
    const line = VGRules.hqBrief({ nodes: [], hq }, [{ kind: "plan", group: "today", title: "a", key: "k", path: "p", ids: ["p"] }], {}, "2026-11-02", [], 9).map(x => x.text || x).join(" | ");
    check(!/planned for today/.test(line) || /pick one to focus on/.test(line), `the brief's plan line doesn't say what to do: ${line}`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Home cards say what they count and against what", "home card words");
})();
