#!/usr/bin/env node
// Triage Run in headless Chrome: the deck is open tasks, oldest first; each move makes the same write as HQ's buttons (Done
// on an old task stays out of the standup, Done today goes through completeTask); a real swipe and a real tap work; Delegate
// asks with the clock stopped and No keeps the card; a failed write earns nothing; the time ends the run; the best is kept.
//   node tests/test_triage.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, openPage } = require("./kit");
const assert = require("assert"), fs = require("fs"), path = require("path"), env = require("./env"), { VGRules: R } = env.notes();
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// the rules
const deck = R.triageDeck([{ kind: "task", key: "t", age: 0 }, { kind: "carried", key: "new", age: 2 }, { kind: "carried", key: "old", age: 40 }, { kind: "plan", key: "p" }, { kind: "carried", key: "given", age: 90, delegated: "claude" }, { kind: "link", key: "l" }]);
assert.deepStrictEqual(deck.map(i => i.key), ["old", "new", "t"], "the deck is undelegated tasks, oldest first");
assert(R.triagePoints(40, 0) > R.triagePoints(2, 0), "an older task should score more");
assert(R.triagePoints(2, 8) > R.triagePoints(2, 0), "a streak should multiply");
assert.strictEqual(R.triagePoints(500, 0), R.triagePoints(120, 0), "age is capped"); assert.strictEqual(R.triagePoints(2, 99), R.triagePoints(2, 16), "the streak is capped");
assert.deepStrictEqual(R.mergeShared({ cosmos: {} }, { cosmos: { triage: { best: 10, bestCombo: 9, runs: 2 } } }, { cosmos: { triage: { best: 30, bestCombo: 1, runs: 5 } } }).cosmos.triage, { best: 30, bestCombo: 9, runs: 5 }, "two devices' bests");

