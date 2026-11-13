#!/usr/bin/env node
// The next-step marker: one rule decides, in a set order, and the chip, the beacon, the dock's dot and the day's loop all say the
// same thing. It moves when the day does. It settles instead of pulsing forever, and it's still there with motion turned off.
// Also snoozing to next week.
//   node tests/test_hq_next.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, openPage, tools } = require("./kit");
const assert = require("assert"), fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env"), { VGRules: R } = env.notes();
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// the rule, in its order
const task = { key: "t", group: "today", kind: "task", title: "Ship it" }, need = { key: "n", group: "needs", kind: "approval", title: "Approve" }, job = { key: "job|x", group: "needs", kind: "job", title: "Nightly backup" }, day = "2026-11-02", focus = { focus: { day, keys: ["t"] } };
const step = o => R.hqNextStep({ day, hour: 9, ...o });
assert.strictEqual(step({ list: [] }).key, "capture", "nothing open: capture");
assert.strictEqual(step({ list: [need] }).key, "needs", "only decisions waiting");
assert.strictEqual(step({ list: [task, need] }).key, "plan", "work to pick from");
assert.strictEqual(step({ list: [task, need], review: focus }).key, "do", "a focus is picked"); assert(/Ship it/.test(step({ list: [task], review: focus }).label));
assert.strictEqual(step({ list: [task], review: { focus: { day: "2026-11-01", keys: ["t"] } } }).key, "plan", "yesterday's focus doesn't count");
assert.strictEqual(step({ list: [task], review: focus, hour: 17, done: 2 }).key, "standup", "the evening with work done"); assert.strictEqual(step({ list: [task], review: focus, hour: 17, done: 2, standup: true }).key, "do", "a standup already started"); assert.strictEqual(step({ list: [task], review: focus, hour: 17, done: 0 }).key, "do", "no work done yet"); assert.strictEqual(step({ list: [task], review: focus, hour: 15, done: 2 }).key, "do", "too early for the standup");
assert.strictEqual(step({ list: [task, job] }).key, "job", "something broken comes first");
assert.strictEqual(step({ list: [task, job], session: { title: "Ship it" }, hour: 17, done: 3 }).key, "session", "a session you're in comes before everything");
// a snoozed item stays away until its day, then comes back
const jp = R.canonicalDailyPath ? `${R.folders.daily}/2026/11-November/Journal/${day}.md` : "j.md";
const hq = { date: day, journals: [{ path: jp, date: day, tasks: [{ mark: " ", text: "Snoozed", line: 1 }] }], standups: [], projects: [], backlog: [], reports: [], reviews: [], decisions: [], runs: {}, runlog: [], inbox: [] };
const open = (mark, today) => R.todayList({ nodes: [], links: [], hq }, { today, review: { hq: mark ? { [`task|${jp}|Snoozed`]: mark } : {} } }).some(i => i.title === "Snoozed");
{ const d = "2026-11-04", at = t => R.parseDay(t, d);   // a Wednesday
  for (const [said, want] of [["tomorrow", "2026-11-05"], ["friday", "2026-11-06"], ["Fri", "2026-11-06"], ["wed", "2026-11-11"], ["next monday", "2026-11-09"], ["next week", "2026-11-09"], ["on tuesday", "2026-11-10"], ["3 days", "2026-11-07"], ["in 2 weeks", "2026-11-18"], ["a month", "2026-12-04"], ["dec 3", "2026-12-03"], ["December 3rd", "2026-12-03"], ["3 dec", "2026-12-03"], ["jan 2", "2027-01-02"], ["nov 4", "2027-11-04"], ["12/25", "2026-12-25"], ["1/2/27", "2027-01-02"], ["2026-12-01", "2026-12-01"]])
    assert.strictEqual(at(said), want, `"${said}"`);
  for (const said of ["", "soon", "sunny", "fr", "feb 31", "13/40", "2026-11-04", "2020-01-01", "0 days", "yesterday"]) assert.strictEqual(at(said), null, `"${said}" isn't a day to come back on`);
  assert.strictEqual(R.parseDay("a month", "2027-01-31"), "2027-02-28", "the end of a month stays in the next one"); }
