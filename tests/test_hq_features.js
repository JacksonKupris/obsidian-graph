#!/usr/bin/env node
// HQ's calendar, focus sessions, project board and picking several tasks: each works by mouse and by keyboard, writes only
// through the shared actions, fits a phone, and leaves a way forward when it's empty.
//   node tests/test_hq_features.js [--vault [dir]] [--shots dir]        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env"), { VGRules: R } = env.notes();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// rules
const D = "2026-10", J = { hq: { journals: [{ path: "j.md", date: "2026-10-05", tasks: [{ mark: "x", text: "A ✅ 2026-10-05" }, { mark: "x", text: "B ✅ 2026-10-05" }, { mark: "x", text: "C ✅ 2026-10-20" }, { mark: " ", text: "D" }] }], standups: [{ path: "s.md", date: "2026-10-20" }] } };
const cal = R.hqCalendar(J, {}, D);
assert.strictEqual(cal.days.length, 31); assert.strictEqual(cal.lead, 3, "October 2026 starts on a Thursday"); assert.strictEqual(cal.total, 3); assert.strictEqual(cal.worked, 2); assert.strictEqual(cal.peak, 2); assert.strictEqual(cal.busiest.date, "2026-10-05");
assert.strictEqual(cal.days[4].journal, true); assert.strictEqual(cal.days[19].standup, true); assert.strictEqual(R.hqCalendar({}, {}, "2024-02").days.length, 29, "a leap February");
assert.strictEqual(R.monthShift("2026-12", 1), "2027-01"); assert.strictEqual(R.monthShift("2026-01", -1), "2025-12");
assert.strictEqual(R.sessionMinutes({ sessions: { d: 5 } }, "d"), 5); assert.strictEqual(R.sessionMinutes({}, "d"), 0);
assert.deepStrictEqual(R.sessionAdded({ sessions: { d: 5 } }, "d", 3), { d: 8 }, "minutes add up");
assert.strictEqual(Object.keys(R.sessionAdded({ sessions: Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`2026-01-${i}`, 1])) }, "2027-01-01", 1)).length, 60, "old days fall away"); assert("2027-01-01" in R.sessionAdded({}, "2027-01-01", 1));
assert.strictEqual(R.minutesWords(45), "45m"); assert.strictEqual(R.minutesWords(60), "1h"); assert.strictEqual(R.minutesWords(95), "1h 35m");
assert.deepStrictEqual(R.mergeShared({ review: {} }, { review: { sessions: { d: 20, e: 1 } } }, { review: { sessions: { d: 30 } } }).review.sessions, { d: 30, e: 1 }, "two devices' time");
R.BOARD_GROUPS.forEach(g => { const s = R.statusForGroup(g); if (s) assert.strictEqual(R.statusGroup(s), g, `${s} isn't in ${g}`); });
assert.strictEqual(R.statusForGroup("nowhere"), null);