(async () => {
  const rec = k => `async (...a) => { (window.__calls = window.__calls || []).push(["${k}", ...a]); if (window.__failNext) { window.__failNext = false; throw new Error("the task changed"); } return ${k === "setTasksStatus" ? "a[0].length" : "true"}; }`;
  const stubs = ["completeTask", "setTaskStatus", "setTasksStatus", "setTaskField", "hqMark"].map(k => `${k}: ${rec(k)},`).join(" ");
  const tab = await openPage({ html: env.pageWith(stubs) });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug", S = `${D}.scenes().triage`, G = `${S}.state`, A = `${S}.api`;
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const clear = `document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`;
    const frame = async () => { await tab.ev(`${D}.drawNow()`); await sleep(30); };
    const shot = async name => { if (!SHOTS) return; await tab.ev(clear); await frame(); fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };
    await tab.ev(`${clear}; ${D}.setView("triage")`); await sleep(300); await tab.ev(clear); await frame();
    check(await tab.ev(`${G}.state`) === "title", "it doesn't open on its title screen");
    await shot("title");
    const task = (key, kind, age, title) => ({ key, kind, age, title, why: "Daily", path: `J/${key}.md`, line: 3, text: title, ids: [`J/${key}.md`], date: "2026-10-01" });
    const start = list => tab.ev(`(${A}.start(${JSON.stringify(list)}), window.__calls = [], ${G}.score)`);
    const calls = () => tab.ev(`window.__calls || []`), flush = async () => { await sleep(320); await frame(); };   // never waits on the chain itself: a question nobody answered would hang the test
    // each move, through the shared action path
    await start([task("a", "carried", 40, "Old one"), task("b", "task", 0, "Today's one"), task("c", "carried", 9, "Put off"), task("d", "carried", 7, "Drop it"), task("e", "carried", 3, "Last")]);
    await frame(); await shot("card");
    await tab.ev(`${A}.swipe("done")`); await flush();
    let c = await calls();
    check(c.length === 1 && c[0][0] === "setTasksStatus" && c[0][2] === "x", `Done on an old task: ${JSON.stringify(c)}`);
    check(await tab.ev(`${G}.score`) === R.triagePoints(40, 0), "Done didn't score its age");
    await tab.ev(`${A}.swipe("done")`); await flush();
    c = await calls(); check(c.length === 2 && c[1][0] === "completeTask", `Done on today's task should go in the standup: ${JSON.stringify(c[1])}`);
    check(await tab.ev(`${G}.combo`) === 2, "the streak didn't grow");
    const before = await tab.ev(`${G}.score`);
    await tab.ev(`${A}.swipe("later")`); await flush();
    c = await calls(); check(c[2][0] === "hqMark" && c[2][2] === "later", `Later: ${JSON.stringify(c[2])}`);
    check(await tab.ev(`${G}.score`) === before, "Later shouldn't earn points"); check(await tab.ev(`${G}.combo`) === 2, "Later shouldn't break the streak");
    // what a write reports stays in the game's own line, and Undo takes the write back
    check(!(await tab.ev(`[...document.querySelectorAll(".vg-toast, .vg-toasts > *")].some(t => /Later:|Done:/.test(t.textContent))`)), "a swipe's report covers the buttons as a toast");
    check(/^Later:/.test(await tab.ev(`${G}.said`)), "the game's line doesn't say what happened");
    check(await tab.ev(`${G}.undos.length`) === 1, "Later has no Undo in the game");
    await tab.ev(`void ${A}.undo()`); await flush();
    c = await calls(); check(c[3][0] === "hqMark" && c[3][2] === null, `Undo of Later: ${JSON.stringify(c[3])}`); check(await tab.ev(`${G}.undos.length`) === 0, "Undo should use up the entry");
    await tab.ev(`window.__calls = []`);
    await tab.ev(`${A}.swipe("cancel")`); await flush();
    c = await calls(); check(c[0][0] === "setTasksStatus" && c[0][2] === "-", `Cancel: ${JSON.stringify(c[0])}`);
    // a write that fails earns nothing and breaks the streak
    const held = await tab.ev(`${G}.score`);
    await tab.ev(`(window.__failNext = true, ${A}.swipe("done"))`); await flush();
    check(await tab.ev(`${G}.score`) === held && await tab.ev(`${G}.failed`) === 1 && await tab.ev(`${G}.combo`) === 0, "a failed write scored");
    check(await tab.ev(`${G}.state`) === "over", "the last card doesn't end the run");
    check(await tab.ev(`${D}.cos().triage.best`) === held, "the best wasn't kept"); await shot("over");

    // a real swipe and a real tap
    await start([task("s", "carried", 5, "Swiped"), task("t", "carried", 5, "Tapped"), task("u", "carried", 5, "Spare"), task("v", "carried", 5, "Spare two")]); await tab.ev(clear); await frame();
    const r = await tab.ev(`(() => { const b = document.querySelector('.vg-cv').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height * 0.47, w: b.width, h: b.height, left: b.left, top: b.top }; })()`);
    const mouse = (type, x, y, buttons = 1) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
    await mouse("mouseMoved", r.x, r.y, 0); await mouse("mousePressed", r.x, r.y); await mouse("mouseMoved", r.x - 60, r.y); await mouse("mouseMoved", r.x - 130, r.y); await frame(); await shot("dragging"); await mouse("mouseReleased", r.x - 130, r.y, 0); await flush();
    c = await calls(); check(c.length === 1 && c[0][0] === "hqMark", `a real swipe left should be Later: ${JSON.stringify(c)}`);
    await mouse("mousePressed", r.x, r.y); await mouse("mouseMoved", r.x + 20, r.y); await mouse("mouseReleased", r.x + 20, r.y, 0); await flush();
    check((await calls()).length === 1, "a small nudge shouldn't act");
    const tap = await tab.ev(`(() => { const b = ${G}.buttons.find(x => x[0] > innerWidth * 0 && ${G}.buttons.indexOf(x) === 0); return { x: b[0] + b[2] / 2, y: b[1] + b[3] / 2 }; })()`);
    await mouse("mouseMoved", r.left + tap.x, r.top + tap.y, 0); await mouse("mousePressed", r.left + tap.x, r.top + tap.y); await mouse("mouseReleased", r.left + tap.x, r.top + tap.y, 0); await flush();
    check((await calls()).some(x => x[0] === "setTasksStatus" && x[2] === "x"), "tapping Done did nothing");

    // Delegate asks with the clock stopped; No keeps the card, Yes writes the field
    await tab.ev(`(${A}.start(${JSON.stringify([task("g", "task", 0, "Give it away"), task("h", "task", 0, "Next")])}), window.__calls = [])`);
    await tab.ev(`void ${A}.swipe("delegate")`); await sleep(200);   // void: ev waits on a returned promise, and this one waits for the answer
    check(await tab.ev(`${G}.waiting`), "Delegate should stop the clock while it asks");
    const left = await tab.ev(`${G}.left`); await frame(); await frame(); await sleep(150); await frame();
    check(await tab.ev(`${G}.left`) === left, "the clock ran during the question");
    const answer = yes => tab.ev(`(() => { const box = document.querySelector(".vg-confirm"); if (!box) return false; const bs = [...box.querySelectorAll("button")], b = bs.find(x => ${yes} ? !/cancel|no\\b/i.test(x.textContent) : /cancel|no\\b/i.test(x.textContent)); if (b) b.click(); return !!b; })()`);
    if (await answer(false)) { await flush(); check(await tab.ev(`${G}.at`) === 0, "No should keep the card"); check(!(await calls()).length, "No still wrote"); }
    else fails.push("Delegate didn't ask");
    await tab.ev(`void ${A}.swipe("delegate")`); await sleep(200); await answer(true); await flush();
    c = await calls(); check(c.length === 1 && c[0][0] === "setTaskField", `Delegate: ${JSON.stringify(c)}`); check(await tab.ev(`${G}.at`) === 1, "Yes should move on");

    // the clock ends a run; a phone fits
    await tab.ev(`(${G}.left = 0.01)`); await sleep(60); await frame(); await frame();
    check(await tab.ev(`${G}.state`) === "over", "time running out doesn't end the run");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }); await sleep(200);
    check(await tab.ev(`(() => { const c = document.querySelector('.vg-cv'), want = Math.round(c.clientWidth * Math.min(devicePixelRatio, 3)); return Math.abs(c.width - want) <= 1; })()`), "the canvas kept its old pixel size after the screen's density changed");
    await start([task("p", "carried", 12, "A long task title that has to wrap across several lines on a phone without running off the card at all")]); await tab.ev(clear); await frame(); await shot("phone");
    check(await tab.ev(`${G}.buttons.length >= 4 && ${G}.buttons.every(b => b[0] >= 0 && b[0] + b[2] <= document.querySelector('.vg-cv').getBoundingClientRect().width && b[3] >= 44)`), "the four buttons don't fit a phone or are under 44px");
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - triage:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - Triage Run: oldest first, the shared writes, swipes and taps, Delegate asks, failures earn nothing, phone width");
  process.exit(0);
})();
