#!/usr/bin/env node
// The Dungeon game in headless Chrome: every note is an enemy in exactly one level, every enemy and the exit can be
// reached, keys walk and stop when they come up anywhere, walls hold, shots kill without touching the graph's selection,
// enemies can kill you, the boss opens the exit and the exit ends the level, and a frame stays inside its budget.
//   node tests/test_dungeon.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const fs = require("fs"), path = require("path"), env = require("./env");
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
(async () => {
  const tab = await openPage({ html: env.page() });
  const { fails, ok: check } = checks();
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
    // a target with open floor beside it and no other enemy near, everything close by asleep until the shot wakes it: on a slow machine a
    // late frame otherwise lets one walk off the line or another step into it. Aim and pull the trigger in one step.
    const aimed = `(() => { const L = ${G}.L, m = ${G}.me, alone = o => !o.dead && !L.enemies.some(x => x !== o && !x.dead && Math.hypot(x.x - o.x, x.y - o.y) < 3), spot = o => [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => !${A}.solidAt(L, o.x + dx, o.y + dy)), e = L.enemies.find(o => o !== L.boss && alone(o) && spot(o)) || L.enemies.find(o => !o.dead && spot(o)), at = spot(e); m.x = e.x + at[0]; m.y = e.y + at[1]; L.enemies.forEach(o => { if (!o.dead && Math.hypot(o.x - e.x, o.y - e.y) < 6) { o.awake = false; o.look = 99; } }); L.shots.length = 0; m.a = Math.atan2(e.y - m.y, e.x - m.x); m.gun = "pistol"; m.vx = m.vy = 0; m.cool = 0; m.swap = 0; m.ammo.bullets = 50; L.doors.forEach(d => { d.open = 1; d.hold = 99; }); ${G}.__t = e; const was = [e.hp, m.ammo.bullets]; ${root}.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); ${D}.drawNow(); return was; })()`;
    await tab.ev(safe); await tab.ev(`${D}.st.selected = null`);
    const h0 = await tab.ev(aimed);
    await frames(8); await key("keyup", " ", root);
    const h1 = await tab.ev(`[${G}.__t.hp, ${G}.me.ammo.bullets]`);
    check(h1[0] < h0[0], "Space didn't hurt the enemy in the crosshair"); check(h1[1] < h0[1], "a shot cost no ammo");
    check(await tab.ev(`${D}.st.selected`) === null, "shooting selected a note");
    await shot("play");
    // a kill scores and puts the note's name in the feed
    const killsBefore = await tab.ev(`${G}.L.kills`);
    if (!await tab.ev(`!!${G}.__t.dead`)) await tab.ev(`${A}.killEnemy(${G}.L, ${G}.__t)`); await frames(2);
    check(await tab.ev(`${G}.L.kills`) >= Math.max(1, killsBefore), "a dead enemy didn't count"); check(await tab.ev(`${G}.me.score`) > 0, "a kill scored nothing");
    check(await tab.ev(`!!${G}.feed.length && ${G}.feed[0].text.includes(${G}.__t.name.slice(0, 20))`), "the kill feed doesn't name the note");

    // secrets: every closet is shut until its crack is pushed, then its items can be reached; each opens once and scores
    const sec = await tab.ev(`(() => { const out = { levels: 0, secrets: 0, bad: [], kinds: new Set() }; for (let i = 0; i < ${A}.levelList().length; i++) { ${A}.startLevel(i); const L = ${G}.L; out.levels++; out.secrets += L.secrets.length; L.rooms.forEach(r => out.kinds.add(r.shape));
        const flood = () => { const seen = new Int8Array(L.gw * L.gh), q = [L.start.cy * L.gw + L.start.cx]; seen[q[0]] = 1; while (q.length) { const c = q.pop(); for (const o of [c - 1, c + 1, c - L.gw, c + L.gw]) if (!seen[o] && (L.g[o] === 0 || L.g[o] === 9)) { seen[o] = 1; q.push(o); } } return seen; };
        const at = (s, o) => s[(o.y | 0) * L.gw + (o.x | 0)]; let s0 = flood(); L.items.filter(it => it.secret).forEach(it => { if (at(s0, it)) out.bad.push(i + ": a secret item is reachable with the crack shut"); }); L.items.filter(it => !it.secret).forEach(it => { if (!at(s0, it)) out.bad.push(i + ": an item can't be reached"); });
        const score0 = ${G}.me.score; L.secrets.forEach(q => { ${A}.openSecret(L, q.c); ${A}.openSecret(L, q.c); }); if (${G}.me.score !== score0 + 500 * L.secrets.length) out.bad.push(i + ": a secret scored wrong"); const s1 = flood(); L.items.filter(it => it.secret).forEach(it => { if (!at(s1, it)) out.bad.push(i + ": a secret item can't be reached once open"); }); } out.kinds = [...out.kinds]; return out; })()`);
    console.log(`  dungeon: ${sec.secrets} secret rooms in ${sec.levels} levels; room shapes ${sec.kinds.join(", ")}`);
    check(sec.secrets > 0, "no level has a secret room"); check(!sec.bad.length, sec.bad.slice(0, 4).join("; ")); check(sec.kinds.length >= 3, "the levels all look alike: " + sec.kinds.join(","));

    // difficulty changes what enemies take and deal
    const diff = await tab.ev(`(() => { const hpAt = d => { ${G}.diff = d; ${A}.startLevel(0); return ${G}.L.boss.max; }, easy = hpAt(0), hard = hpAt(3); ${G}.diff = 3; ${A}.startLevel(0); const h0 = ${G}.me.hp; ${A}.hurtMe(10, 0, 0, "x"); const big = h0 - ${G}.me.hp; ${G}.diff = 0; ${A}.startLevel(0); const h1 = ${G}.me.hp; ${A}.hurtMe(10, 0, 0, "x"); const small = h1 - ${G}.me.hp; ${G}.diff = 1; return { easy, hard, big, small }; })()`);
    check(diff.hard > diff.easy * 1.5, "difficulty doesn't change enemy health"); check(diff.big > diff.small, "difficulty doesn't change damage");

    // a run has one life: dying ends it, Enter starts again from level 1
    await tab.ev(`${G}.mode = "run"; ${A}.startLevel(2)`); await frames(1); await tab.ev(`${A}.hurtMe(9999, 0, 0, "Some Note")`); await frames(2);
    check(await tab.ev(`${G}.ui.some(b => b.w > 60)`) && await tab.ev(`${G}.state`) === "dead", "a run's death has no buttons");
    await key("keydown", "Enter", root); await key("keyup", "Enter", root); await frames(2); check(await tab.ev(`${G}.level`) === 0 && await tab.ev(`${G}.me.score`) === 0, "a new run doesn't start at level 1 with nothing");
    await tab.ev(`${A}.toTitle()`);

    // the daily hunt: only stale notes, the same ones all day; clearing it names them; it doesn't move the campaign
    const hunt = await tab.ev(`(() => { const def = ${A}.huntDef(); if (!def) return null; const reached = ${G}.reached; ${A}.startHunt(def); const L = ${G}.L, again = ${A}.huntDef(); ${A}.killEnemy(L, L.boss); const m = ${G}.me; m.x = L.exit.x; m.y = L.exit.y; L.enemies.forEach(e => { e.awake = false; e.look = 999; }); return { n: L.total, want: def.notes.length, same: again.notes.map(n => n.id).join() === def.notes.map(n => n.id).join(), reached, stale: L.enemies.filter(e => e !== L.boss).every(e => e.stale) }; })()`);
    if (hunt) { await frames(3); check(hunt.n === hunt.want && hunt.same && hunt.stale, "the hunt isn't today's stale notes: " + JSON.stringify(hunt)); check(await tab.ev(`${G}.state`) === "tally" && await tab.ev(`${G}.tally.hunt`), "clearing the hunt didn't end it"); check(await tab.ev(`${G}.reached`) === hunt.reached, "the hunt moved the campaign"); }
    await tab.ev(`${G}.mode = "level"; ${A}.startLevel(0)`); await frames(1);

    // nothing draws a sprite for the first time mid-fight: a level's sprites are made when it loads
    const made = await tab.ev(`(() => { const L = ${G}.L, n0 = L.sprites.size; L.enemies.forEach(e => { e.flash = 0.05; ${A}.killEnemy(L, e); }); ${D}.drawNow(); return [n0, L.sprites.size]; })()`);
    check(made[0] === made[1], `sprites made after loading: ${made[0]} then ${made[1]}`); await tab.ev(`${A}.startLevel(0)`); await frames(1);

    // the guns: each one owned fires without an error
    await tab.ev(`${G}.me.guns = ["fist", "pistol", "shotgun", "chaingun", "rocket", "plasma"]; Object.assign(${G}.me.ammo, { bullets: 99, shells: 9, rockets: 9, cells: 99 }); ${G}.me.hp = 100`);
    for (let i = 1; i <= 6; i++) { await key("keydown", String(i), root); await key("keyup", String(i), root); await frames(7); check(await tab.ev(`${G}.me.gun`) === ["fist", "pistol", "shotgun", "chaingun", "rocket", "plasma"][i - 1], `key ${i} didn't change gun`); await key("keydown", " ", root); await frames(3); await shot("gun" + i); await frames(2); await key("keyup", " ", root); }

    // the game has the whole pane while it's played, and a corpse isn't left flashing
    check(await tab.ev(`document.querySelector('.vg-cv').clientWidth === innerWidth`), "the game doesn't fill the pane");
    check(await tab.ev(`${G}.L.enemies.filter(e => e.dead).every(e => e.flash === 0)`), "a corpse is still flashing");

    // an enemy's blow costs health; enough of them and you die, named by what killed you; Try again restores the start
    await tab.ev(`${A}.startLevel(0)`); await frames(1);
    // full health and the blow in one step: on a slow machine what happened in earlier frames can leave you at no health, and a frame between reading and hitting can change it
    const [hp0, hpHit] = await tab.ev(`(() => { const m = ${G}.me; m.hp = 100; const was = m.hp; ${A}.hurtMe(10, m.x + 1, m.y, "Some Note"); return [was, m.hp]; })()`); check(hpHit < hp0, "a hit cost no health");
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
  finish(fails, "dungeon: a level per topic, an enemy per note, walking, shooting, dying, the boss and the exit", "dungeon");
})();