(async () => {
  const tab = await cdp.open({ html: env.hqPage(""), port: 9371 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const rec = (k, ret) => `${k}: async (...a) => { window.__calls.push(["${k}", ...a]); return ${ret}; }`;
    const API = ["setTaskStatus", "completeTask", "setTaskField", "setNoteStatus", "setProjectStatus", "hqMark", "hqFocus", "hqSession", "logWork"].map(k => rec(k, k === "setProjectStatus" ? "0" : "true")).join(", ");
    const mount = () => tab.ev(`(() => { window.__calls = []; window.vaultHQ.destroy(); window.__calls = []; window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { state: {}, ask: async () => true, api: { ${API}, setTasksStatus: async (rows, s) => { window.__calls.push(["setTasksStatus", rows.length, s]); return rows.length; }, openNote: p => window.__calls.push(["open", p]), openDaily: async d => window.__calls.push(["daily", d]), openStandup: async d => window.__calls.push(["standup", d]), searchNotes: async () => [] } }); })()`);
    const calls = () => tab.ev(`window.__calls`), size = async (width, mobile = false) => { await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile }); await sleep(120); };
    const screen = async s => { await tab.ev(`window.vaultHQ.setScreen("${s}")`); await sleep(60); };
    const click = sel => tab.ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
    const shot = async name => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
    const key = (k, o = "{}") => tab.ev(`document.querySelector(".vg-hq").dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, ...${o} }))`);
    await mount(); await size(1500); await screen("today");

    // ---- Calendar
    await click('[aria-label="Calendar"]'); await sleep(60);
    check(await tab.ev(`window.vaultHQ.screen()`) === "calendar", "the dock doesn't open the Calendar");
    check(await tab.ev(`document.querySelectorAll(".vg-hq-calday").length`) >= 28, "the calendar has no days");
    check(await tab.ev(`!!document.querySelector(".vg-hq-calday.is-today.is-picked") && !!document.querySelector(".vg-hq-calpanel h2")`), "today isn't picked on opening"); await shot("calendar");
    const month = await tab.ev(`document.querySelector(".vg-hq-calbar b").textContent`);
    await click('[data-calmonth="-1"]'); await sleep(40); check((await tab.ev(`document.querySelector(".vg-hq-calbar b").textContent`)) !== month, "Previous month did nothing");
    check(await tab.ev(`!!document.querySelector('[data-calmonth="0"]')`), "no way back to this month"); await click('[data-calmonth="0"]'); await sleep(40); check((await tab.ev(`document.querySelector(".vg-hq-calbar b").textContent`)) === month, "This month didn't come back");
    await click(".vg-hq-calday"); await sleep(40); check(await tab.ev(`document.querySelector(".vg-hq-calday").classList.contains("is-picked")`), "picking a day did nothing");
    await key("6"); await sleep(40); check(await tab.ev(`window.vaultHQ.screen()`) === "calendar", "key 6 isn't the Calendar");

    // ---- Focus session
    await screen("today");
    const hasItem = await tab.ev(`window.vaultHQ.items().some(i => i.group === "today")`);
    if (hasItem) {
      await click(".vg-hq-next [data-session]"); await sleep(60);
      check(await tab.ev(`window.vaultHQ.screen()`) === "session", "Focus doesn't open a session");
      const first = await tab.ev(`window.vaultHQ.session().key`); check(!!first, "no session started");
      check(await tab.ev(`/^\\d+:\\d\\d$/.test(document.querySelector(".vg-hq-timer b").textContent)`), "no clock"); await shot("session");
      // it keeps time on its own, without redrawing the screen
      const node = await tab.ev(`(window.__t = document.querySelector(".vg-hq-timer b"), window.__t.textContent)`); await tab.ev(`(window.vaultHQ.session().since -= 5000, 0)`); await sleep(1200);
      check((await tab.ev(`window.__t.textContent`)) !== node, "the clock doesn't tick"); check(await tab.ev(`window.__t.isConnected`), "the tick rebuilt the screen");
      // pause holds the time
      await click('[data-sessionctl="pause"]'); await sleep(40); const held = await tab.ev(`document.querySelector(".vg-hq-timer b").textContent`); await sleep(1200); check((await tab.ev(`document.querySelector(".vg-hq-timer b").textContent`)) === held, "Pause doesn't hold the clock");
      check(await tab.ev(`document.querySelector('[data-sessionctl="pause"]').textContent`) === "Resume", "Pause doesn't offer Resume"); await key("p"); await sleep(40); check(await tab.ev(`!!window.vaultHQ.session().since`), "p doesn't resume");
      // length changes the clock
      await click('[data-sesslen="45"]'); await sleep(30); check(await tab.ev(`window.vaultHQ.session().length`) === 45, "the length didn't change");
      // going elsewhere keeps it, and the loop line says so and leads back
      await screen("home"); check(await tab.ev(`!!window.vaultHQ.session()`), "leaving ended the session");
      check(/^On|^Paused/.test(await tab.ev(`(document.querySelector('.vg-hq-flow [data-go="session"] small') || {}).textContent || ""`)), "the loop line doesn't show the session"); await click('.vg-hq-flow [data-go="session"]'); await sleep(30); check(await tab.ev(`window.vaultHQ.screen()`) === "session", "the loop line doesn't lead back");
      // time past the length is marked, once
      await tab.ev(`(window.vaultHQ.session().since -= 46 * 60000, 0)`); await sleep(1150); check(await tab.ev(`document.querySelector(".vg-hq-timer b").textContent.startsWith("+")`), "time past the length isn't shown as over"); check(await tab.ev(`!!document.querySelector(".vg-hq-timer.is-over")`), "over isn't marked");
      // Done writes, logs the minutes and moves on
      await tab.ev(`window.__calls = []`); const was = await tab.ev(`window.vaultHQ.session().key`);
      const upNext = await tab.ev(`!!document.querySelector('[data-sessionctl="next"]')`);
      await click('.vg-hq-session-acts [data-act="main"]'); await sleep(200);
      const c = await calls(); check(c.some(x => x[0] === "hqSession" && x[2] >= 46), `the minutes weren't logged: ${JSON.stringify(c)}`);
      if (upNext) check((await tab.ev(`(window.vaultHQ.session() || {}).key`)) !== was, "Done didn't move to the next item");
      await screen("wrap"); check(/focused/.test(await tab.ev(`document.querySelector(".vg-hq-main").textContent`)), "Wrap up doesn't show the time"); await screen("session");
      if (await tab.ev(`!!window.vaultHQ.session()`)) { await click('[data-sessionctl="end"]'); await sleep(50); check(await tab.ev(`!window.vaultHQ.session() && window.vaultHQ.screen() === "today"`), "End session didn't end it"); }
    }
    // a session with nothing to do has a way forward
    await tab.ev(`(() => { window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), { nodes: [], links: [] }, { api: {} }); })()`); await screen("session");
    check(await tab.ev(`!!document.querySelector(".vg-hq-empty button")`), "an empty session is a dead end"); await screen("calendar"); check(await tab.ev(`document.querySelectorAll(".vg-hq-calday").length`) >= 28, "the calendar needs data to draw"); await screen("projects");
    await mount(); await screen("today");

    // ---- picking several
    const boxes = await tab.ev(`document.querySelectorAll("[data-pick]").length`);
    if (boxes >= 2) {
      check(!(await tab.ev(`!!document.querySelector(".vg-hq-bulk")`)), "the bar shows with nothing picked");
      const pick = (i, o = "{}") => tab.ev(`document.querySelectorAll("[data-pick]")[${i}].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...${o} }))`);
      const y0 = await tab.ev(`document.querySelectorAll("[data-pick]")[1].getBoundingClientRect().top`);
      await pick(0); await sleep(30); check(await tab.ev(`/1 task/.test(document.querySelector(".vg-hq-bulk b").textContent)`), "one tick doesn't show in the bar"); await shot("bulk");
      check((await tab.ev(`document.querySelectorAll("[data-pick]")[1].getBoundingClientRect().top`)) === y0, "ticking a row moved the next row");
      check(await tab.ev(`document.querySelector("[data-pick]").checked`), "the box doesn't stay ticked after the redraw");
      if (boxes >= 3) { await pick(2, "{ shiftKey: true }"); await sleep(30); check(/3 tasks/.test(await tab.ev(`document.querySelector(".vg-hq-bulk b").textContent`)), "shift doesn't pick the run between"); }
      await key("Escape"); await sleep(30); check(!(await tab.ev(`!!document.querySelector(".vg-hq-bulk")`)), "Escape doesn't clear the selection");
      await pick(0); await sleep(30); await tab.ev(`window.__calls = []`); const n0 = await tab.ev(`window.vaultHQ.items().length`), k0 = await tab.ev(`document.querySelector("[data-pick]").dataset.pick`);
      await click('[data-bulk="later"]'); await sleep(80); let c2 = await calls(); check(c2.some(x => x[0] === "hqMark" && x[1] === k0 && x[2] === "later"), `Later on a selection: ${JSON.stringify(c2)}`); check((await tab.ev(`window.vaultHQ.items().length`)) === n0 - 1, "a selected Later stays listed");
      await tab.ev(`document.querySelector(".vg-hq-toast [data-undo]").click()`); await sleep(80); c2 = await calls(); check(c2.some(x => x[0] === "hqMark" && x[1] === k0 && x[2] === null), "Undo of a selected Later"); check((await tab.ev(`window.vaultHQ.items().length`)) === n0, "Undo didn't bring it back");
      // a plan item has no checkbox line: Done and Later work, Cancel isn't offered
      const planAt = await tab.ev(`[...document.querySelectorAll("[data-pick]")].findIndex(b => b.dataset.pick.startsWith("plan|"))`), taskAt = await tab.ev(`[...document.querySelectorAll("[data-pick]")].findIndex(b => /^(task|carried)\\|/.test(b.dataset.pick))`);
      if (planAt >= 0) { await pick(planAt); await sleep(30); check(!(await tab.ev(`!!document.querySelector('[data-bulk="-"]')`)), "Cancel is offered on a plan item"); check(await tab.ev(`!!document.querySelector('[data-bulk="later"]')`), "Later isn't offered on a plan item"); await click('[data-bulk="clear"]'); await sleep(30); }
      if (taskAt >= 0) { await pick(taskAt); await sleep(30); await tab.ev(`window.__calls = []`); await click('[data-bulk="-"]'); await sleep(80); check((await calls()).some(x => x[0] === "setTasksStatus" && x[1] === 1 && x[2] === "-"), "Cancel on a selection should be one shared batch"); check(!(await tab.ev(`!!document.querySelector(".vg-hq-bulk")`)), "the bar stays after acting"); }
    }
    await mount();

    // ---- the board
    await screen("projects");
    check(await tab.ev(`!!document.querySelector("[data-board]")`), "no Board control"); await click("[data-board]"); await sleep(50);
    check(await tab.ev(`document.querySelectorAll("[data-column]").length`) >= 4, "the board has no columns");
    check(!(await tab.ev(`!!document.querySelector('[data-project-filter="status"]')`)), "the board shouldn't filter by status: its columns are the statuses");
    const total = await tab.ev(`window.__t = [...document.querySelectorAll("[data-column] h3 span")].reduce((a, s) => a + +s.textContent, 0)`), every = await tab.ev(`DATA.hq.projects.length`); check(total === every, `the board holds ${total} of ${every} projects`); await shot("board");
    if (await tab.ev(`!!document.querySelector("[data-pmove]")`)) {
      const arrow = await tab.ev(`(() => { const b = document.querySelector('[data-pmove]'); return { path: b.dataset.path, to: b.dataset.pmove }; })()`);
      await tab.ev(`window.__calls = []`); await click("[data-pmove]"); await sleep(80); const c3 = await calls();
      check(c3.some(x => x[0] === "setProjectStatus" && x[1] === arrow.path && x[2] === R.statusForGroup(arrow.to)), `an arrow should set the column's status: ${JSON.stringify(c3)}`);
      check(await tab.ev(`!!document.querySelector('[data-column="${arrow.to}"] [data-card="${arrow.path.replace(/"/g, '\\"')}"]')`), "the card didn't move to its column");
      // a real drag across columns
      const drag = await tab.ev(`(() => { const c = document.querySelector("[data-card]"), from = c.closest("[data-column]").dataset.column, to = [...document.querySelectorAll("[data-column]")].find(x => x.dataset.column !== from && x.dataset.column !== "other"), dt = new DataTransfer(), fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); window.__calls = []; fire(c, "dragstart"); fire(to, "dragover"); const lit = to.classList.contains("is-drop"); fire(to, "drop"); fire(c, "dragend"); return { path: c.dataset.card, to: to.dataset.column, lit }; })()`); await sleep(80);
      check(drag.lit, "a column doesn't light up under a drag"); check((await calls()).some(x => x[0] === "setProjectStatus" && x[1] === drag.path && x[2] === R.statusForGroup(drag.to)), "a drop didn't set the status");
    }
    check(await tab.ev(`!!document.querySelector("[data-card] [data-proj]")`), "a card doesn't open its project"); await click("[data-card] [data-proj]"); await sleep(50); check(await tab.ev(`!!document.querySelector(".vg-hq-drawer")`), "a card's title should open the drawer"); await key("Escape"); await sleep(30);
    await click("[data-board]"); await sleep(30); check(await tab.ev(`!!document.querySelector(".vg-hq-grid, .vg-hq-empty")`), "Board doesn't toggle back");

    // ---- every width
    for (const [w, m] of [[390, true], [800, false], [1500, false]]) { await size(w, m);
      for (const s of ["calendar", "session"]) { await screen(s); check(await tab.ev(`document.querySelector(".vg-hq-main").scrollWidth <= document.querySelector(".vg-hq-main").clientWidth + 1`), `${s} at ${w} runs off the side`); }
      await screen("calendar"); if (w === 390) await shot("calendar-phone");
      await screen("projects"); await click("[data-board]"); await sleep(30); check(await tab.ev(`document.documentElement.scrollWidth <= innerWidth`), `the board at ${w} scrolls the whole page sideways`); if (w === 390) await shot("board-phone"); await click("[data-board]"); await sleep(20); }
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - HQ features:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - HQ features: calendar, focus sessions, picking several, the board; mouse and keys, shared writes, three widths");
  process.exit(0);
})();