assert(open(null, day), "the task is listed"); assert(!open("until:2026-11-09", day), "a snooze hides it"); assert(open("until:2026-11-02", day), "it's back on its day");

// from the data alone: the answer the status bar and the graph show
{ const J = `${R.folders.daily}/2026/11-November/Journal/${day}.md`, data = { nodes: [], links: [], hq: { date: day, journals: [{ path: J, date: day, tasks: [{ mark: " ", text: "Ship it", line: 1 }] }], standups: [], projects: [], backlog: [], reports: [], reviews: [], decisions: [], runs: {}, runlog: [], inbox: [] } };
  const at = hour => { const d = new Date(`${day}T12:00:00`); d.setHours(hour); return d; };
  assert.strictEqual(R.hqNextOf(data, { today: day, now: at(9) }).key, "plan"); assert.strictEqual(R.hqNextOf({}, { today: day, now: at(9) }).key, "capture", "no data yet"); assert.strictEqual(R.hqNextOf(data, { today: day, now: at(9), session: { title: "x" } }).key, "session"); }
// the status bar, on the real plugin
{ const stub = require("./plugin_stub"), { Plugin } = stub.load(env.rules), shown = {}, opened = [];
  const data = { nodes: [], links: [] };
  const p = Object.assign(Object.create(Plugin.prototype), { app: { workspace: { getLeavesOfType: () => [] } }, nextEl: { setText: t => { shown.text = t; }, setAttr: (k, v) => { shown[k] = v; } }, graphData: async () => data, loadShared: async () => ({}), openHQ: async () => { opened.push(1); return { view: { handle: { next: () => opened.push("next") } } }; } });
  Promise.resolve().then(async () => { await p.updateNextStep(); assert.strictEqual(shown.text, "Next: Capture what's next", "the status bar's text"); await p.goNextStep(); assert.deepStrictEqual(opened, [1, "next"], "clicking should open HQ and go to the step"); assert(p.viewActions, "the plugin's actions"); })
    .catch(e => { console.log(`FAIL - the status bar: ${e.message}`); process.exit(1); }); }

