#!/usr/bin/env node
// Vault Survivors and Wikirace in headless Chrome. Survivors: every note can be an enemy of the Dungeon's kind, the gun fires
// itself, tags choose upgrades that take effect, bosses arrive on the minute, you can die and you can win. Wikirace: the route
// is the same all day and matchable for free; hubs and traps cost what they say; winning scores and keeps a streak.
// Neither writes to a note: the page's writes are recording stand-ins, and none may be called.
//   node tests/test_play.js [--vault [dir]] [--shots dir]        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env"), { VGRules: R } = env.notes();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// the shared enemy rules
const s = R.foeStats([{ words: 10 }, { words: 100 }, { words: 1000 }, { words: 5000, inlinks: 40 }]);
assert.strictEqual(R.foeKind({ person: true }, s), "hunter"); assert.strictEqual(R.foeKind({ moc: true }, s), "brute"); assert.strictEqual(R.foeKind({ isolated: true, words: 500 }, s), "wisp");
assert(R.FOE_KINDS.boss.hp > R.FOE_KINDS.wisp.hp);
// the route: a chain a-b-c-d-e with a hub h beside everything
const chain = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["h", "a"], ["h", "e"]];
const r1 = R.wikiraceRoute(chain, "2026-11-02", { avoid: new Set(["h"]) }), r2 = R.wikiraceRoute(chain, "2026-11-02", { avoid: new Set(["h"]) });
assert.deepStrictEqual(r1, r2, "the route should be the same all day"); assert(r1.par >= 3, "a route should be at least three hops");
assert(r1.from !== "h" && r1.to !== "h", "a hub shouldn't be an end of the route");
const days = new Set(Array.from({ length: 30 }, (_, i) => { const r = R.wikiraceRoute(chain, `2026-11-${String(i + 1).padStart(2, "0")}`, { avoid: new Set(["h"]) }); return r.from + r.to; }));
assert(days.size > 1, "the route should change from day to day");
assert.strictEqual(R.wikiraceRoute([["a", "b"]], "2026-11-02"), null, "no route is too short");
assert.strictEqual(R.wikiraceScore({ hops: 3, par: 3 }), 1000); assert.strictEqual(R.wikiraceScore({ hops: 5, par: 3, hubs: 1, traps: 1, seconds: 10 }), 1000 - 200 - 50 - 75 - 10); assert.strictEqual(R.wikiraceScore({ hops: 99, par: 3 }), 0, "a score isn't negative");
// two devices
const m = R.mergeShared({ cosmos: {} }, { cosmos: { survivors: { best: 5, wins: 2 }, wikirace: { day: "2026-11-02", today: 500, best: 900, streak: 3 } } }, { cosmos: { survivors: { best: 9, longest: 40 }, wikirace: { day: "2026-11-02", today: 800, best: 800, streak: 2 } } }).cosmos;
assert.deepStrictEqual(m.survivors, { best: 9, longest: 40, wins: 2, runs: 0 }); assert.deepStrictEqual(m.wikirace, { day: "2026-11-02", today: 800, best: 900, streak: 3 });
assert.strictEqual(R.mergeShared({ cosmos: {} }, { cosmos: { wikirace: { day: "2026-11-01", today: 900, best: 900, streak: 8 } } }, { cosmos: { wikirace: { day: "2026-11-02", today: 100, best: 100, streak: 1 } } }).cosmos.wikirace.today, 100, "a later day's result should win");

