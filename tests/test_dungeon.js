#!/usr/bin/env node
// The Dungeon game in headless Chrome: every note is an enemy in exactly one level, every enemy and the exit can be
// reached, keys walk and stop when they come up anywhere, walls hold, shots kill without touching the graph's selection,
// enemies can kill you, the boss opens the exit and the exit ends the level, and a frame stays inside its budget.
//   node tests/test_dungeon.js [--vault [dir]] [--shots dir]        exit 0 = pass
const fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
(async () => {
  const tab = await cdp.open({ html: env.page(), port: 9356 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    const D = "window.vaultGraph._debug", S = `${D}.scenes().dungeon`, G = `${S}.state`, A = `${S}.api`;
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const frames = async (n = 6) => { for (let i = 0; i < n; i++) { await tab.ev(`${D}.drawNow()`); await sleep(40); } };
    const key = (type, k, target) => tab.ev(`${target}.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { key: ${JSON.stringify(k)}, bubbles: true }))`);
    const root = "document.querySelector('.vg-root')";
    const shot = async name => { if (!SHOTS) return; await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove()); ${D}.drawNow()`); await sleep(120); await tab.ev(`${D}.drawNow()`); fs.mkdirSync(SHOTS, { recursive: true }); const r = await tab.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(SHOTS, name + ".png"), Buffer.from(r.result.data, "base64")); };

    await tab.ev(`document.querySelectorAll('.vg-tour').forEach(x => x.remove()); ${D}.setView("dungeon")`); await sleep(400); await frames(2);
    check(await tab.ev(`${G}.state`) === "title", "the view doesn't open on the title screen");
    await shot("title");

    // every note that exists is in exactly one level
    const cover = await tab.ev(`(() => { const ids = ${A}.levelList().flatMap(l => l.notes.map(n => n.id)), want = ${D}.nodes.filter(n => !n.ghost).map(n => n.id); return { levels: ${A}.levelList().length, got: ids.length, uniq: new Set(ids).size, want: want.length }; })()`);
    check(cover.got === cover.want && cover.uniq === cover.want, `notes and enemies differ: ${JSON.stringify(cover)}`);

    // Enter starts; every enemy and the exit of every level can be reached from the start (doors open, pillars don't seal)
    await key("keydown", "Enter", root); await key("keyup", "Enter", root); await frames(2);
    check(await tab.ev(`${G}.state`) === "play", "Enter didn't start the level");
    check(await tab.ev(`${root}.classList.contains("is-playing")`), "the game didn't take the pane");
    const reach = await tab.ev(`(() => { const out = []; for (let i = 0; i < ${A}.levelList().length; i++) { ${A}.startLevel(i); ${D}.drawNow(); const L = ${G}.L, seen = new Int8Array(L.gw * L.gh), q = [(L.start.cy) * L.gw + L.start.cx]; seen[q[0]] = 1;
        while (q.length) { const c = q.pop(); for (const o of [c - 1, c + 1, c - L.gw, c + L.gw]) if (!seen[o] && (L.g[o] === 0 || L.g[o] === 9)) { seen[o] = 1; q.push(o); } }
        const lost = L.enemies.filter(e => !seen[(e.y | 0) * L.gw + (e.x | 0)]).length, exit = seen[(L.exit.y | 0) * L.gw + (L.exit.x | 0)]; if (lost || !exit || L.total !== ${A}.levelList()[i].notes.length || !L.boss) out.push({ i, lost, exit, total: L.total }); } return out; })()`);
    check(!reach.length, `levels with unreachable parts: ${JSON.stringify(reach)}`);

    // a frame on the biggest level, enemies awake: inside a 60 Hz budget even here
    const ms = await tab.ev(`(() => { ${A}.startLevel(${cover.levels - 1}); ${G}.L.enemies.forEach(e => { e.awake = true; e.st = "chase"; }); let t = 0; for (let i = 0; i < 30; i++) t += ${D}.drawNow(); return t / 30; })()`);
    console.log(`  dungeon: ${cover.levels} levels, ${cover.want} enemies, ${ms.toFixed(1)} ms a frame on the biggest`);
    check(ms < 16, `a frame on the biggest level takes ${ms.toFixed(1)} ms`);

    // W walks; a keyup outside the graph (here: on the window) stops it
    const safe = `(() => { ${A}.startLevel(0); ${G}.L.enemies.forEach(e => { e.awake = false; e.look = 999; }); ${G}.me.a = Math.atan2(${G}.L.exit.y - ${G}.me.y, ${G}.L.exit.x - ${G}.me.x); })()`;
    const pos = () => tab.ev(`(() => { const m = ${G}.me; return [m.x, m.y, ${G}.keys.size]; })()`);
    await tab.ev(safe); await frames(2); const p0 = await pos();
    await key("keydown", "w", root); await frames(); const p1 = await pos();
    check(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.05, "W didn't walk");
    await key("keyup", "w", "window"); await frames(12); const p2 = await pos(); await frames(); const p3 = await pos();
    check(p2[2] === 0, "a keyup outside the graph left W held");
    check(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) < 1e-3, "still walking after W came up");

    // losing the window pauses and lets go of keys, and the graph's controls come back
    await key("keydown", "w", root); await tab.ev("window.dispatchEvent(new Event('blur'))");
    check((await pos())[2] === 0, "window blur left a key held"); check(await tab.ev(`${G}.state`) === "paused", "window blur didn't pause");
    check(!await tab.ev(`${root}.classList.contains("is-playing")`), "paused, the graph's controls stayed hidden");

    // walls: walking into one for a while keeps you on the floor
    await tab.ev(safe); await key("keydown", "w", root); await frames(40); await key("keyup", "w", root);
    check(!await tab.ev(`${A}.solidAt(${G}.L, ${G}.me.x, ${G}.me.y)`), "walked through a wall");

    // shooting: face an enemy at close range; the shot hurts it, costs ammo and leaves the graph's selection alone
    const aimed = `(() => { const L = ${G}.L, m = ${G}.me, e = L.enemies.find(o => !o.dead && o !== L.boss) || L.boss; m.x = e.x - 1; m.y = e.y; if (${A}.solidAt(L, m.x, m.y)) { m.x = e.x + 1; if (${A}.solidAt(L, m.x, m.y)) { m.x = e.x; m.y = e.y - 1; } } m.a = Math.atan2(e.y - m.y, e.x - m.x); m.gun = "pistol"; m.vx = m.vy = 0; m.ammo.bullets = 50; L.doors.forEach(d => { d.open = 1; d.hold = 99; }); ${G}.__t = e; return e.name; })()`;
    await tab.ev(safe); await tab.ev(`${D}.st.selected = null`); await tab.ev(aimed); await frames(1);
    const h0 = await tab.ev(`[${G}.__t.hp, ${G}.me.ammo.bullets]`);
    await key("keydown", " ", root); await frames(8); await key("keyup", " ", root);
    const h1 = await tab.ev(`[${G}.__t.hp, ${G}.me.ammo.bullets]`);
    check(h1[0] < h0[0], "Space didn't hurt the enemy in the crosshair"); check(h1[1] < h0[1], "a shot cost no ammo");
    check(await tab.ev(`${D}.st.selected`) === null, "shooting selected a note");
    await shot("play");
    // a kill scores and puts the note's name in the feed
    const killsBefore = await tab.ev(`${G}.L.kills`);
    if (!await tab.ev(`!!${G}.__t.dead`)) await tab.ev(`${A}.killEnemy(${G}.L, ${G}.__t)`); await frames(2);
    check(await tab.ev(`${G}.L.kills`) >= Math.max(1, killsBefore), "a dead enemy didn't count"); check(await tab.ev(`${G}.me.score`) > 0, "a kill scored nothing");
    check(await tab.ev(`!!${G}.feed.length && ${G}.feed[0].text.includes(${G}.__t.name.slice(0, 20))`), "the kill feed doesn't name the note");

    // the guns: each one owned fires without an error
    await tab.ev(`${G}.me.guns = ["fist", "pistol", "shotgun", "chaingun", "rocket", "plasma"]; Object.assign(${G}.me.ammo, { bullets: 99, shells: 9, rockets: 9, cells: 99 }); ${G}.me.hp = 100`);
    for (let i = 1; i <= 6; i++) { await key("keydown", String(i), root); await key("keyup", String(i), root); await frames(7); check(await tab.ev(`${G}.me.gun`) === ["fist", "pistol", "shotgun", "chaingun", "rocket", "plasma"][i - 1], `key ${i} didn't change gun`); await key("keydown", " ", root); await frames(3); await shot("gun" + i); await frames(2); await key("keyup", " ", root); }

    // the game has the whole pane while it's played, and a corpse isn't left flashing
    check(await tab.ev(`document.querySelector('.vg-cv').clientWidth === innerWidth`), "the game doesn't fill the pane");
    check(await tab.ev(`${G}.L.enemies.filter(e => e.dead).every(e => e.flash === 0)`), "a corpse is still flashing");

    // an enemy's blow costs health; enough of them and you die, named by what killed you; Try again restores the start
    await tab.ev(`${A}.startLevel(0)`); await frames(1); const hp0 = await tab.ev(`${G}.me.hp`);
    await tab.ev(`${A}.hurtMe(10, ${G}.me.x + 1, ${G}.me.y, "Some Note")`); check(await tab.ev(`${G}.me.hp`) < hp0, "a hit cost no health");
    await tab.ev(`${A}.hurtMe(999, ${G}.me.x + 1, ${G}.me.y, "Some Note")`); await frames(2);
    check(await tab.ev(`${G}.state`) === "dead" && await tab.ev(`${G}.killer`) === "Some Note", "dying doesn't say who did it"); await shot("dead");
    await key("keydown", "Enter", root); await key("keyup", "Enter", root); await frames(2);
    check(await tab.ev(`${G}.state`) === "play" && await tab.ev(`${G}.me.hp`) === 100, "Try again didn't restart at full health");

    // the exit is locked until the boss dies; then standing on it ends the level, and Next carries on
    await tab.ev(`(() => { const L = ${G}.L, m = ${G}.me; L.enemies.forEach(e => { e.awake = false; e.look = 999; }); m.x = L.exit.x; m.y = L.exit.y; })()`); await frames(3);
    check(await tab.ev(`${G}.state`) === "play", "the exit worked with the boss alive");
    await tab.ev(`${A}.killEnemy(${G}.L, ${G}.L.boss)`); await frames(3);
    check(await tab.ev(`${G}.state`) === "tally", "the exit didn't end the level after the boss died"); await shot("tally");
    if (cover.levels > 1) { await key("keydown", "Enter", root); await key("keyup", "Enter", root); await frames(2); check(await tab.ev(`${G}.level`) === 1, "Next level didn't go to the next level"); }

    // a level is the same map every time; leaving the view pauses
    const sameMap = await tab.ev(`(() => { ${A}.startLevel(0); const a = Array.from(${G}.L.g).join(""); ${A}.startLevel(0); return a === Array.from(${G}.L.g).join(""); })()`);
    check(sameMap, "a level's map differs between runs");
    await tab.ev(`${D}.setView("2d")`); check(await tab.ev(`${G}.state`) === "paused", "leaving the view didn't pause");
    await tab.ev(`${A}.toTitle()`); await sleep(100);
    const errs = await tab.ev("window.__errs");
    check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.message); }
  await tab.close();
  console.log(fails.length ? "FAIL - dungeon: " + fails.join("; ") : "ok - dungeon: a level per topic, an enemy per note, walking, shooting, dying, the boss and the exit");
  process.exit(fails.length ? 1 : 0);
})();