(async () => {
  // the graph's toolbar names it and leads there
  { const page = await cdp.open({ html: env.pageWith(`goNextStep: async () => { window.__went = true; },`).replace("const DATA =", "const DATA =") });
    if (page) { try { await page.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); const hasHq = await page.ev(`!!window.vaultGraph._debug.rules`);
      await page.ev(`document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`);
      const state = await page.ev(`(() => { const b = document.querySelector(".vg-nextbtn"); return { there: !!b, hidden: b ? b.hidden : null, text: b ? b.textContent : "" }; })()`);
      if (!state.there) { console.log("FAIL - the graph has no next step button"); process.exit(1); }
      if (!state.hidden) { await page.ev(`document.querySelector(".vg-nextbtn").click()`); await sleep(40); if (!(await page.ev(`!!window.__went`))) { console.log("FAIL - the graph's next step does nothing"); process.exit(1); } }
    } finally { await page.close(); } } }
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const shot = name => tools(tab, { shots: SHOTS }).shot(name);
    const size = async (width, mobile = false) => { await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile }); await sleep(120); };
    const screen = s => tools(tab, { wait: 60 }).screen(s);
    const click = sel => tools(tab).click(sel);
    const chip = () => tab.ev(`document.querySelector(".vg-hq-nextchip b").textContent`), marked = () => tab.ev(`[...document.querySelectorAll(".is-nextstep")].length`);
    // a noon clock, so the evening's standup doesn't change what this checks
    let mount = (state = "{}", hour = 12) => tab.ev(`(() => { window.vaultHQ.destroy(); window.__calls = []; const rec = k => async (...a) => { window.__calls.push([k, ...a]); return true; }; const when = new Date(); when.setHours(${hour}, 0, 0, 0); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: when, state: ${state}, ask: async () => true, api: { hqFocus: rec("hqFocus"), hqMark: rec("hqMark"), hqSession: rec("hqSession"), setTaskStatus: rec("setTaskStatus"), completeTask: rec("completeTask"), setTasksStatus: rec("setTasksStatus"), capture: rec("capture"), openNote() {}, openStandup: rec("openStandup"), searchNotes: async () => [] } }); })()`);
    await mount(); await size(1500);
    // something broken comes before the rest of the day, with its beacon on its own row
    const jobs = await tab.ev(`window.vaultHQ.items().filter(i => i.kind === "job").map(i => i.key)`);
    if (jobs.length) { check(/^Check /.test(await chip()), `a failed job should come first: ${await chip()}`); await tab.ev(`document.querySelector("[data-nextstep]").click()`); await sleep(100); check(await tab.ev(`window.vaultHQ.screen()`) === "needs", "the chip should go to Needs you"); check(await tab.ev(`document.querySelector(".is-nextstep") && document.querySelector(".is-nextstep").dataset.key.startsWith("job|")`), "the beacon should be on the job");
      const set = `{ review: { hq: Object.fromEntries(${JSON.stringify(jobs)}.map(k => [k, "later:" + VGRules.localDay(new Date())])) } }`; const again = mount; mount = (state = set, hour = 12) => again(state, hour); await mount(); await size(1500); }
    const hasWork = await tab.ev(`window.vaultHQ.items().some(i => i.group === "today")`);
    // the chip is on every screen, and says one thing everywhere
    const label = await chip(); check(!!label, "no next step named");
    for (const s of ["home", "today", "needs", "people", "projects", "calendar"]) { await screen(s); check((await chip()) === label, `the chip differs on ${s}`); }
    if (hasWork) {
      check(label === "Pick today's focus", `with nothing picked: ${label}`);
      // the marker: off its screen a dot on the dock, on it the beacon on the one control
      await screen("home"); check(await marked() === 0, "the beacon shows where its control isn't"); check(await tab.ev(`!!document.querySelector('.vg-hq-dockbtn[data-go="today"].has-next')`), "the dock doesn't point at the screen");
      await click("[data-nextstep]"); await sleep(120);
      check(await tab.ev(`window.vaultHQ.screen()`) === "today", "the chip doesn't go to the step"); check(await marked() === 1, "there should be one beacon");
      check(await tab.ev(`document.querySelector(".is-nextstep").classList.contains("vg-hq-star")`), "the beacon isn't on the star"); check(!(await tab.ev(`!!document.querySelector(".vg-hq-dockbtn.has-next")`)), "the dock's dot stays when you're there");
      const cs = await tab.ev(`(() => { const c = getComputedStyle(document.querySelector(".is-nextstep")); return { n: c.animationIterationCount, name: c.animationName, ring: c.outlineStyle }; })()`);
      check(cs.name === "vg-ds-beacon" && +cs.n <= 6, `it should settle, not pulse forever: ${JSON.stringify(cs)}`); check(cs.ring === "solid", "after the pulses a ring should stay");
      check(await tab.ev(`document.querySelector(".vg-hq-flow .is-on b").textContent`) === "Plan", "the day's loop disagrees"); await shot("next-plan");
      // starring moves it on, everywhere at once
      await click(".is-nextstep"); await sleep(80);
      check(/^Focus on:/.test(await chip()), `after picking: ${await chip()}`); check(await tab.ev(`document.querySelector(".is-nextstep").hasAttribute("data-session")`), "the beacon should move to Focus"); check(await tab.ev(`document.querySelector(".vg-hq-flow .is-on b").textContent`) === "Do", "the loop should move to Do"); await shot("next-do");
      // starting makes it the session's main button, and leaving leads back
      await click(".is-nextstep"); await sleep(80); check(await tab.ev(`window.vaultHQ.screen()`) === "session", "the beacon's Focus didn't start"); check(/^Back to:/.test(await chip()), `in a session: ${await chip()}`); await shot("next-session");
      await screen("home"); await click("[data-nextstep]"); await sleep(80); check(await tab.ev(`window.vaultHQ.screen()`) === "session", "the chip should lead back to the session");
      await click('[data-sessionctl="end"]'); await sleep(50);
      // the key
      await screen("calendar"); await tab.ev(`document.querySelector(".vg-hq").dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }))`); await sleep(80); check(await tab.ev(`window.vaultHQ.screen()`) === "today", "n doesn't go to the next step");
      // with motion turned off it's still marked
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await mount(); await screen("today"); await sleep(40);
      const still = await tab.ev(`(() => { const c = getComputedStyle(document.querySelector(".is-nextstep")); return { name: c.animationName, ring: c.outlineStyle }; })()`);
      check(still.name === "none" && still.ring === "solid", `reduced motion: ${JSON.stringify(still)}`); await tab.send("Emulation.setEmulatedMedia", { features: [] });
      // snooze: on the hero and in the bar, never on every row
      await mount(); await screen("today"); await size(1500);
      check(await tab.ev(`!!document.querySelector('.vg-hq-next [data-act="nextweek"]')`), "Do next has no Next week"); check(!(await tab.ev(`!!document.querySelector('.vg-hq-sec .vg-hq-item [data-act="nextweek"]')`)), "Next week crowds every row");
      await tab.ev(`window.__calls = []`); const key = await tab.ev(`document.querySelector('.vg-hq-next [data-act="nextweek"]').dataset.key`); await click('.vg-hq-next [data-act="nextweek"]'); await sleep(60);
      const c = (await tab.ev(`window.__calls`)).find(x => x[0] === "hqMark"); check(c && c[1] === key && /^until:\d{4}-\d{2}-\d{2}$/.test(c[2]), `Next week: ${JSON.stringify(c)}`);
      if (c) { const back = new Date(`${c[2].slice(6)}T12:00:00`); check(back.getDay() === 1 && back > new Date(), `should come back on a coming Monday: ${c[2]}`); }
      // the evening: a day's work done and no standup
      const done = `{ review: { hq: { ${jobs.map(k => JSON.stringify(k) + ': "later:" + VGRules.today(), ').join("")}"plan|x.md|1|Finished thing": "done:" + VGRules.today() } } }`; await mount(done, 18); await screen("home");
      // a job that has gone late by evening comes first, by the rule above
      check((await chip()) === "Start today's standup" || /^Check:/.test(await chip()) || await tab.ev(`(DATA.hq.standups || []).some(s => s.date === VGRules.today())`), `in the evening: ${await chip()}`);
    }
    // a narrow pane: the chip has its own line and nothing runs off
    for (const [w, m] of [[390, true], [800, false]]) { await mount(); await size(w, m); await screen("today"); check(await tab.ev(`document.querySelector(".vg-hq").scrollWidth <= document.querySelector(".vg-hq").clientWidth`), `HQ at ${w} runs off the side`); check(await tab.ev(`(() => { const d = document.querySelector(".vg-hq-dock").getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth; })()`), `the dock at ${w} doesn't fit`); if (w === 390) await shot("next-phone"); }
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - next step:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - next step: one rule, chip, beacon, dock and loop agree; it moves with the day, settles, and shows without motion; next week");
  process.exit(0);
})();

// one wording: no surface writes its own "Next: " text
{ const fs = require("fs"), path = require("path"), bad = [];
  for (const d of ["src/plugin", "src/view"]) for (const f of fs.readdirSync(path.join(__dirname, "..", d))) if (f.endsWith(".js") && /`Next: |"Next note"|"No more notes"/.test(fs.readFileSync(path.join(__dirname, "..", d, f), "utf8"))) bad.push(`${d}/${f}`);
  assert.deepStrictEqual(bad, [], "Next wording comes from VGRules.nextView / NEXT_NOTE: " + bad);
  assert.strictEqual(R.nextView({ label: "X" }).text, "Next: X"); }