(async () => {
  const WRITES = ["linkNotes", "writeNote", "appendSection", "moveNote", "setTaskStatus", "setTasksStatus", "completeTask", "setTaskField", "setNoteStatus", "stampReviewed", "hqMark"];
  const stubs = WRITES.map(k => `${k}: async (...a) => { (window.__writes = window.__writes || []).push("${k}"); return true; },`).join(" ");
  const tab = await cdp.open({ html: env.pageWith(stubs), port: 9370 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug", clear = `document.querySelectorAll('.vg-tour, .vg-tour-card').forEach(x => x.remove())`;
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const frame = async () => { await tab.ev(`${D}.drawNow()`); await sleep(30); };
    const shot = async name => { if (!SHOTS) return; await tab.ev(clear); await frame(); fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };

    // ---- Survivors
    const SV = `${D}.scenes().survivors`, G = `${SV}.state`, A = `${SV}.api`;
    await tab.ev(`${clear}; ${D}.setView("survivors")`); await sleep(300); await tab.ev(clear); await frame();
    check(await tab.ev(`${G}.state`) === "title", "Survivors doesn't open on its title"); await shot("survivors-title");
    await tab.ev(`${A}.start()`); await frame();
    const run = (sec, dt = 0.05) => tab.ev(`(() => { for (let i = 0; i < ${Math.round(sec / dt)} && ${G}.state === "play"; i++) ${A}.step(${dt}); return ${G}.state; })()`);
    await run(6); check(await tab.ev(`${G}.foes.length`) > 0, "no notes came");
    const kinds = await tab.ev(`${G}.foes.every(f => !!${D}.rules.FOE_KINDS[f.kind] && f.n && !f.n.ghost)`); check(kinds, "a foe isn't a note of the Dungeon's kinds");
    await tab.ev(`(${G}.me.hp = 1e6, ${G}.me.maxHp = 1e6)`);   // keep it alive for the checks below
    await run(30); check(await tab.ev(`${G}.kills`) > 0 || await tab.ev(`${G}.state`) === "choose", "the gun doesn't fire itself");
    // tags choose the upgrades, and one takes effect
    await tab.ev(`(${G}.tags = new Map([["technology/mysql", 9], ["project/odoo", 2]]), ${G}.state = "play")`);
    const choices = await tab.ev(`${A}.choices()`);
    check(choices.length === 3, "there should be three upgrades"); check(choices[0].ns === "technology" && choices[0].from === "technology/mysql", `the top tag should lead: ${JSON.stringify(choices[0])}`); check(choices.some(c => c.ns === "health"), "there should always be a way to heal");
    const rate = await tab.ev(`${G}.me.rate`);
    await tab.ev(`(${G}.choices = ${A}.choices(), ${G}.state = "choose", ${A}.choose(0))`);
    check(await tab.ev(`${G}.me.rate`) < rate, "Faster fire changed nothing"); check(await tab.ev(`${G}.state`) === "play", "choosing should go back to the game");
    // the clock waits for a choice
    await tab.ev(`(${G}.choices = ${A}.choices(), ${G}.state = "choose")`); const t0 = await tab.ev(`${G}.t`); await tab.ev(`${A}.step(5)`); check(await tab.ev(`${G}.t`) === t0, "the clock ran during a choice"); await frame(); await shot("survivors-choose");
    await tab.ev(`${A}.choose(0)`);
    // a boss on the minute
    await tab.ev(`(${G}.foes = [], ${G}.t = 59.9, ${G}.bossAt = 60, ${A}.step(0.2))`);
    check(await tab.ev(`${G}.foes.some(f => f.kind === "boss")`), "no boss on the minute"); await run(0.5); await frame(); await shot("survivors-play");
    // tags fall from a killed note and count when picked up
    await tab.ev(`(() => { ${G}.state = "play"; ${G}.xp = 0; ${G}.foes = []; ${G}.gems = [{ x: ${G}.me.x, y: ${G}.me.y, value: 0, tags: ["project/x"] }]; ${G}.tags = new Map(); ${A}.step(0.01); })()`);
    check(await tab.ev(`${G}.tags.get("project/x")`) === 1, "a picked-up tag didn't count");
    // you can die, and you can win; the best is kept
    await tab.ev(`(${G}.state = "play", ${G}.xp = 0, ${G}.gems = [], ${G}.me.hp = 1, ${G}.me.maxHp = 100, ${G}.me.hurt = 0, ${G}.foes = [], ${A}.add(${D}.nodes.find(n => !n.ghost)), ${G}.foes[0].x = ${G}.me.x, ${G}.foes[0].y = ${G}.me.y, ${G}.foes[0].hp = 1e6, ${A}.step(0.01))`);
    check(await tab.ev(`${G}.state`) === "over" && await tab.ev(`!${G}.won`), "a hit at 1 health didn't end the run"); await frame(); await shot("survivors-over");
    await tab.ev(`(${A}.start(), ${G}.me.hp = 1e6, ${G}.t = 299.99, ${G}.foes = [], ${G}.score = 777, ${A}.step(0.05))`);
    check(await tab.ev(`${G}.state`) === "over" && await tab.ev(`${G}.won`), "five minutes doesn't win"); check(await tab.ev(`${D}.cos().survivors.best`) >= 777, "the best wasn't kept"); check(await tab.ev(`${D}.cos().survivors.wins`) >= 1, "the win wasn't counted");
    // keys move you; letting go stops
    await tab.ev(`(${A}.start(), ${G}.me.hp = 1e6)`); await tab.ev(`document.querySelector('.vg-root').dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }))`); const x0 = await tab.ev(`${G}.me.x`); await tab.ev(`${A}.step(0.2)`);
    check(await tab.ev(`${G}.me.x`) > x0, "a key didn't move you"); await tab.ev(`window.dispatchEvent(new KeyboardEvent("keyup", { key: "d", bubbles: true })); document.querySelector('.vg-root').dispatchEvent(new KeyboardEvent("keyup", { key: "d", bubbles: true }))`); const x1 = await tab.ev(`${G}.me.x`); await tab.ev(`${A}.step(0.2)`); check(await tab.ev(`${G}.me.x`) === x1, "letting go didn't stop you");
    // a frame stays inside its budget at the cap
    await tab.ev(`(() => { for (let i = 0; i < 110; i++) ${A}.add(${D}.nodes.find(n => !n.ghost)); })()`);
    const ms = await tab.ev(`(() => { let t = 0; for (let i = 0; i < 20; i++) t += ${D}.drawNow(); return t / 20; })()`); check(ms < 16, `a Survivors frame takes ${ms.toFixed(1)} ms`);
    await tab.ev(`${A}.end(false)`);

    // ---- Wikirace
    const W = `${D}.scenes().wikirace`, T = `${W}.state`, B = `${W}.api`;
    await tab.ev(`${clear}; ${D}.setView("wikirace")`); await sleep(300); await tab.ev(clear); await frame(); await shot("wikirace-title");
    const route = await tab.ev(`${B}.route()`);
    if (!route) fails.push("no route on this vault");
    else {
      check(JSON.stringify(route) === JSON.stringify(await tab.ev(`${B}.route()`)), "the route changed between looks");
      await tab.ev(`${B}.start()`); await frame(); await shot("wikirace-play");
      // walk it for real: breadth-first over what the game offers, to prove the route can be finished at par through free links
      const solved = await tab.ev(`(() => { const near = ${B}.near();
        const r = ${T}.route, prev = new Map([[r.from, null]]), q = [r.from]; while (q.length) { const x = q.shift(); if (x === r.to) break; [...(near.get(x) || [])].forEach(y => { if (!prev.has(y) && !${B}.hub(y)) { prev.set(y, x); q.push(y); } }); }
        if (!prev.has(r.to)) return null; const p = []; for (let x = r.to; x; x = prev.get(x)) p.unshift(x); return p; })()`);
      if (!solved) fails.push("today's route can't be finished without a hub");
      else {
        check(solved.length - 1 === route.par, `par says ${route.par}, the shortest walk is ${solved.length - 1}`);
        for (const id of solved.slice(1)) { const ok = await tab.ev(`(() => { const o = ${B}.options().find(x => x.id === ${JSON.stringify(id)}); if (!o) return false; ${B}.go(o); return true; })()`); check(ok, `the next link isn't offered: ${id}`); }
        check(await tab.ev(`${T}.state`) === "over", "reaching the goal didn't end the race"); check(await tab.ev(`${T}.hops`) === route.par, "a clean run should be par"); check(await tab.ev(`${T}.score`) > 900, `a clean run should score high: ${await tab.ev(`${T}.score`)}`);
        const c = await tab.ev(`${D}.cos().wikirace`); check(c.today === await tab.ev(`${T}.score`) && c.streak === 1, `the result wasn't kept: ${JSON.stringify(c)}`); await frame(); await shot("wikirace-over");
      }
      // hubs and traps cost, Back is a hop
      await tab.ev(`${B}.start({ from: ${JSON.stringify(route.from)}, to: "__nowhere__", par: 1, day: ${JSON.stringify(route.day)} })`);
      await tab.ev(`${B}.go({ id: "__trap__", name: "Gone", trap: true })`); check(await tab.ev(`${T}.traps`) === 1 && await tab.ev(`${T}.at`) === route.from, "a trap should cost and go nowhere"); check(await tab.ev(`${T}.hops`) === 0, "a trap shouldn't count as a hop");
      const near = await tab.ev(`${B}.options().find(o => !o.trap)`);
      if (near) { await tab.ev(`${B}.go({ ...${JSON.stringify(near)}, hub: true })`); check(await tab.ev(`${T}.hubs`) === 1 && await tab.ev(`${T}.hops`) === 1, "a hub should count"); await tab.ev(`${B}.back()`); check(await tab.ev(`${T}.at`) === route.from && await tab.ev(`${T}.hops`) === 2, "Back should return and cost a hop"); }
    }
    check(await tab.ev(`getComputedStyle(document.querySelector(".vg-status")).display === "none"`), "the note count shows over a game");
    // a real click on a row moves you; rows are big enough to tap on a phone
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }); await sleep(250);
    if (route) { await tab.ev(`${B}.start()`); await tab.ev(clear); await frame(); await shot("wikirace-phone");
      const rows = await tab.ev(`${T}.buttons.map(b => ({ x: b[0], y: b[1], w: b[2], h: b[3] }))`), cw = await tab.ev(`document.querySelector('.vg-cv').getBoundingClientRect().width`);
      check(rows.length && rows.every(b => b.h >= 40 && b.x >= 0 && b.x + b.w <= cw), "a row doesn't fit a phone or is too small to tap");
      const hop = await tab.ev(`${T}.hops`), r = await tab.ev(`(() => { const b = document.querySelector('.vg-cv').getBoundingClientRect(); return [b.left, b.top]; })()`), x = r[0] + rows[0].x + 40, y = r[1] + rows[0].y + 18;
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 }); await sleep(120);
      check(await tab.ev(`${T}.hops + ${T}.traps`) > hop, "clicking a link did nothing"); await tab.ev(`${T}.state = "title"`); }
    await tab.ev(`${D}.setView("survivors")`); await sleep(200); await tab.ev(`(${A}.start())`); await tab.ev(clear); await frame(); await shot("survivors-phone"); await tab.ev(`${A}.end(false)`);
    check(!(await tab.ev(`window.__writes || []`)).length, `a game wrote to a note: ${await tab.ev(`(window.__writes || []).join()`)}`);
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - play:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - Survivors and Wikirace: note enemies, tag upgrades, bosses, dying and winning; a fair daily route, hubs and traps; no writes; phone width");
  process.exit(0);
})();
