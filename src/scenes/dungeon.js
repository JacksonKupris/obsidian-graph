  // Dungeon: a first-person shooter played on the vault. Every note is an enemy and every topic a level; what a note is
  // decides what it is here (see kindOf). A level is generated from its topic's name, so it's the same map each time; the
  // topic's map note is the boss guarding the exit. The game never touches a note: it reads a snapshot of the vault when
  // a level starts, and a redraw of the vault's data doesn't disturb a level being played.
  // Parts below: rules of the game, level generation, sprites and textures, sound, the simulation, the renderer (a software
  // raycaster into a small framebuffer, scaled up), the HUD and menus, input, and the scene's registration.
  ICON.dungeon = '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6a3 3 0 0 1 6 0v6"/>';
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const TS = 64, DOOR = 9, BOSS_FLOOR = 2, EXIT_FLOOR = 3, SECTOR = 15, FONT = 'Impact, Haettenschweiler, "Arial Narrow Bold", "Roboto Condensed", sans-serif';

  // ---------------------------------------------------------------- rules of the game
  // r: body radius in cells; h: height against a wall's 1; z: how far it floats; pain: chance a hit staggers it
  const KINDS = {
    wisp:    { name: "Wisp",    is: "unlinked or tiny note", hp: 20,  speed: 3.6, melee: 7,  ranged: 0,  shot: 0,   every: 0.9, r: 0.3,  h: 0.55, z: 0.22, pain: 0.9,  score: 50 },
    grunt:   { name: "Grunt",   is: "ordinary note",         hp: 45,  speed: 2.2, melee: 10, ranged: 7,  shot: 7,   every: 2.4, r: 0.32, h: 0.85, z: 0,    pain: 0.7,  score: 100 },
    spitter: { name: "Spitter", is: "well-linked note",      hp: 70,  speed: 1.7, melee: 10, ranged: 12, shot: 8.5, every: 1.6, r: 0.42, h: 0.85, z: 0.12, pain: 0.5,  score: 200 },
    hunter:  { name: "Hunter",  is: "person",                hp: 130, speed: 3.3, melee: 22, ranged: 0,  shot: 0,   every: 0.8, r: 0.35, h: 0.95, z: 0,    pain: 0.3,  score: 350 },
    brute:   { name: "Brute",   is: "long note or other map", hp: 240, speed: 1.3, melee: 28, ranged: 18, shot: 6,   every: 2.6, r: 0.5,  h: 1.15, z: 0,    pain: 0.2,  score: 500 },
    boss:    { name: "Boss",    is: "the topic's map",       hp: 900, speed: 1.5, melee: 40, ranged: 16, shot: 8,   every: 1.0, r: 0.7,  h: 1.6,  z: 0,    pain: 0.04, score: 5000, fan: 3 },
  };
  // level: the level this gun is lying in (earlier levels on a shorter campaign, see gunLevel). Rate in seconds.
  const GUNS = [
    { key: "fist",     name: "Fist",     ammo: null,      dmg: 20,  rate: 0.36, pellets: 1, spread: 0,     range: 1.5, level: -1, sfx: "punch" },
    { key: "pistol",   name: "Pistol",   ammo: "bullets", dmg: 15,  rate: 0.3,  pellets: 1, spread: 0.012, range: 40,  level: -1, sfx: "pistol", kick: 0.5 },
    { key: "shotgun",  name: "Shotgun",  ammo: "shells",  dmg: 11,  rate: 0.8,  pellets: 7, spread: 0.075, range: 30,  level: 0,  sfx: "shotgun", kick: 1 },
    { key: "chaingun", name: "Chaingun", ammo: "bullets", dmg: 11,  rate: 0.09, pellets: 1, spread: 0.028, range: 40,  level: 2,  sfx: "chain", kick: 0.35 },
    { key: "rocket",   name: "Rocket",   ammo: "rockets", dmg: 120, rate: 0.75, proj: { speed: 11, splash: 2.6, sprite: "rocket" }, level: 4, sfx: "rocket", kick: 1 },
    { key: "plasma",   name: "Plasma",   ammo: "cells",   dmg: 24,  rate: 0.11, proj: { speed: 18, splash: 0, sprite: "plasma" }, level: 7, sfx: "plasma", kick: 0.3 },
  ];
  const AMMO_MAX = { bullets: 200, shells: 50, rockets: 30, cells: 200 }, GUN_AMMO = { bullets: 40, shells: 12, rockets: 6, cells: 80 };
  const heal = (n, what) => me => { if (me[what] >= 100) return null; me[what] = Math.min(100, me[what] + n); return `+${n} ${what === "hp" ? "health" : what}`; };
  const ITEMS = {
    health: { s: 0.3, take: heal(15, "hp") }, medkit: { s: 0.4, take: heal(40, "hp") }, armor: { s: 0.45, take: heal(50, "armor") },
    bullets: { s: 0.28, ammo: ["bullets", 20] }, shells: { s: 0.28, ammo: ["shells", 6] }, rockets: { s: 0.34, ammo: ["rockets", 3] }, cells: { s: 0.3, ammo: ["cells", 40] },
  };
  const G = { state: "title", sel: 0, level: 0, last: 0, keys: new Set(), firing: false, muted: false, best: 0, reached: 0, levels: null, L: null, me: null, snap: null,
    ui: [], primary: null, mx: -1, my: -1, feed: [], msg: null, combo: 0, comboT: 0, locked: false, touch: {}, showTouch: false, bigMap: false, tally: null, killer: "", pausedAt: 0, musicAt: 0, musicStep: 0, intro: 0 };
  const STORE = "vg-dungeon:" + (DATA.vault || "");   // this device's progress; a blocked store plays without it
  try { const s = JSON.parse(localStorage.getItem(STORE) || "{}"); G.reached = s.reached || 0; G.best = s.best || 0; G.muted = !!s.muted; G.sel = s.reached || 0; } catch (e) { /* no saved progress */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ reached: G.reached, best: G.best, muted: G.muted })); } catch (e) { /* nothing to keep it in */ } };

  // what a note is decides what it is here: the same note is the same enemy on every run
  const percentile = (vals, f) => { const a = vals.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : 0; };
  const linksOf = n => (n.inlinks || 0) + (n.outlinks || 0);
  const kindOf = (n, s) => n.person ? "hunter" : n.moc || (n.words || 0) >= s.long ? "brute" : n.isolated || (n.words || 0) < s.tiny ? "wisp" : linksOf(n) >= s.linked ? "spitter" : "grunt";
  // A level per topic, smallest first, so the campaign grows. A topic of one or two notes joins the unclustered level.
  function levelList() {
    if (G.levels) return G.levels;
    const groups = new Map(), add = (c, n) => { if (!groups.has(c)) groups.set(c, []); groups.get(c).push(n); };
    nodes.filter(n => !n.ghost).forEach(n => add(n.cluster, n));
    [...groups].forEach(([c, ns]) => { if (ns.length < 3 && c !== -1 && groups.size > 1) { groups.delete(c); ns.forEach(n => add(-1, n)); } });
    return (G.levels = [...groups].map(([c, notes]) => ({ c, name: clusterName(c), notes })).sort((a, b) => a.notes.length - b.notes.length || (a.name < b.name ? -1 : 1)));
  }
  const gunLevel = (g, count) => g.level < 0 ? -1 : Math.min(g.level, Math.round(g.level / 8 * (count - 1)));
  const freshMe = i => { const count = levelList().length, guns = GUNS.filter(g => gunLevel(g, count) < i).map(g => g.key), has = k => guns.includes(k);
    return { x: 1.5, y: 1.5, a: 0, vx: 0, vy: 0, hp: 100, armor: 0, ammo: { bullets: 50, shells: has("shotgun") ? 16 : 0, rockets: has("rocket") ? 6 : 0, cells: has("plasma") ? 60 : 0 }, guns, gun: has("shotgun") ? "shotgun" : "pistol",
      cool: 0, kick: 0, flash: 0, swap: 0, bob: 0, hurt: 0, hurtDir: 0, shake: 0, score: 0, grin: 0 }; };

  // ---------------------------------------------------------------- level generation
  const seeded = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  function buildLevel(i) {
    const def = levelList()[i], rand = seeded(hash("dungeon:" + def.name + ":" + i)), int = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const notes = def.notes.slice().sort(byImportance), count = Math.max(4, Math.min(20, Math.round(notes.length / 5) + 3)), { cols, rows } = gridDims(count);
    const gw = cols * SECTOR + 3, gh = rows * SECTOR + 3, g = new Uint8Array(gw * gh), F = new Uint8Array(gw * gh), inRoom = new Uint8Array(gw * gh), carved = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) g[y * gw + x] = 1 + (Math.floor(x / SECTOR) + Math.floor(y / SECTOR) * 2 + (i % 3)) % 3;   // walls change by sector
    const rooms = [];
    for (let k = 0; k < count; k++) {
      const sx = k % cols, sy = Math.floor(k / cols), w = int(6, SECTOR - 4), h = int(6, SECTOR - 4), x0 = sx * SECTOR + 2 + int(0, SECTOR - w - 3), y0 = sy * SECTOR + 2 + int(0, SECTOR - h - 3);
      rooms.push({ k, sx, sy, x0, y0, w, h, cx: x0 + (w >> 1), cy: y0 + (h >> 1), floor: rand() < 0.5 ? 0 : 1 });
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { g[y * gw + x] = 0; inRoom[y * gw + x] = 1; F[y * gw + x] = rooms[k].floor; }
    }
    // corridors: a random spanning tree over neighbouring sectors, plus some loops so a fight can be run around
    const at = (sx, sy) => sx >= 0 && sy >= 0 && sx < cols ? rooms[sy * cols + sx] : null;
    const neighbours = r => [at(r.sx + 1, r.sy), at(r.sx - 1, r.sy), at(r.sx, r.sy + 1), at(r.sx, r.sy - 1)].filter(Boolean);
    const carve = (a, b) => { let x = a.cx, y = a.cy; const put = () => { const c = y * gw + x; if (g[c]) { g[c] = 0; carved[c] = 1; } };
      const hor = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); put(); } }, ver = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); put(); } };
      if (rand() < 0.5) { hor(); ver(); } else { ver(); hor(); } };
    const seen = new Set([0]), stack = [rooms[0]];
    while (stack.length) { const r = stack[stack.length - 1], next = neighbours(r).filter(o => !seen.has(o.k)); if (!next.length) { stack.pop(); continue; }
      const o = next[int(0, next.length - 1)]; seen.add(o.k); carve(r, o); stack.push(o); }
    rooms.forEach(r => neighbours(r).forEach(o => { if (o.k > r.k && rand() < 0.22) carve(r, o); }));
    // the boss waits in the room farthest from the start
    const L = { i, def, gw, gh, g, F, rooms, doors: new Map(), enemies: [], items: [], shots: [], bits: [], flow: new Int32Array(gw * gh), flowCell: -1, flowAt: 0, open: false, kills: 0, total: 0, itemsGot: 0, itemsTotal: 0, time: 0, seen: new Uint8Array(gw * gh), mini: null, sprites: new Map(), tex: null, boss: null, exit: null, start: rooms[0], base: colorOf(def.c) };
    fillFlow(L, rooms[0].cx, rooms[0].cy);
    const bossRoom = rooms.filter(r => r !== rooms[0]).sort((a, b) => L.flow[b.cy * gw + b.cx] - L.flow[a.cy * gw + a.cx])[0];
    L.exit = { x: bossRoom.cx + 0.5, y: bossRoom.cy + 0.5 };
    for (let y = bossRoom.y0; y < bossRoom.y0 + bossRoom.h; y++) for (let x = bossRoom.x0; x < bossRoom.x0 + bossRoom.w; x++) F[y * gw + x] = BOSS_FLOOR;
    F[bossRoom.cy * gw + bossRoom.cx] = EXIT_FLOOR;
    // doors stand where a one-wide corridor meets a room; the boss room always has them
    const solid = c => g[c] !== 0 && g[c] !== DOOR;
    for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) { const c = y * gw + x; if (!carved[c] || g[c]) continue;
      const alongX = (inRoom[c - 1] || inRoom[c + 1]) && solid(c - gw) && solid(c + gw) && !solid(c - 1) && !solid(c + 1), alongY = (inRoom[c - gw] || inRoom[c + gw]) && solid(c - 1) && solid(c + 1) && !solid(c - gw) && !solid(c + gw);
      if (!alongX && !alongY) continue;
      const bossDoor = [c - 1, c + 1, c - gw, c + gw].some(o => F[o] === BOSS_FLOOR);
      if (bossDoor || rand() < 0.7) { g[c] = DOOR; L.doors.set(c, { c, x: x + 0.5, y: y + 0.5, alongX: !!alongX, open: 0, hold: 0 }); } }
    // pillars for cover in the big rooms, clear of the walls and the middle
    rooms.forEach(r => { if (r.w < 9 || r.h < 9 || r === bossRoom) return; const n = int(0, 3);
      for (let k = 0; k < n; k++) { const x = r.x0 + int(2, r.w - 3), y = r.y0 + int(2, r.h - 3); if (Math.abs(x - r.cx) > 1 || Math.abs(y - r.cy) > 1) g[y * gw + x] = 1 + (i + 1) % 3; } });
    const openSpot = (r, margin = 1) => { for (let t = 0; t < 30; t++) { const x = r.x0 + margin + rand() * Math.max(0, r.w - margin * 2), y = r.y0 + margin + rand() * Math.max(0, r.h - margin * 2); if (!g[Math.floor(y) * gw + Math.floor(x)]) return [x, y]; } return [r.cx + 0.5, r.cy + 0.5]; };
    // every note becomes an enemy: the map (or else the most relied-on note) is the boss, the rest spread by room size
    const all = nodes.filter(n => !n.ghost), stats = { long: percentile(all.map(n => n.words || 0), 0.9), tiny: percentile(all.map(n => n.words || 0), 0.2), linked: percentile(all.map(linksOf), 0.75) };
    const bossNote = notes.find(n => n.moc) || notes[0], hard = 1 + 0.07 * i, spots = rooms.filter(r => r !== rooms[0] && r !== bossRoom), hpIn = new Map(rooms.map(r => [r, 0]));
    const area = spots.reduce((s, r) => s + r.w * r.h, 0), weighted = spots.flatMap(r => Array(Math.max(1, Math.round(r.w * r.h / area * 60))).fill(r));
    notes.forEach(n => { const isBoss = n === bossNote, kind = isBoss ? "boss" : kindOf(n, stats), K = KINDS[kind], stale = !isBoss && !special(n) && staleFor(n, Q.stale_days);
      const room = isBoss || !weighted.length ? bossRoom : weighted[int(0, weighted.length - 1)], [x, y] = isBoss ? [bossRoom.cx + 0.5, bossRoom.y0 + 1.5] : openSpot(room);
      const size = 1 + 0.18 * Math.log10(Math.max(1, (n.words || 1) / Math.max(1, stats.tiny)));   // a longer note takes more shooting
      const hp = K.hp * size * hard * (stale ? 1.25 : 1) * (isBoss ? 1 + notes.length / 60 : 1);
      const e = { id: n.id, name: n.name, kind, K, x, y, hp, max: hp, stale, age: n.age || 0, drop: (n.tasks || 0) > 0, room, st: "idle", t: 0, cd: rand() * K.every, awake: false, look: rand() * 0.4, flash: 0, walk: rand() * 3, dead: 0, sight: false, melee: false, vis: false };
      L.enemies.push(e); hpIn.set(room, hpIn.get(room) + hp); if (isBoss) L.boss = e; });
    L.total = L.enemies.length;
    // enough to kill it all with something left over: items follow the hit points in the room
    const levels = levelList().length, avail = GUNS.filter(gun => gun.ammo && gun.ammo !== "bullets" && gunLevel(gun, levels) <= i).map(gun => gun.ammo);
    const place = (r, type) => { const [x, y] = openSpot(r); L.items.push({ type, x, y, placed: true }); L.itemsTotal++; };
    rooms.forEach(r => { const n = 1 + Math.floor(hpIn.get(r) / 140);
      for (let j = 0; j < n; j++) { const roll = rand(); place(r, roll < 0.2 ? "health" : roll < 0.27 ? "medkit" : roll < 0.33 ? "armor" : roll < 0.6 || !avail.length ? "bullets" : avail[int(0, avail.length - 1)]); } });
    place(rooms[0], "bullets"); place(rooms[0], "health"); place(bossRoom, "medkit"); place(bossRoom, "armor");
    const newGun = GUNS.find(gun => gunLevel(gun, levels) === i);
    if (newGun) { const [x, y] = openSpot(spots[Math.floor(spots.length / 2)] || rooms[0]); L.items.push({ type: "gun", gun: newGun.key, x, y, placed: true }); L.itemsTotal++; }
    return L;
  }
  // Steps from every open cell to (cx, cy): enemies walk it downhill. Doors count as open, an enemy opens them on arrival.
  function fillFlow(L, cx, cy) {
    const { gw, gh, g, flow } = L, q = new Int32Array(gw * gh); flow.fill(-1); let a = 0, b = 0; const s = cy * gw + cx; flow[s] = 0; q[b++] = s;
    while (a < b) { const c = q[a++], d = flow[c] + 1; for (const o of [c - 1, c + 1, c - gw, c + gw]) if (o >= 0 && o < gw * gh && flow[o] < 0 && (!g[o] || g[o] === DOOR)) { flow[o] = d; q[b++] = o; } }
  }

  // ---------------------------------------------------------------- textures and sprites
  const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const abgr = (r, g, b) => (0xff000000 | (clamp(b, 0, 255) << 16) | (clamp(g, 0, 255) << 8) | clamp(r, 0, 255)) >>> 0;
  // a pixel at a light level (256 = as painted)
  const lit = (c, s) => { const r = (c & 255) * s >> 8, g = (c >> 8 & 255) * s >> 8, b = (c >> 16 & 255) * s >> 8; return 0xff000000 | (r > 255 ? 255 : r) | (g > 255 ? 255 : g) << 8 | (b > 255 ? 255 : b) << 16; };
  function texture(kind, base, seed) {
    const px = new Uint32Array(TS * TS), [r, g, b] = rgbOf(base), rand = seeded(seed);
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const n = rand() * 0.14 - 0.07; let v = 0.8 + n;
      if (kind === "brick") { const row = y >> 3, sx = x + (row % 2) * 8, bx = sx % 16; if (y % 8 === 0 || bx === 0) v = 0.32 + n * 0.5; else { v = 0.72 + 0.14 * ((Math.imul(row * 31 + (sx >> 4), 2654435761) >>> 28) / 16) + n; if (y % 8 === 1 || bx === 1) v += 0.14; } }
      else if (kind === "panel") { const u = x % 32, w = y % 32; v = 0.62 + n * 0.6; if (u < 1 || w < 1) v = 0.25; else if (u < 2 || w < 2) v = 0.9; if ((u === 4 || u === 28) && (w === 4 || w === 28)) v = 1.05; if (y > 26 && y < 37 && x > 8 && x < 56) v = 0.34 + n; }
      else if (kind === "stone") { v = 0.6 + 0.2 * Math.sin(x * 0.35 + 2 * Math.sin(y * 0.21)) * Math.sin(y * 0.31 + Math.sin(x * 0.17)) + n * 1.4; if ((x + y * 3) % 29 === 0) v -= 0.3; }
      else if (kind === "tile") { v = x % 32 < 1 || y % 32 < 1 ? 0.3 : 0.66 + n + (((x >> 5) + (y >> 5)) % 2 ? 0.07 : -0.05); }
      else if (kind === "ceil") { const cx = Math.abs((x % 32) - 16), cy = Math.abs((y % 32) - 16); v = 0.42 + n * 0.5; if (x % 32 < 1 || y % 32 < 1) v = 0.2; if (cx < 6 && cy < 3 && (x >> 5) === (y >> 5)) v = 2.2; }
      else if (kind === "door") { v = 0.68 + n * 0.5; if (x < 3 || x > 60) v = 0.28; if (y % 16 < 2) v = 0.35; if (Math.abs(x - 32) < 1) v = 0.25; if (y > 26 && y < 38 && Math.abs(x - 32) < 10) v = (x + y) % 8 < 4 ? 1.4 : 0.22; }
      else if (kind === "exit") { v = 0.5 + 0.6 * Math.abs(Math.sin(Math.hypot(x - 32, y - 32) * 0.4)) + n; if (x < 2 || y < 2 || x > 61 || y > 61) v = 1.5; }
      v = Math.max(0.05, v); px[y * TS + x] = abgr(r * v | 0, g * v | 0, b * v | 0); }
    return px;
  }
  function levelTextures(L) {
    if (L.tex) return L.tex;
    const s = hash(L.def.name), col = L.base;
    return (L.tex = { wall: [null, texture("brick", hexMix(col, "#6b5a4a", 0.45), s), texture("panel", hexMix(col, "#5f6673", 0.72), s + 1), texture("stone", hexMix(col, "#57534e", 0.55), s + 2)],
      floor: [texture("tile", hexMix(col, "#57504a", 0.82), s + 3), texture("stone", hexMix(col, "#44403c", 0.85), s + 4), texture("tile", "#5c2a24", s + 5)], ceil: texture("ceil", "#3a3a3e", s + 6),
      door: texture("door", "#8a8d91", s + 7), exitOn: texture("exit", "#22c55e", s + 8), exitOff: texture("exit", "#7f1d1d", s + 8) });
  }
  const offscreen = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  // A drawing becomes pixels: hard edges, a dark outline, lit from above with some grit, so it reads as pixel art however it's scaled
  function bake(cv_, grit) {
    const w = cv_.width, h = cv_.height, c = cv_.getContext("2d"), src = c.getImageData(0, 0, w, h), d = src.data, px = new Uint32Array(w * h), rand = seeded(w * 7 + d.length), a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 110;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!a(x, y)) continue; const i = (y * w + x) * 4, edge = !a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1), v = grit ? (edge ? 0.45 : 1.08 - 0.32 * y / h + rand() * 0.14 - 0.07) : 1;
      px[y * w + x] = abgr(d[i] * v | 0, d[i + 1] * v | 0, d[i + 2] * v | 0); }
    c.putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0)), w, h), 0, 0);
    return { w, h, px, cv: cv_ };
  }
  const shapes = c => ({
    el: (x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 7); c.fill(); },
    poly: (col, ...p) => { c.fillStyle = col; c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); c.fill(); },
    rc: (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); } });
  // the six enemies: f 0 and 1 walk, 2 attacks, 3 flinches
  function paintEnemy(c, kind, base, f) {
    const { el, poly, rc } = shapes(c), dk = hexMix(base, "#000000", 0.5), lt = hexMix(base, "#ffffff", 0.28), step = f === 0 ? 2 : f === 1 ? -2 : 0, atk = f === 2, pain = f === 3, eye = pain ? "#ffffff" : "#fde047", glow = "#fb923c";
    if (pain) { c.translate(32, 60); c.rotate(-0.12); c.translate(-32, -60); }
    if (kind === "grunt") {
      rc(23, 42, 7, 20 - Math.max(0, step), dk); rc(34, 42, 7, 20 + Math.min(0, step), dk);
      el(32, 34, 13, 14, base); el(32, 30, 8, 7, lt);
      if (atk) { poly(dk, 19, 26, 12, 8, 17, 6, 24, 24); poly(dk, 45, 26, 52, 8, 47, 6, 40, 24); el(14, 8, 5, 5, glow); el(50, 8, 5, 5, glow); }
      else { rc(14, 26 + step, 6, 19, dk); rc(44, 26 - step, 6, 19, dk); poly(lt, 14, 45 + step, 20, 45 + step, 17, 51 + step); poly(lt, 44, 45 - step, 50, 45 - step, 47, 51 - step); }
      el(32, 16, 9, 9, base); poly(lt, 24, 11, 19, 1, 28, 8); poly(lt, 40, 11, 45, 1, 36, 8);
      rc(26, 13, 4, 3, eye); rc(34, 13, 4, 3, eye); rc(27, 20, 10, atk ? 5 : 2, "#1c1917"); if (atk) rc(29, 20, 2, 2, "#fff");
    } else if (kind === "wisp") {
      const fl = f === 0 ? 3 : f === 1 ? -3 : 0;
      poly("#f97316", 16, 26, 10, 6 + fl, 22, 16, 26, 0 - fl, 33, 14, 40, 2 + fl, 44, 16, 54, 6 - fl, 48, 26); poly("#fde047", 22, 24, 22, 12, 30, 18, 34, 8, 38, 18, 44, 12, 42, 24);
      el(32, 32, 16, 15, hexMix(base, "#e7e5e4", 0.68)); rc(23, 42, 18, atk ? 11 : 7, hexMix(base, "#a8a29e", 0.6));
      el(25, 31, 5, 6, "#0c0a09"); el(39, 31, 5, 6, "#0c0a09"); rc(24, 30, 2, 2, eye); rc(38, 30, 2, 2, eye); rc(31, 37, 2, 4, "#0c0a09");
      for (let x = 24; x < 41; x += 4) rc(x, 44, 2, 3, "#0c0a09");
    } else if (kind === "spitter") {
      [12, 22, 32, 42, 52].forEach((x, i) => poly(dk, x - 4, 16 + Math.abs(i - 2) * 3, x, 3 + Math.abs(i - 2) * 4, x + 4, 16 + Math.abs(i - 2) * 3));
      el(32, 31, 24, 23, base); el(26, 23, 13, 9, lt);
      el(32, 22, 9, 9, "#f8fafc"); el(32, 22, 5, 6, pain ? "#ef4444" : "#16a34a"); rc(31, 20, 2, 4, "#0c0a09");
      el(32, 42, atk ? 17 : 15, atk ? 11 : 6, "#450a0a"); if (atk) el(32, 42, 8, 6, glow);
      for (let x = 20; x < 45; x += 5) { poly("#fff", x, 37, x + 3, 37, x + 1.5, 41); if (atk) poly("#fff", x, 50, x + 3, 50, x + 1.5, 46); }
    } else if (kind === "hunter") {
      poly(dk, 32, 8, 12 + step, 62, 52 + step, 62); poly(base, 32, 12, 18 + step, 60, 46 + step, 60);
      el(32, 16, 10, 11, dk); el(32, 18, 7, 8, "#0c0a09"); rc(27, 16, 3, 2, "#f43f5e"); rc(34, 16, 3, 2, "#f43f5e");
      if (atk) { poly("#e2e8f0", 48, 4, 52, 2, 44, 30, 41, 28); rc(40, 24, 8, 10, dk); } else { poly("#e2e8f0", 53, 22, 56, 20, 52, 48, 49, 47); rc(46, 28, 8, 9, dk); }
      rc(12, 28, 7, 12, dk); poly(lt, 24, 34, 40, 34, 37, 50, 27, 50);
    } else if (kind === "brute") {
      rc(16, 44, 13, 20 - Math.max(0, step), dk); rc(35, 44, 13, 20 + Math.min(0, step), dk);
      el(32, 34, 24, 19, base); el(32, 28, 15, 10, lt); poly(dk, 18, 40, 46, 40, 40, 52, 24, 52);
      if (atk) { el(6, 14, 8, 8, dk); el(58, 14, 8, 8, dk); rc(3, 14, 8, 20, base); rc(53, 14, 8, 20, base); el(6, 12, 6, 6, glow); el(58, 12, 6, 6, glow); }
      else { rc(0, 22 + step, 11, 26, dk); rc(53, 22 - step, 11, 26, dk); el(5, 50 + step, 8, 7, base); el(59, 50 - step, 8, 7, base); }
      el(32, 15, 8, 8, base); poly(lt, 25, 11, 14, 4, 16, 1, 28, 7); poly(lt, 39, 11, 50, 4, 48, 1, 36, 7); rc(27, 12, 3, 3, eye); rc(34, 12, 3, 3, eye); rc(28, 18, 8, 2, "#1c1917");
    } else {   // boss
      rc(14, 44, 14, 20 - Math.max(0, step), "#57534e"); rc(36, 44, 14, 20 + Math.min(0, step), dk); rc(14, 52 - Math.max(0, step), 14, 3, "#a8a29e");
      el(32, 31, 25, 21, base); el(32, 24, 17, 10, lt); el(32, 34, 8, 8, "#450a0a"); el(32, 34, 5 + (atk ? 2 : 0), 5 + (atk ? 2 : 0), atk ? "#fef08a" : glow);
      rc(50, 24, 12, 13, "#57534e"); rc(53, 14, 8, 16, "#a8a29e"); rc(55, 10, 4, 4, atk ? "#fef08a" : "#1c1917");
      rc(3, 24 + step, 11, 24, dk); el(8, 50 + step, 8, 7, base);
      el(32, 13, 10, 10, base); poly(lt, 24, 9, 8, 7, 3, 1, 12, 2, 28, 4); poly(lt, 40, 9, 56, 7, 61, 1, 52, 2, 36, 4); rc(26, 10, 4, 4, eye); rc(34, 10, 4, 4, eye); rc(27, 17, 10, atk ? 5 : 3, "#1c1917"); for (let x = 27; x < 37; x += 3) rc(x, 17, 2, 2, "#fff");
    }
  }
  function enemySprite(L, kind, stale, f) {
    const key = kind + (stale ? "!" : "") + f; let s = L.sprites.get(key); if (s) return s;
    const cv_ = offscreen(64, 64), c = cv_.getContext("2d"), base = stale ? hexMix(L.base, "#c7cbb4", 0.62) : hexMix(L.base, kind === "boss" ? "#7f1d1d" : "#6b4a2f", 0.3);
    if (f >= 4) { const src = enemySprite(L, kind, stale, 3), sq = [0.7, 0.42, 0.2][f - 4]; c.imageSmoothingEnabled = false; shapes(c).el(32, 60, 10 + (f - 3) * 7, 2 + (f - 3), hexMix(L.base, "#3b0a0a", 0.7)); c.drawImage(src.cv, 0, 64 - 62 * sq, 64, 62 * sq); }
    else paintEnemy(c, kind, base, f);
    s = bake(cv_, true); L.sprites.set(key, s); return s;
  }
  const ITEM_SPRITES = new Map();
  function itemSprite(key) {
    let s = ITEM_SPRITES.get(key); if (s) return s;
    const cv_ = offscreen(32, 32), c = cv_.getContext("2d"), { el, poly, rc } = shapes(c);
    if (key === "health" || key === "medkit") { rc(5, 8, 22, 22, "#e7e5e4"); rc(13, 11, 6, 16, "#dc2626"); rc(8, 16, 16, 6, "#dc2626"); if (key === "medkit") rc(11, 4, 10, 5, "#57534e"); }
    else if (key === "armor") { poly("#16a34a", 8, 4, 13, 4, 16, 8, 19, 4, 24, 4, 28, 12, 25, 16, 25, 30, 7, 30, 7, 16, 4, 12); rc(11, 14, 10, 12, "#22c55e"); }
    else if (key === "bullets") { rc(8, 14, 16, 16, "#57534e"); rc(9, 8, 3, 8, "#eab308"); rc(14, 6, 3, 10, "#eab308"); rc(19, 8, 3, 8, "#eab308"); rc(8, 20, 16, 2, "#a8a29e"); }
    else if (key === "shells") { [5, 12, 19].forEach(x => { rc(x, 8, 7, 22, "#dc2626"); rc(x, 24, 7, 6, "#eab308"); }); }
    else if (key === "rockets") { rc(11, 8, 10, 22, "#4d7c0f"); poly("#a8a29e", 11, 8, 21, 8, 16, 1); rc(7, 25, 4, 5, "#3f6212"); rc(21, 25, 4, 5, "#3f6212"); }
    else if (key === "cells") { rc(6, 8, 20, 22, "#1e3a8a"); rc(9, 11, 14, 16, "#38bdf8"); rc(12, 4, 8, 4, "#a8a29e"); }
    else if (key.startsWith("gun:")) { rc(1, 16, 30, 6, "#57534e"); rc(1, 15, 22, 2, "#a8a29e"); rc(20, 21, 8, 8, "#78350f"); rc(9, 22, 5, 6, "#292524"); if (key === "gun:rocket") rc(1, 12, 22, 12, "#4d7c0f"); if (key === "gun:plasma") rc(4, 13, 18, 9, "#38bdf8"); }
    else if (key === "fireball") { el(16, 16, 13, 13, "#dc2626"); el(16, 16, 9, 9, "#f97316"); el(16, 16, 5, 5, "#fef08a"); }
    else if (key === "bossball") { el(16, 16, 14, 14, "#7e22ce"); el(16, 16, 9, 9, "#d946ef"); el(16, 16, 5, 5, "#f5d0fe"); }
    else if (key === "rocket") { el(16, 16, 7, 7, "#a8a29e"); el(16, 16, 4, 4, "#f97316"); }
    else if (key === "plasma") { el(16, 16, 11, 11, "#2563eb"); el(16, 16, 7, 7, "#38bdf8"); el(16, 16, 3, 3, "#fff"); }
    else if (key === "beamOn" || key === "beamOff") { const col = key === "beamOn" ? "#4ade80" : "#ef4444"; for (let y = 0; y < 32; y += 2) rc(10 + (y % 6), y, 12 - (y % 6) * 2, 1, col); }
    s = bake(cv_, key.startsWith("gun:") || ITEMS[key] != null); ITEM_SPRITES.set(key, s); return s;
  }

  // ---------------------------------------------------------------- sound: everything synthesised, nothing to load
  const AU = { ctx: null, master: null, music: null, noise: null, last: {} };
  function audio() {
    if (G.muted) return null;
    if (!AU.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      try { AU.ctx = new AC(); } catch (e) { return null; }
      AU.master = AU.ctx.createGain(); AU.master.gain.value = 0.45; AU.master.connect(AU.ctx.destination);
      AU.noise = AU.ctx.createBuffer(1, AU.ctx.sampleRate, AU.ctx.sampleRate); const d = AU.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const shaper = AU.ctx.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 512 - 1) * 7); shaper.curve = curve;
      AU.music = AU.ctx.createGain(); AU.music.gain.value = 0.11; AU.music.connect(shaper); shaper.connect(AU.master); }
    if (AU.ctx.state === "suspended") AU.ctx.resume().catch(() => {});
    return AU.ctx;
  }
  const blast = (dur, freq, gain, type = "lowpass") => { const a = audio(); if (!a) return; const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime;
    s.buffer = AU.noise; s.loop = true; f.type = type; f.frequency.value = freq; g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); s.connect(f); f.connect(g); g.connect(AU.master); s.start(t, Math.random() * 0.5); s.stop(t + dur); };
  const tone = (f0, f1, dur, gain, type = "square", at = 0, out = null) => { const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(out || AU.master); o.start(t); o.stop(t + dur); };
  const SFX = { pistol: () => { blast(0.12, 1800, 0.6); tone(240, 70, 0.1, 0.2); }, shotgun: () => { blast(0.32, 1200, 1); tone(120, 40, 0.28, 0.5); }, chain: () => { blast(0.07, 2400, 0.4); tone(180, 80, 0.05, 0.14); },
    rocket: () => { blast(0.35, 700, 0.6); tone(220, 60, 0.35, 0.3, "sawtooth"); }, plasma: () => tone(900, 300, 0.1, 0.16, "sawtooth"), punch: () => blast(0.07, 500, 0.5), boom: () => { blast(0.6, 420, 1.2); tone(90, 28, 0.55, 0.7, "sine"); },
    hit: () => blast(0.05, 3000, 0.16, "highpass"), die: () => { tone(320, 55, 0.4, 0.22, "sawtooth"); blast(0.22, 900, 0.3); }, bossdie: () => { tone(160, 25, 1.4, 0.5, "sawtooth"); blast(1.1, 500, 1); },
    pain: () => tone(220, 110, 0.16, 0.2, "sawtooth"), hurt: () => { tone(170, 70, 0.25, 0.35, "sawtooth"); blast(0.12, 700, 0.3); }, spit: () => tone(420, 150, 0.2, 0.14, "triangle"), pickup: () => { tone(620, 620, 0.06, 0.12); tone(930, 930, 0.1, 0.12, "square", 0.06); },
    gun: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, f, 0.1, 0.13, "square", i * 0.08)); }, door: () => { tone(90, 150, 0.45, 0.13, "sawtooth"); blast(0.4, 300, 0.12); }, click: () => tone(1200, 800, 0.03, 0.1), exit: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.2, 0.16, "square", i * 0.13)); } };
  const sfx = (k, gap = 0) => { const t = performance.now(); if (gap && t - (AU.last[k] || 0) < gap) return; AU.last[k] = t; if (!G.muted && SFX[k]) { try { SFX[k](); } catch (e) { /* a sound isn't worth stopping the game for */ } } };
  // the music: a palm-muted riff in E through distortion, scheduled a little ahead from the frame loop, so it stops when the frames do
  const RIFF = [0, 0, 12, 0, 0, 7, 0, 0, 10, 0, 3, 0, 0, 5, 6, 7];
  function playMusic() {
    const a = audio(); if (!a || !AU.music) return; const beat = 0.1;
    if (G.musicAt < a.currentTime) G.musicAt = a.currentTime + 0.05;
    while (G.musicAt < a.currentTime + 0.18) { const i = G.musicStep++ % 64, st = RIFF[i % 16] + (i >= 48 ? 3 : 0), f = 82.41 * Math.pow(2, st / 12), at = G.musicAt - a.currentTime;
      tone(f, f * 0.995, beat * 0.85, 0.5, "sawtooth", at, AU.music); if (i % 4 === 0) tone(95, 40, 0.09, 0.32, "sine", at); G.musicAt += beat; }
  }

  // ---------------------------------------------------------------- the simulation
  const solidAt = (L, x, y) => { if (x < 0 || y < 0 || x >= L.gw || y >= L.gh) return true; const c = (y | 0) * L.gw + (x | 0), v = L.g[c]; if (!v) return false; if (v === DOOR) return L.doors.get(c).open < 0.75; return true; };
  const blocked = (L, x, y, r) => solidAt(L, x - r, y - r) || solidAt(L, x + r, y - r) || solidAt(L, x - r, y + r) || solidAt(L, x + r, y + r);
  function slide(L, o, dx, dy, r) { if (dx && !blocked(L, o.x + dx, o.y, r)) o.x += dx; if (dy && !blocked(L, o.x, o.y + dy, r)) o.y += dy; }
  // One ray through the grid (DDA), for the renderer, shots and sight alike. Fills RAY: distance, what it hit, the texture column.
  const RAY = { d: 0, v: 0, u: 0, side: 0, cell: -1 };
  function cast(L, x, y, rx, ry) {
    const { g, gw, gh } = L; rx = rx || 1e-9; ry = ry || 1e-9;
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1; let mx = x | 0, my = y | 0, tx = (rx < 0 ? x - mx : mx + 1 - x) * ddx, ty = (ry < 0 ? y - my : my + 1 - y) * ddy;
    for (let s = 0; s < 256; s++) { let side; if (tx < ty) { tx += ddx; mx += sx; side = 0; } else { ty += ddy; my += sy; side = 1; }
      if (mx < 0 || my < 0 || mx >= gw || my >= gh) break;
      const c = my * gw + mx, v = g[c]; if (!v) continue; const d = side ? ty - ddy : tx - ddx;
      if (v === DOOR) { const dr = L.doors.get(c); if ((side === 0) !== dr.alongX) continue;   // a door is a plane across its corridor, halfway through the cell, sliding sideways as it opens
        const dd = d + (side ? ddy : ddx) / 2, hit = side ? x + dd * rx : y + dd * ry; if (Math.floor(hit) !== (side ? mx : my)) continue; const f = hit - Math.floor(hit); if (f < dr.open) continue;
        RAY.d = dd; RAY.v = DOOR; RAY.u = f - dr.open; RAY.side = side; RAY.cell = c; return RAY; }
      const hit = side ? x + d * rx : y + d * ry; RAY.d = d; RAY.v = v; RAY.u = hit - Math.floor(hit); RAY.side = side; RAY.cell = c; return RAY; }
    RAY.d = 64; RAY.v = 1; RAY.u = 0; RAY.side = 0; RAY.cell = -1; return RAY;
  }
  const clearLine = (L, x0, y0, x1, y1) => { const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1e-6; return cast(L, x0, y0, dx / d, dy / d).d >= d; };
  // what a shot along this angle hits: the nearest live enemy in front of the first wall, or null (and where the wall was)
  function shotHits(L, ang, range) {
    const me = G.me, c = Math.cos(ang), s = Math.sin(ang), wall = Math.min(range, cast(L, me.x, me.y, c, s).d); let best = null, bt = wall;
    for (const e of L.enemies) { if (e.dead) continue; const dx = e.x - me.x, dy = e.y - me.y, t = dx * c + dy * s; if (t <= 0 || t >= bt) continue; if (Math.abs(dx * s - dy * c) < e.K.r + 0.1) { best = e; bt = t; } }
    return { e: best, t: bt, x: me.x + c * bt, y: me.y + s * bt };
  }
  const addBits = (L, x, y, n, col, speed = 2, z = 0.45) => { if (L.bits.length > 260) return; for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = speed * (0.3 + Math.random() * 0.8);
    L.bits.push({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 0.6 + Math.random() * 1.6, t: 0.35 + Math.random() * 0.45, col, s: 0.02 + Math.random() * 0.035 }); } };
  const inkOf = L => abgr(...rgbOf(hexMix(L.base, "#b91c1c", 0.55)));
  function hurtEnemy(L, e, dmg) {
    if (e.dead) return; e.hp -= dmg; e.flash = 0.09; wake(L, e); addBits(L, e.x, e.y, 3, inkOf(L)); sfx("hit", 50);
    if (e.hp <= 0) return killEnemy(L, e);
    if (Math.random() < e.K.pain) { e.st = "pain"; e.t = 0.16; sfx("pain", 180); }
  }
  function killEnemy(L, e) {
    const me = G.me; e.dead = 0.001; e.st = "dead"; L.kills++; G.combo = G.comboT > 0 ? G.combo + 1 : 1; G.comboT = 2.5; me.grin = 0.8;
    const points = Math.round(e.K.score * (e.stale ? 1.5 : 1) * Math.min(5, G.combo)); me.score += points;
    G.feed.unshift({ text: `${clip(e.name, 40)}  +${points}${G.combo > 1 ? `  ×${Math.min(5, G.combo)}` : ""}`, t: 4 }); G.feed.length = Math.min(G.feed.length, 5);
    addBits(L, e.x, e.y, e === L.boss ? 70 : 14, inkOf(L), e === L.boss ? 5 : 2.6);
    if (e === L.boss) { L.open = true; G.msg = { text: "Exit open", t: 4 }; sfx("bossdie"); me.shake = 1; } else sfx("die", 60);
    if (e.drop || Math.random() < 0.28) { const owned = GUNS.filter(g => g.ammo && me.guns.includes(g.key)).map(g => g.ammo); L.items.push({ type: owned[Math.floor(Math.random() * owned.length)] || "bullets", x: e.x, y: e.y, placed: false }); }
  }
  function wake(L, e) { if (e.awake || e.dead) return; e.awake = true; e.st = "chase"; L.enemies.forEach(o => { if (!o.awake && !o.dead && o.room === e.room && Math.hypot(o.x - e.x, o.y - e.y) < 7) { o.awake = true; o.st = "chase"; } }); }
  function hurtMe(dmg, fromX, fromY, name) {
    const me = G.me; if (me.hp <= 0) return; const toArmor = Math.min(me.armor, Math.floor(dmg / 3)); me.armor -= toArmor; me.hp = Math.max(0, Math.round(me.hp - (dmg - toArmor)));
    me.hurt = Math.min(1, me.hurt + 0.35 + dmg / 60); me.shake = Math.max(me.shake, 0.3 + dmg / 60); me.hurtDir = Math.atan2(fromY - me.y, fromX - me.x); sfx("hurt", 150);
    if (me.hp <= 0) { G.killer = name; G.state = "dead"; setPlaying(false); G.best = Math.max(G.best, me.score); save(); sfx("bossdie"); }
  }
  function shootAt(L, e, dmg, speed, spread) {
    const me = G.me, n = e.K.fan || 1, a0 = Math.atan2(me.y - e.y, me.x - e.x) + (Math.random() - 0.5) * spread;
    for (let i = 0; i < n; i++) { const a = a0 + (i - (n - 1) / 2) * 0.22; L.shots.push({ x: e.x + Math.cos(a) * 0.3, y: e.y + Math.sin(a) * 0.3, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, sprite: e === L.boss ? "bossball" : "fireball", splash: 0, mine: false, name: e.name, life: 5 }); }
    sfx("spit", 120);
  }
  function stepEnemy(L, e, dt) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.dead) { e.dead += dt; return; }
    const me = G.me, K = e.K, dx = me.x - e.x, dy = me.y - e.y, d = Math.hypot(dx, dy) || 1e-6; e.look -= dt;
    if (e.look <= 0) { e.look = 0.22 + Math.random() * 0.15; e.sight = d < 18 && clearLine(L, e.x, e.y, me.x, me.y); if (e.sight) wake(L, e); }
    if (!e.awake) return;
    if (e.st === "pain") { e.t -= dt; if (e.t <= 0) e.st = "chase"; return; }
    if (e.st === "attack") { e.t -= dt; if (e.t <= 0) { e.st = "chase"; e.cd = K.every * (0.7 + Math.random() * 0.6);
        if (e.melee) { if (d < K.r + 0.85) hurtMe(K.melee * (1 + 0.05 * L.i), e.x, e.y, e.name); } else if (e.sight) shootAt(L, e, K.ranged * (1 + 0.05 * L.i), K.shot, 0.1); } return; }
    e.cd -= dt;
    if (e.cd <= 0) { if (d < K.r + 0.65) { e.st = "attack"; e.t = 0.22; e.melee = true; return; }
      if (K.ranged && e.sight && d < 14) { e.st = "attack"; e.t = 0.38; e.melee = false; return; } }
    if (d < K.r + 0.45 || (K.shot > 8 && e.sight && d < 3.5)) return;   // close enough, or a spitter keeping its distance
    let mx = dx / d, my = dy / d;
    if (!e.sight) { const c = (e.y | 0) * L.gw + (e.x | 0), here = L.flow[c]; let best = here < 0 ? 1e9 : here, tx = 0, ty = 0, go = false;   // out of sight: downhill on the distance map
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const f = L.flow[c + oy * L.gw + ox]; if (f >= 0 && f < best) { best = f; tx = (e.x | 0) + ox + 0.5; ty = (e.y | 0) + oy + 0.5; go = true; } }
      if (!go) return; const q = Math.hypot(tx - e.x, ty - e.y) || 1e-6; mx = (tx - e.x) / q; my = (ty - e.y) / q; }
    e.walk += dt * K.speed * 2.2; slide(L, e, mx * K.speed * dt, my * K.speed * dt, Math.min(0.42, K.r));
  }
  function stepShots(L, dt) {
    const me = G.me, explode = s => { addBits(L, s.x, s.y, s.splash ? 26 : 6, s.sprite === "plasma" ? abgr(56, 189, 248) : abgr(249, 115, 22), s.splash ? 4.5 : 1.6);
      if (!s.splash) return; sfx("boom"); me.shake = Math.max(me.shake, 0.6); L.enemies.forEach(e => { if (e.dead) return; const d = Math.hypot(e.x - s.x, e.y - s.y); if (d < s.splash && clearLine(L, s.x, s.y, e.x, e.y)) hurtEnemy(L, e, s.dmg * (1 - d / s.splash * 0.7)); });
      const dm = Math.hypot(me.x - s.x, me.y - s.y); if (dm < s.splash * 0.7) hurtMe(Math.round(s.dmg * 0.25 * (1 - dm / s.splash)), s.x, s.y, "your own rocket"); };
    L.shots = L.shots.filter(s => { s.life -= dt; if (s.life <= 0) return false;
      for (let k = 0; k < 3; k++) { s.x += s.vx * dt / 3; s.y += s.vy * dt / 3;
        if (solidAt(L, s.x, s.y)) { explode(s); return false; }
        if (s.mine) { const e = L.enemies.find(o => !o.dead && Math.hypot(o.x - s.x, o.y - s.y) < o.K.r + 0.12); if (e) { if (!s.splash) hurtEnemy(L, e, s.dmg); explode(s); return false; } }
        else if (Math.hypot(me.x - s.x, me.y - s.y) < 0.38) { hurtMe(s.dmg, s.x - s.vx, s.y - s.vy, s.name); explode(s); return false; } }
      return true; });
  }
  function fire() {
    const me = G.me, L = G.L, gun = GUNS.find(g => g.key === me.gun); if (me.cool > 0 || me.swap > 0) return;
    if (gun.ammo && me.ammo[gun.ammo] <= 0) { sfx("click", 200); bestGun(); return; }
    if (gun.ammo) me.ammo[gun.ammo]--;
    me.cool = gun.rate; me.kick = 1; me.flash = gun.ammo ? 1 : 0; sfx(gun.sfx); me.shake = Math.max(me.shake, (gun.kick || 0) * 0.22);
    if (gun.ammo) L.enemies.forEach(e => { if (!e.awake && !e.dead && Math.hypot(e.x - me.x, e.y - me.y) < 9) wake(L, e); });   // noise
    const c = Math.cos(me.a), s = Math.sin(me.a);
    if (gun.proj) { L.shots.push({ x: me.x + c * 0.3, y: me.y + s * 0.3, vx: c * gun.proj.speed, vy: s * gun.proj.speed, dmg: gun.dmg, splash: gun.proj.splash, sprite: gun.proj.sprite, mine: true, life: 4, name: "" }); return; }
    for (let i = 0; i < gun.pellets; i++) { const hit = shotHits(L, me.a + (Math.random() - 0.5) * 2 * gun.spread, gun.range); if (hit.e) hurtEnemy(L, hit.e, gun.dmg * (0.8 + Math.random() * 0.4)); else if (gun.ammo) addBits(L, hit.x - c * 0.04, hit.y - s * 0.04, 2, abgr(214, 211, 209), 0.8, 0.5); }
  }
  const usable = key => { const me = G.me, g = GUNS.find(x => x.key === key); return me.guns.includes(key) && (!g.ammo || me.ammo[g.ammo] > 0); };
  function selectGun(key) { const me = G.me; if (me.gun !== key && usable(key)) { me.gun = key; me.swap = 0.22; sfx("click"); } }
  function bestGun() { const pick = ["shotgun", "chaingun", "plasma", "pistol", "rocket", "fist"].find(usable); if (pick) selectGun(pick); }
  function cycleGun() { const owned = GUNS.filter(g => usable(g.key)), i = owned.findIndex(g => g.key === G.me.gun); if (owned.length) selectGun(owned[(i + 1) % owned.length].key); }
  function takeItems(L) {
    const me = G.me;
    L.items = L.items.filter(it => { if (Math.hypot(it.x - me.x, it.y - me.y) > 0.62) return true; let said = null;
      if (it.type === "gun") { const g = GUNS.find(x => x.key === it.gun); if (!me.guns.includes(g.key)) me.guns.push(g.key); if (g.ammo) me.ammo[g.ammo] = Math.min(AMMO_MAX[g.ammo], me.ammo[g.ammo] + GUN_AMMO[g.ammo]); me.gun = g.key; me.swap = 0.3; said = g.name; sfx("gun"); }
      else { const def = ITEMS[it.type]; if (def.ammo) { const [k, n] = def.ammo; if (me.ammo[k] >= AMMO_MAX[k]) return true; me.ammo[k] = Math.min(AMMO_MAX[k], me.ammo[k] + n); said = `+${n} ${k}`; } else { said = def.take(me); if (!said) return true; } sfx("pickup"); }
      if (it.placed) L.itemsGot++; G.msg = { text: said, t: 1.4 }; return false; });
  }
  function stepDoors(L, dt) {
    const me = G.me;
    for (const dr of L.doors.values()) { const near = Math.hypot(dr.x - me.x, dr.y - me.y) < 1.7 || L.enemies.some(e => e.awake && !e.dead && Math.hypot(dr.x - e.x, dr.y - e.y) < 1.2);
      if (near) { if (dr.open === 0) sfx("door", 200); dr.hold = 1.6; } else dr.hold -= dt;
      dr.open = clamp(dr.open + (dr.hold > 0 ? 2.6 : -1.8) * dt, 0, 1); }
  }
  function step(dt, now) {
    const L = G.L, me = G.me, keys = G.keys, has = (...k) => k.some(x => keys.has(x)), T = G.touch; L.time += dt;
    // walk: keys and the stick; momentum, sliding along walls
    const fwd = (has("w", "arrowup") ? 1 : 0) - (has("s", "arrowdown") ? 1 : 0) + (T.stick ? T.stick.go : 0), side = (has("d") ? 1 : 0) - (has("a") ? 1 : 0) + (T.stick ? T.stick.side : 0);
    me.a += ((has("arrowright", "e") ? 1 : 0) - (has("arrowleft", "q") ? 1 : 0)) * 2.6 * dt;
    const c = Math.cos(me.a), s = Math.sin(me.a), len = Math.max(1, Math.hypot(fwd, side)), speed = 5.2, wx = (c * fwd - s * side) / len * speed, wy = (s * fwd + c * side) / len * speed, grip = Math.min(1, dt * 10);
    me.vx += (wx - me.vx) * grip; me.vy += (wy - me.vy) * grip; if (!fwd && !side && Math.hypot(me.vx, me.vy) < 0.08) me.vx = me.vy = 0;   // momentum ends, it does not fade for ever
    slide(L, me, me.vx * dt, me.vy * dt, 0.24);
    me.bob += Math.hypot(me.vx, me.vy) * dt * 2.1;
    stepDoors(L, dt);
    const cell = (me.y | 0) * L.gw + (me.x | 0); if (cell !== L.flowCell && now - L.flowAt > 150) { L.flowCell = cell; L.flowAt = now; fillFlow(L, me.x | 0, me.y | 0); }
    L.enemies.forEach(e => stepEnemy(L, e, dt));
    const live = L.enemies.filter(e => e.awake && !e.dead);   // shoulder to shoulder: awake enemies push apart
    for (let i = 0; i < live.length; i++) { const a = live[i]; for (let j = i + 1; j < live.length; j++) { const b = live[j], dx = b.x - a.x, dy = b.y - a.y, min = a.K.r + b.K.r, q = dx * dx + dy * dy; if (q >= min * min || q < 1e-6) continue; const d = Math.sqrt(q), p = (min - d) * 0.25 / d; slide(L, a, -dx * p, -dy * p, 0.2); slide(L, b, dx * p, dy * p, 0.2); } }
    stepShots(L, dt); if (G.state !== "play") return;
    L.bits = L.bits.filter(b => { b.t -= dt; b.vz -= 5 * dt; b.z += b.vz * dt; if (b.z < 0.02) { b.z = 0.02; b.vz = 0; b.vx *= 0.7; b.vy *= 0.7; } b.x += b.vx * dt; b.y += b.vy * dt; return b.t > 0; });
    takeItems(L);
    if (G.firing || keys.has(" ")) fire();
    me.cool = Math.max(0, me.cool - dt); me.swap = Math.max(0, me.swap - dt); me.kick = Math.max(0, me.kick - dt * 6); me.flash = Math.max(0, me.flash - dt * 14); me.hurt = Math.max(0, me.hurt - dt * 1.5); me.shake = Math.max(0, me.shake - dt * 3.2); me.grin = Math.max(0, me.grin - dt);
    G.comboT = Math.max(0, G.comboT - dt); G.intro = Math.max(0, G.intro - dt); G.feed.forEach(f => { f.t -= dt; }); G.feed = G.feed.filter(f => f.t > 0); if (G.msg && (G.msg.t -= dt) <= 0) G.msg = null;
    if (L.open && Math.hypot(me.x - L.exit.x, me.y - L.exit.y) < 0.65) finishLevel();
    if (G.state === "play" && !G.muted) playMusic();
  }

  // ---------------------------------------------------------------- the renderer: a raycaster in a small framebuffer
  const R = { rw: 0, rh: 0, cv: null, c: null, img: null, fb: null, z: null, f: 1, pl: 0.66, cy: 0 };
  function buffers(viewH) {
    const rh = clamp(Math.round(viewH / 3), MOBILE ? 150 : 180, 300), rw = clamp(Math.round(rh * W / Math.max(1, viewH)), 120, 720);
    if (R.rw === rw && R.rh === rh) return;
    R.rw = rw; R.rh = rh; R.cv = offscreen(rw, rh); R.c = R.cv.getContext("2d"); R.img = R.c.createImageData(rw, rh); R.fb = new Uint32Array(R.img.data.buffer); R.z = new Float32Array(rw);
    R.pl = clamp(rw / (2 * rh), 0.55, 1); R.f = rw / (2 * R.pl);   // square pixels at any shape of pane, a wide view on a wide pane
  }
  const bandOf = d => (clamp(1.2 - d / 12, 0.1, 1) * 16 | 0) * 16;   // the light falls off in steps
  function render3D(now) {
    const L = G.L, me = G.me, { rw, rh, fb, z: Z, f, pl } = R, tex = levelTextures(L), { F, gw, gh } = L;
    const reduced = reducedMotion(), shakeX = reduced ? 0 : (Math.random() - 0.5) * me.shake * 6, shakeY = reduced ? 0 : (Math.random() - 0.5) * me.shake * 5, bobY = reduced ? 0 : Math.sin(me.bob) * 1.2;
    const cy = (rh >> 1) + Math.round(shakeY + bobY); R.cy = cy;
    const dirX = Math.cos(me.a), dirY = Math.sin(me.a), plX = -dirY * pl, plY = dirX * pl, boost = (me.flash * 70) | 0;
    // floors and ceilings, one row at a time
    const lx = dirX - plX, ly = dirY - plY, sx = 2 * plX / rw, sy = 2 * plY / rw, exitTex = L.open ? tex.exitOn : tex.exitOff, pulse = 170 + (Math.sin(now / 200) * 70 | 0);
    for (let y = 0; y < rh; y++) { const p = Math.abs(y - cy) + 0.5, d = 0.5 * f / p, below = y > cy, s = Math.min(300, bandOf(d) + boost); let wx = me.x + d * lx, wy = me.y + d * ly, o = y * rw; const dx = d * sx, dy = d * sy;
      for (let x = 0; x < rw; x++, o++, wx += dx, wy += dy) { const u = (wx * TS) & 63, v = (wy * TS) & 63;
        if (!below) { fb[o] = lit(tex.ceil[v * TS + u], s); continue; }
        const ix = wx | 0, iy = wy | 0, ft = ix >= 0 && iy >= 0 && ix < gw && iy < gh ? F[iy * gw + ix] : 0;
        fb[o] = ft === EXIT_FLOOR ? lit(exitTex[v * TS + u], Math.max(s, pulse)) : lit(tex.floor[ft][v * TS + u], s); } }
    // walls and doors, one column at a time
    for (let x = 0; x < rw; x++) { const cam = 2 * (x + shakeX) / rw - 1, hit = cast(L, me.x, me.y, dirX + plX * cam, dirY + plY * cam), d = Math.max(0.05, hit.d), h = f / d; Z[x] = d;
      if (hit.cell >= 0 && !L.seen[hit.cell]) { L.seen[hit.cell] = 1; if (L.mini) { const m = L.mini.getContext("2d"); m.fillStyle = hit.v === DOOR ? "#fde047" : hexMix(L.base, "#ffffff", 0.2); m.fillRect(hit.cell % gw, Math.floor(hit.cell / gw), 1, 1); } }
      const t = hit.v === DOOR ? tex.door : tex.wall[hit.v] || tex.wall[1], u = Math.min(TS - 1, hit.u * TS | 0), s = Math.min(300, ((bandOf(d) * (hit.side ? 0.78 : 1)) | 0) + boost), y0 = Math.max(0, Math.ceil(cy - h / 2)), y1 = Math.min(rh, Math.ceil(cy + h / 2)), step_ = TS / h; let tv = (y0 - (cy - h / 2)) * step_, o = y0 * rw + x;
      for (let y = y0; y < y1; y++, o += rw, tv += step_) fb[o] = lit(t[(tv & 63) * TS + u], s); }
    // everything standing in the room, far to near, hidden column by column behind the walls
    const inv = 1 / (plX * dirY - dirX * plY), list = [], push = (owner, x, y, spr, h, zz, bright, white) => { const dx = x - me.x, dy = y - me.y, tX = inv * (dirY * dx - dirX * dy), tY = inv * (-plY * dx + plX * dy); if (tY < 0.18 || tY > 40) return; list.push([tY, rw / 2 * (1 + tX / tY), spr, h, zz, bright, white, owner]); };
    for (const e of L.enemies) { const K = e.K; let fr;
      if (e.dead) fr = e.dead < 0.11 ? 4 : e.dead < 0.22 ? 5 : 6; else if (e.st === "attack") fr = 2; else if (e.st === "pain" || e.flash > 0) fr = 3; else fr = e.awake ? (e.walk | 0) % 2 : ((now / 500 + e.max) | 0) % 2;
      const hover = K.z && !e.dead ? K.z + (reduced ? 0 : Math.sin(now / 240 + e.max) * 0.03) : 0; push(e, e.x, e.y, enemySprite(L, e.kind, e.stale, fr), K.h, hover, false, e.flash > 0 && !e.dead); }
    for (const it of L.items) push(null, it.x, it.y, itemSprite(it.type === "gun" ? "gun:" + it.gun : it.type), it.type === "gun" ? 0.4 : ITEMS[it.type].s, 0, false, false);
    for (const sh of L.shots) push(null, sh.x, sh.y, itemSprite(sh.sprite), sh.sprite === "rocket" ? 0.14 : 0.24, 0.42, true, false);
    push(null, L.exit.x, L.exit.y, itemSprite(L.open ? "beamOn" : "beamOff"), 1, 0, true, false);
    list.sort((a, b) => b[0] - a[0]);
    const labels = []; L.enemies.forEach(e => { e.vis = false; });
    for (const [tY, cx, spr, hUnits, zz, bright, white, owner] of list) { const unit = f / tY, h = unit * hUnits, w = h * spr.w / spr.h, bottom = cy + unit * (0.5 - zz), top = bottom - h, x0 = Math.max(0, Math.ceil(cx - w / 2)), x1 = Math.min(rw, Math.ceil(cx + w / 2)), y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(rh, Math.ceil(bottom)), s = bright ? 256 : Math.min(300, bandOf(tY) + boost), px = spr.px, sw = spr.w, sh_ = spr.h; let any = false;
      for (let x = x0; x < x1; x++) { if (Z[x] < tY) continue; any = true; const u = ((x - (cx - w / 2)) / w * sw) | 0;
        for (let y = y0, o = y0 * rw + x; y < y1; y++, o += rw) { const c = px[(((y - top) / h * sh_) | 0) * sw + u]; if (!(c >>> 24)) continue; fb[o] = white ? 0xffffffff : lit(c, s); } }
      if (owner && any) { owner.vis = true; if (!owner.dead && tY < 9) labels.push([owner, tY, cx, top]); } }
    // sparks and ink
    for (const b of L.bits) { const dx = b.x - me.x, dy = b.y - me.y, tX = inv * (dirY * dx - dirX * dy), tY = inv * (-plY * dx + plX * dy); if (tY < 0.2) continue; const cx = rw / 2 * (1 + tX / tY) | 0, unit = f / tY, y = (cy + unit * (0.5 - b.z)) | 0, n = Math.max(1, unit * b.s | 0); if (cx < 0 || cx >= rw || Z[cx] < tY) continue;
      for (let yy = Math.max(0, y); yy < Math.min(rh, y + n); yy++) for (let xx = cx; xx < Math.min(rw, cx + n); xx++) fb[yy * rw + xx] = b.col; }
    R.c.putImageData(R.img, 0, 0);
    return labels;
  }
  // the gun in your hands, drawn on the framebuffer in 320 x 200 units from the middle of the bottom edge
  function drawGun(now) {
    const me = G.me, c = R.c, u = R.rh / 200, reduced = reducedMotion(), sw = reduced ? 0 : Math.cos(me.bob * 0.5) * 7, bb = reduced ? 0 : Math.abs(Math.sin(me.bob * 0.5)) * 5, cx = R.rw / 2 + sw * u, gun = me.gun, recoil = me.kick * (gun === "fist" ? 0 : gun === "shotgun" || gun === "rocket" ? 13 : 7), base = R.rh + (bb + recoil + me.swap * 180) * u;
    const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(cx + x * u), Math.round(base - y * u), Math.ceil(w * u), Math.ceil(h * u)); };
    const tube = (y0, y1, w0, w1, col, hi) => { for (let y = y0; y < y1; y += 1 / u) { const k = (y - y0) / (y1 - y0), w = w0 + (w1 - w0) * k; r(-w / 2, y, w, 1 / u + 0.3, col); if (hi) r(-w / 2 + w * 0.2, y, w * 0.14, 1 / u + 0.3, hi); } };
    const flash = (y, big) => { if (me.flash <= 0) return; const s = me.flash * big; c.fillStyle = "#fef08a"; c.beginPath(); c.arc(cx, base - y * u, (14 + s * 22) * u, 0, 7); c.fill(); c.fillStyle = "#fff"; c.beginPath(); c.arc(cx, base - y * u, (6 + s * 10) * u, 0, 7); c.fill(); };
    const skin = "#c98a5e", skinD = "#94613f";
    if (gun === "fist") { const lift = me.kick * 34; r(36, 58 + lift, 44, 60, skin); r(40, 76 + lift, 40, 26, skinD); r(38, 92 + lift, 8, 12, skinD); r(50, 94 + lift, 8, 12, skin); r(62, 94 + lift, 8, 12, skinD); r(-82, 34, 40, 34, skinD); r(-78, 44, 32, 14, skin); }
    else if (gun === "pistol") { flash(86, 0.7); tube(38, 74, 26, 18, "#44403c", "#78716c"); r(-9, 80, 18, 8, "#292524"); r(-4, 84, 8, 4, "#a8a29e"); r(-11, 40, 22, 14, "#1c1917"); r(-24, 34, 12, 26, skin); r(12, 34, 12, 26, skinD); r(-24, 44, 12, 3, skinD); }
    else if (gun === "shotgun") { flash(118, 1); r(-13, 116, 12, 96, "#44403c"); r(1, 116, 12, 96, "#44403c"); r(-11, 116, 3, 96, "#78716c"); r(3, 116, 3, 96, "#78716c"); r(-13, 118, 12, 4, "#1c1917"); r(1, 118, 12, 4, "#1c1917"); tube(46, 76, 40, 34, "#78350f", "#b45309"); tube(20, 46, 34, 40, "#451a03"); r(-44, 40, 18, 26, skin); r(26, 40, 18, 26, skinD); }
    else if (gun === "chaingun") { flash(124, 0.8); tube(30, 66, 66, 54, "#3f3f46", "#71717a"); const spin = (now / 45 | 0) % 3; [-14, -5, 4, 13].forEach((x, i) => r(x - 2, 118, 6, 60, (i + (me.kick > 0 ? spin : 0)) % 2 ? "#52525b" : "#27272a")); r(-22, 92, 44, 7, "#18181b"); r(-34, 24, 68, 18, skinD); }
    else if (gun === "rocket") { flash(100, 1.2); tube(28, 96, 74, 46, "#3f6212", "#65a30d"); r(-18, 98, 36, 8, "#1c1917"); r(-14, 96, 28, 6, "#0c0a09"); r(-38, 26, 76, 12, skinD); r(-30, 58, 60, 5, "#fde047"); }
    else { flash(104, 0.6); tube(28, 94, 70, 34, "#1e3a8a", "#3b82f6"); r(-14, 100, 28, 10, "#38bdf8"); r(-8, 98, 16, 6, "#e0f2fe"); [52, 66, 80].forEach(y => r(-22, y, 44, 3, "#38bdf8")); r(-36, 26, 72, 12, skinD); }
  }

  // ---------------------------------------------------------------- HUD and menus (in the pane's own pixels)
  const hudHeight = () => clamp(Math.round(H * 0.11), 54, 84);
  const text = (t, x, y, px, col, align = "left", font = FONT) => { ctx.font = `${px}px ${font}`; ctx.textAlign = align; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "rgba(0,0,0,.75)"; ctx.fillText(t, x + Math.max(1, px / 16), y + Math.max(1, px / 16)); ctx.fillStyle = col; ctx.fillText(t, x, y); };
  function drawFace(x, y, s) {
    const me = G.me, p = s / 16, hp = me.hp, skin = hp > 60 ? "#d29a6c" : hp > 30 ? "#c0805a" : "#a85a44", wander = Math.sin(performance.now() / 900), look = me.hurt > 0.2 ? Math.sign(Math.sin(me.hurtDir - me.a)) : wander > 0.75 ? 1 : wander < -0.75 ? -1 : 0;
    const r = (a, b, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x + a * p, y + b * p, w * p, h * p); };
    r(0, 0, 16, 16, "#1c1917"); r(3, 2, 10, 12, skin); r(2, 4, 1, 7, skin); r(13, 4, 1, 7, skin); r(3, 1, 10, 3, "#3f2a1c"); r(5, 6, 2, 2, "#fff"); r(9, 6, 2, 2, "#fff"); r(5 + (look > 0 ? 1 : 0), 6, 1, 2, "#111"); r(9 + (look > 0 ? 1 : 0), 6, 1, 2, "#111");
    if (me.grin > 0) { r(5, 11, 6, 2, "#fff"); r(5, 11, 6, 1, "#7f1d1d"); } else if (me.hurt > 0.3) r(6, 10, 4, 3, "#450a0a"); else r(6, 11, 4, 1, "#450a0a");
    if (hp <= 60) r(4, 3, 2, 3, "#b91c1c"); if (hp <= 30) { r(11, 8, 2, 4, "#b91c1c"); r(6, 13, 3, 1, "#b91c1c"); } if (hp <= 0) { r(5, 6, 2, 2, "#111"); r(9, 6, 2, 2, "#111"); }
  }
  function drawHud(viewH) {
    const me = G.me, L = G.L, hh = H - viewH, y = viewH, gun = GUNS.find(g => g.key === me.gun), n = Math.round(hh * 0.58), lab = Math.max(9, Math.round(hh * 0.15)), base = y + hh * 0.66, label = "#a8a29e", sans = "system-ui, sans-serif";
    const steel = ctx.createLinearGradient(0, y, 0, H); steel.addColorStop(0, "#44403c"); steel.addColorStop(0.08, "#292524"); steel.addColorStop(1, "#1c1917"); ctx.fillStyle = steel; ctx.fillRect(0, y, W, hh); ctx.fillStyle = "#78716c"; ctx.fillRect(0, y, W, 1);
    const cell = (x, w, value, name, col = "#ef4444") => { text(value, x + w / 2, base, n, col, "center"); text(name, x + w / 2, y + hh - 6, lab, label, "center", sans); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x + w, y + 4, 1, hh - 8); };
    const ammoShown = gun.ammo ? String(me.ammo[gun.ammo]) : "--", face = hh - 8, hpCol = me.hp <= 30 ? "#ef4444" : "#fbbf24";
    if (W < 620) { const w = (W - face - 8) / 4; cell(0, w, ammoShown, "AMMO"); cell(w, w, `${me.hp}`, "HEALTH", hpCol); drawFace(w * 2 + 4, y + 4, face); cell(w * 2 + face + 8, w, `${me.armor}`, "ARMOR", "#4ade80"); cell(w * 3 + face + 8, w, `${L.kills}/${L.total}`, "KILLS", "#e7e5e4"); return; }
    const w = (W - face - 8) / 2, mid = w + 4; cell(0, w * 0.28, ammoShown, gun.name.toUpperCase()); cell(w * 0.28, w * 0.32, `${me.hp}%`, "HEALTH", hpCol);
    // arms: a slot per gun, lit when you have it, bright for the one in hand
    const ax = w * 0.6, aw = w * 0.4, cw = aw / 3, rowH = (hh - lab - 10) / 2;
    GUNS.forEach((g, i) => text(String(i + 1), ax + cw * (i % 3) + cw / 2, y + 4 + rowH * (Math.floor(i / 3) + 1) - 2, Math.round(rowH * 0.95), g.key === me.gun ? "#fde047" : me.guns.includes(g.key) ? "#e7e5e4" : "#57534e", "center"));
    text("ARMS", ax + aw / 2, y + hh - 6, lab, label, "center", sans);
    drawFace(mid, y + 4, face);
    const rx = mid + face + 4; cell(rx, w * 0.22, `${me.armor}%`, "ARMOR", "#4ade80"); cell(rx + w * 0.22, w * 0.26, `${L.kills}/${L.total}`, "KILLS", "#e7e5e4"); cell(rx + w * 0.48, w * 0.28, String(me.score), "SCORE", "#e7e5e4");
    const px = rx + w * 0.78, pw = W - px - 8, rowA = (hh - 10) / 4; [["bullets", "#eab308"], ["shells", "#f87171"], ["rockets", "#a3e635"], ["cells", "#38bdf8"]].forEach(([k, col], i) => { const ly = y + 5 + rowA * (i + 1) - 2, sz = Math.max(9, Math.round(rowA * 0.82)); text(k, px, ly, sz, label, "left", sans); text(`${me.ammo[k]}`, px + pw, ly, sz, me.ammo[k] ? col : "#57534e", "right", sans); });
  }
  function drawMinimap(viewH, big) {
    const L = G.L, me = G.me, { gw, gh } = L;
    if (!L.mini) { L.mini = offscreen(gw, gh); const m = L.mini.getContext("2d"); L.seen.forEach((v, c) => { if (v) { m.fillStyle = L.g[c] === DOOR ? "#fde047" : hexMix(L.base, "#ffffff", 0.2); m.fillRect(c % gw, Math.floor(c / gw), 1, 1); } }); }
    const box = big ? Math.min(W, viewH) * 0.82 : clamp(Math.min(W, viewH) * 0.24, 90, 170), scale = big ? box / Math.max(gw, gh) : 3.5, ox = big ? (W - box) / 2 : W - box - 12, oy = big ? (viewH - box) / 2 : 12;
    const px = big ? ox + me.x * scale : ox + box / 2, py = big ? oy + me.y * scale : oy + box / 2, tx = big ? ox : px - me.x * scale, ty = big ? oy : py - me.y * scale;
    ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, box, box); ctx.clip(); ctx.fillStyle = big ? "rgba(0,0,0,.82)" : "rgba(0,0,0,.5)"; ctx.fillRect(ox, oy, box, box); ctx.imageSmoothingEnabled = false; ctx.drawImage(L.mini, tx, ty, gw * scale, gh * scale); ctx.imageSmoothingEnabled = true;
    const ex = tx + L.exit.x * scale, ey = ty + L.exit.y * scale; if (L.open || L.boss.vis) { ctx.fillStyle = L.open ? "#4ade80" : "#ef4444"; ctx.fillRect(ex - 3, ey - 3, 6, 6); }
    ctx.fillStyle = "#ef4444"; L.enemies.forEach(e => { if (!e.dead && e.vis) ctx.fillRect(tx + e.x * scale - 2, ty + e.y * scale - 2, 4, 4); });
    ctx.beginPath(); ctx.moveTo(px + Math.cos(me.a) * 8, py + Math.sin(me.a) * 8); ctx.lineTo(px + Math.cos(me.a + 2.5) * 6, py + Math.sin(me.a + 2.5) * 6); ctx.lineTo(px + Math.cos(me.a - 2.5) * 6, py + Math.sin(me.a - 2.5) * 6); ctx.closePath(); ctx.fillStyle = "#fff"; ctx.fill(); ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1; ctx.strokeRect(ox, oy, box, box);
  }
  function drawPlayOverlay(labels, viewH, font) {
    const L = G.L, me = G.me, sx = W / R.rw, sy = viewH / R.rh, aim = shotHits(L, me.a, 40).e, boss = L.boss;
    // names over the nearest enemies; the one in your sights gets its health bar
    labels.sort((a, b) => a[1] - b[1]).slice(0, 5).forEach(([e, d, x, top]) => { const px = Math.round(clamp(15 - d, 10, 13)), lx = x * sx, ly = Math.max(px + 2, top * sy - 6), f = `600 ${px}px ${font}`, t = clip(e.name, 34); ctx.font = f; const w = ctx.measureText(t).width; if (e !== aim && lx > 0 && lx < W && freeSpot(lx - w / 2, ly - px / 2 - 2, w, px + 4)) haloText(t, lx, ly, e.stale ? "#d9f99d" : "#fde68a", "rgba(12,10,9,.85)", f, "center"); });
    if (aim) { const w = Math.min(280, W * 0.6), x = W / 2 - w / 2, y = viewH * 0.5 + 26; text(clip(aim.name, 42), W / 2, y, 14, aim.stale ? "#d9f99d" : "#fde68a", "center", font); ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(x, y + 5, w, 6); ctx.fillStyle = "#ef4444"; ctx.fillRect(x, y + 5, w * Math.max(0, aim.hp / aim.max), 6);
      text(`${aim.K.name}${aim.stale ? ` · stale ${aim.age}d` : ""}`, W / 2, y + 26, 11, "#a8a29e", "center", font); }
    // the boss's bar once you've seen it
    if ((boss.awake || boss.vis) && !boss.dead) { const w = Math.min(520, W * 0.56), x = W / 2 - w / 2, y = 14; text(clip(boss.name, 48), W / 2, y + 10, 14, "#fca5a5", "center", font); ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(x, y + 15, w, 9); ctx.fillStyle = "#dc2626"; ctx.fillRect(x, y + 15, w * Math.max(0, boss.hp / boss.max), 9); }
    // crosshair
    const cx = W / 2, cy = (R.cy + 0.5) * sy; ctx.strokeStyle = aim ? "#f87171" : "rgba(245,245,244,.75)"; ctx.lineWidth = 1.5; ctx.beginPath(); [[-10, 0, -4, 0], [4, 0, 10, 0], [0, -10, 0, -4], [0, 4, 0, 10]].forEach(([a, b, c, d]) => { ctx.moveTo(cx + a, cy + b); ctx.lineTo(cx + c, cy + d); }); ctx.stroke();
    // what you've killed
    G.feed.forEach((f, i) => { ctx.globalAlpha = Math.min(1, f.t); text(f.text, 14, 24 + i * 19, 13, "#fca5a5", "left", font); }); ctx.globalAlpha = 1;
    if (G.combo > 1 && G.comboT > 0) text(`×${Math.min(5, G.combo)}`, W / 2, viewH * 0.3, 30 + Math.min(5, G.combo) * 3, "#fde047", "center");
    if (G.msg && G.state === "play") text(G.msg.text, W / 2, viewH * 0.2, 20, "#bbf7d0", "center", font);
    if (G.intro > 0 && G.state === "play") { ctx.globalAlpha = Math.min(1, G.intro); text(`LEVEL ${L.i + 1}`, W / 2, viewH * 0.3, 22, "#e7e5e4", "center"); text(clip(L.def.name.toUpperCase(), 34), W / 2, viewH * 0.3 + 44, Math.min(44, W / 16), "#fca5a5", "center"); text(`${plural(L.total, "note")} · boss: ${clip(L.boss.name, 34)}`, W / 2, viewH * 0.3 + 70, 14, "#e7e5e4", "center", font); ctx.globalAlpha = 1; }
    // pain from the side it came from, and a low-health pulse
    if (me.hurt > 0) { const side = Math.sin(me.hurtDir - me.a), gr = ctx.createLinearGradient(side > 0.2 ? W : side < -0.2 ? 0 : W / 2, 0, W / 2, viewH / 2); gr.addColorStop(0, `rgba(220,38,38,${me.hurt * 0.6})`); gr.addColorStop(1, `rgba(220,38,38,${me.hurt * 0.14})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, viewH); }
    if (me.hp <= 30 && !reducedMotion()) { ctx.fillStyle = `rgba(127,29,29,${0.12 + 0.1 * Math.sin(performance.now() / 260)})`; ctx.fillRect(0, 0, W, viewH); }
    drawMinimap(viewH, G.bigMap);
    if (G.showTouch) drawTouch(viewH);
  }
  // touch controls: left half walks, right half turns; fire and the other buttons are drawn where a thumb is
  const touchButtons = viewH => { const s = clamp(Math.min(W, H) * 0.13, 46, 72); return { fire: [W - s * 1.25, viewH - s * 1.25, s], swap: [W - s * 2.75, viewH - s * 0.85, s * 0.62], pause: [s * 0.7, s * 0.7, s * 0.5] }; };
  function drawTouch(viewH) {
    const b = touchButtons(viewH), T = G.touch, ring = ([x, y, r], label, on) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = on ? "rgba(239,68,68,.55)" : "rgba(255,255,255,.14)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 2; ctx.stroke(); text(label, x, y + 6, 15, "#fff", "center"); };
    ring(b.fire, "FIRE", T.fire != null); ring(b.swap, "GUN", false); ring(b.pause, "❚❚", false);
    if (T.stick) { ctx.beginPath(); ctx.arc(T.stick.x0, T.stick.y0, 44, 0, 7); ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.stroke(); ctx.beginPath(); ctx.arc(T.stick.x0 + T.stick.side * 44, T.stick.y0 - T.stick.go * 44, 18, 0, 7); ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.fill(); }
  }
  // menus: every button is one call, which draws it and registers it for the pointer; primary also answers Enter
  function button(x, y, w, h, label, run, primary) {
    const over = G.mx >= x && G.mx <= x + w && G.my >= y && G.my <= y + h; ctx.fillStyle = primary ? (over ? "#dc2626" : "#b91c1c") : over ? "#44403c" : "#292524"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = primary ? "#fca5a5" : "#78716c"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    text(label, x + w / 2, y + h / 2 + Math.round(h * 0.17), Math.round(h * 0.5), "#fff", "center"); G.ui.push({ x, y, w, h, run }); if (primary) G.primary = run;
  }
  const dim = a => { ctx.fillStyle = `rgba(12,10,9,${a})`; ctx.fillRect(0, 0, W, H); };
  function buttonRow(y, h, defs) { const gap = 12, w = Math.min(240, (W - 32 - gap * (defs.length - 1)) / defs.length), tw = w * defs.length + gap * (defs.length - 1); defs.forEach(([label, run, primary], i) => button((W - tw) / 2 + i * (w + gap), y, w, h, label, run, primary)); }
  function drawTitle(font) {
    dim(0.62); const ls = levelList(), small = H < 620 || W < 620, big = Math.min(small ? 54 : 96, W / 7); let y = small ? big + 62 : H * 0.2;   // on a phone, clear of the toolbar
    text("DUNGEON", W / 2, y, big, "#ef4444", "center"); y += small ? 22 : 34;
    if (!ls.length) { text("No notes yet.", W / 2, y, 16, "#e7e5e4", "center", font); return; }
    const total = ls.reduce((s, l) => s + l.notes.length, 0); text(`${plural(total, "note")} · ${plural(ls.length, "level")}${G.best ? ` · best ${G.best}` : ""}`, W / 2, y, small ? 13 : 16, "#e7e5e4", "center", font); y += small ? 14 : 26;
    const def = ls[G.sel], rowW = Math.min(520, W - 32), rx = (W - rowW) / 2, rowH = small ? 44 : 54;
    button(rx, y, 44, rowH, "<", () => pickLevel(-1)); button(rx + rowW - 44, y, 44, rowH, ">", () => pickLevel(1));
    text(`Level ${G.sel + 1} of ${ls.length}`, W / 2, y + rowH * 0.42, small ? 11 : 13, "#a8a29e", "center", font); text(clip(def.name, Math.floor(rowW / 12)), W / 2, y + rowH * 0.8, small ? 15 : 18, "#fff", "center", font); y += rowH + 10;
    buttonRow(y, small ? 42 : 52, [["START", () => startLevel(G.sel), true]]); y += (small ? 42 : 52) + (small ? 16 : 28);
    // who's who: the actual sprites, and what kind of note each one is
    const kinds = Object.keys(KINDS), perRow = W < 620 ? 3 : 6, cw = Math.min(150, (W - 24) / perRow), sp = Math.min(small ? 46 : 72, cw * 0.7), startX = (W - cw * perRow) / 2; ctx.imageSmoothingEnabled = false;
    kinds.forEach((k, i) => { const col = i % perRow, row = Math.floor(i / perRow), cx = startX + col * cw + cw / 2, cy = y + row * (sp + 38); ctx.drawImage(enemySprite(G.L, k, false, 0).cv, cx - sp / 2, cy, sp, sp); text(KINDS[k].name, cx, cy + sp + 13, 12, "#fff", "center", font); text(KINDS[k].is, cx, cy + sp + 27, 10, "#a8a29e", "center", font); });
    ctx.imageSmoothingEnabled = true; y += Math.ceil(kinds.length / perRow) * (sp + 38) + 8;
    if (y < H - 22) text(G.showTouch || MOBILE ? "Left thumb walks · right thumb turns · FIRE shoots" : "WASD move · mouse aim · click shoot · 1-6 guns · Tab map · N sound · Esc pause", W / 2, Math.max(y + 10, H - 16), 12, "#a8a29e", "center", font);
  }
  function drawCard(title, col, sub, font) { dim(0.72); const big = Math.min(72, W / 9); text(title, W / 2, H * 0.3, big, col, "center"); if (sub) text(sub, W / 2, H * 0.3 + 34, 15, "#e7e5e4", "center", font); return H * 0.3 + 58; }
  function drawTally(font) {
    const t = G.tally, won = t.last; let y = drawCard(won ? "VAULT CLEARED" : "LEVEL CLEARED", won ? "#fde047" : "#4ade80", `${t.name} · ${Math.floor(t.time / 60)}:${String(Math.floor(t.time % 60)).padStart(2, "0")}`, font);
    [["Kills", `${t.kills} / ${t.total}`], ["Items", `${t.items} / ${t.itemsTotal}`], ["Score", String(t.score)]].forEach(([a, b]) => { text(a, W / 2 - 12, y, 16, "#a8a29e", "right", font); text(b, W / 2 + 12, y, 16, "#fff", "left", font); y += 24; }); y += 8;
    if (t.top.length && opts.openNote) { text("Toughest kills", W / 2, y, 12, "#a8a29e", "center", font); y += 8; const w = Math.min(420, W - 32); t.top.forEach(e => { button((W - w) / 2, y, w, 30, clip(e.name, Math.floor(w / 10)), () => opts.openNote(e.id, true)); y += 34; }); y += 8; }
    buttonRow(y, 46, won ? [["TITLE", toTitle, true]] : [["NEXT LEVEL", () => startLevel(t.i + 1, true), true], ["TITLE", toTitle]]);
  }

  // ---------------------------------------------------------------- moving between screens
  function setPlaying(on) { root.classList.toggle("is-playing", on); if (!on) { G.firing = false; G.keys.clear(); G.touch = {}; try { if (root.ownerDocument.pointerLockElement === cv) root.ownerDocument.exitPointerLock(); } catch (e) { /* no lock to leave */ } } }
  const lockMouse = () => { if (G.showTouch || MOBILE || !cv.requestPointerLock) return; try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* holding the button still turns */ } };
  function showLevel(i) { G.level = i; G.L = buildLevel(i); const r = G.L.start; G.me = G.me || freshMe(i); G.me.x = r.cx + 0.5; G.me.y = r.cy + 0.5; G.me.a = Math.atan2(G.L.exit.y - G.me.y, G.L.exit.x - G.me.x); return G.L; }
  function startLevel(i, carry) {
    const ls = levelList(); if (!ls.length) return; i = clamp(i, 0, ls.length - 1); G.sel = i;
    if (!carry) G.me = freshMe(i);
    showLevel(i); Object.assign(G.me, { vx: 0, vy: 0, kick: 0, flash: 0, hurt: 0, shake: 0, cool: 0 });
    G.snap = { hp: G.me.hp, armor: G.me.armor, ammo: { ...G.me.ammo }, guns: G.me.guns.slice(), gun: G.me.gun, score: G.me.score };
    G.feed = []; G.msg = null; G.combo = 0; G.comboT = 0; G.intro = 3; G.bigMap = false; G.tally = null; G.state = "play"; setPlaying(true); audio(); lockMouse(); dirty = true; kick();
  }
  function retry() { const snap = G.snap, i = G.level; G.me = Object.assign(freshMe(i), snap, { ammo: { ...snap.ammo }, guns: snap.guns.slice() }); startLevel(i, true); }
  function toTitle() { setPlaying(false); G.state = "title"; G.me = null; G.tally = null; G.L = null; dirty = true; kick(); }
  function finishLevel() {
    const L = G.L, me = G.me, ls = levelList(), last = L.i >= ls.length - 1, top = L.enemies.filter(e => e.dead).sort((a, b) => b.max - a.max).slice(0, 3);
    G.tally = { i: L.i, name: L.def.name, last, kills: L.kills, total: L.total, items: L.itemsGot, itemsTotal: L.itemsTotal, time: L.time, score: me.score, top: top.map(e => ({ id: e.id, name: e.name })) };
    G.reached = Math.max(G.reached, Math.min(ls.length - 1, L.i + 1)); G.best = Math.max(G.best, me.score); save(); G.state = "tally"; setPlaying(false); sfx("exit");
  }
  function pause() { if (G.state !== "play") return; G.state = "paused"; G.pausedAt = performance.now(); setPlaying(false); dirty = true; kick(); }
  function resume() { if (G.state !== "paused") return; G.state = "play"; setPlaying(true); lockMouse(); dirty = true; kick(); }
  const pickLevel = d => { const n = levelList().length; if (!n) return; G.sel = (G.sel + d + n) % n; G.L = null; G.me = null; sfx("click"); dirty = true; kick(); };

  // ---------------------------------------------------------------- input: the scene owns the canvas's pointer and its keys
  const MENU_KEYS = /^(enter| |arrowleft|arrowright|n)$/;
  const inRing = ([x, y, r], px, py) => Math.hypot(x - px, y - py) <= r * 1.15;
  function pointer(phase, e, x, y) {
    G.mx = x; G.my = y; const T = G.touch, isTouch = e.pointerType === "touch", id = e.pointerId;
    if (isTouch && !G.showTouch) G.showTouch = true;
    if (G.state !== "play") {
      if (phase === "up") { const b = G.ui.find(o => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h); if (b) { sfx("click"); b.run(); } }
      dirty = true; kick(); return true;
    }
    if (!isTouch) {   // the mouse: captured, it looks; a click shoots. A pane that can't capture it still turns while the button's held.
      const locked = root.ownerDocument.pointerLockElement === cv;
      if (phase === "down") { if (!locked) lockMouse(); if (e.button === 0) G.firing = true; }
      else if (phase === "move") { if (locked || e.buttons) G.me.a += (e.movementX || 0) * 0.0026; }
      else if (phase === "up" || phase === "cancel") G.firing = false;
      return true;
    }
    const viewH = H - hudHeight(), b = touchButtons(viewH);
    if (phase === "down") { try { cv.setPointerCapture(id); } catch (err) { /* a pointer that's gone needs no capture */ }
      if (inRing(b.fire, x, y)) { T.fire = id; G.firing = true; }
      else if (inRing(b.swap, x, y)) cycleGun();
      else if (inRing(b.pause, x, y)) pause();
      else if (x < W / 2 && !T.stick) T.stick = { id, x0: x, y0: y, go: 0, side: 0 };
      else if (!T.look) T.look = { id, x }; }
    else if (phase === "move") {
      if (T.stick && T.stick.id === id) { T.stick.go = clamp((T.stick.y0 - y) / 44, -1, 1); T.stick.side = clamp((x - T.stick.x0) / 44, -1, 1); }
      if (T.look && T.look.id === id) { G.me.a += (x - T.look.x) * 0.0065; T.look.x = x; } }
    else { if (T.fire === id) { T.fire = null; G.firing = false; } if (T.stick && T.stick.id === id) T.stick = null; if (T.look && T.look.id === id) T.look = null; }
    return true;
  }
  function key(k, down) {
    if (k === "n" && down && !G.keys.has("n")) { G.muted = !G.muted; if (G.muted && AU.ctx) AU.ctx.suspend().catch(() => {}); save(); G.msg = { text: G.muted ? "Sound off" : "Sound on", t: 1.2 }; }
    if (G.state !== "play") { if (!down) { G.keys.delete(k); return; } if (G.keys.has(k)) return; G.keys.add(k);
      if (k === "enter" || (k === " " && G.state === "title")) { if (G.primary) G.primary(); }
      else if (G.state === "title" && k === "arrowleft") pickLevel(-1); else if (G.state === "title" && k === "arrowright") pickLevel(1); dirty = true; return; }
    if (!down) { G.keys.delete(k); if (k === "tab") G.bigMap = false; return; }
    const fresh = !G.keys.has(k); G.keys.add(k); if (!fresh) return;
    const slot = GUNS[+k - 1]; if (/^[1-6]$/.test(k) && slot) selectGun(slot.key);
    else if (k === "r") cycleGun();
    else if (k === "tab") G.bigMap = true;
    else if (k === "p") pause();
  }

  // ---------------------------------------------------------------- the scene
  scene("dungeon", {
    name: "Dungeon", icon: "dungeon", fps: 60, game: true,
    blurb: "A first-person shooter: every note is an enemy, every topic a level",
    toast: "Dungeon — every note is an enemy, every topic a level",
    layout() {   // the notes need places for the rest of the graph (fit, search); the game itself plays on its own levels
      G.levels = null; const pos = new Map(), span = 800; nodes.forEach(n => { const [u, v] = scatter("dg:" + n.id); pos.set(n.id, [u * span, v * span]); });
      if (G.state === "title") { G.L = null; G.me = null; }
      return { pos, bounds: [[0, 0], [span, 0], [span, span], [0, span]] };
    },
    fit: n => !n.ghost,
    keys: { test: k => G.state === "play" ? !/^f\d+$/.test(k) && k !== "escape" : MENU_KEYS.test(k) },
    key,
    pointer,
    wheel() { if (G.state === "play") cycleGun(); },
    escape() { if (G.state === "play") { pause(); return true; } if (G.state === "paused") { if (performance.now() - G.pausedAt > 400) resume(); return true; } return false; },
    release() { G.keys.clear(); G.touch = {}; G.firing = false; pause(); },
    state: G,   // for tests/test_dungeon.js
    api: { startLevel, hurtMe, killEnemy, retry, toTitle, levelList, shotHits, solidAt },
    draw(now) {
      const { font } = mapFrame(), hud = G.state === "title" ? 0 : hudHeight(), viewH = H - hud; G.ui = []; G.primary = null;
      const dt = Math.min(0.05, (now - (G.last || now)) / 1000); G.last = now;
      const locked = root.ownerDocument.pointerLockElement === cv; if (G.locked && !locked && G.state === "play") pause(); G.locked = locked;
      const ls = levelList(); if (G.sel >= ls.length) G.sel = Math.max(0, ls.length - 1);
      if (!ls.length) { ctx.fillStyle = "#0c0a09"; ctx.fillRect(0, 0, W, H); drawTitle(font); return; }
      if (!G.L) showLevel(G.sel);
      if (G.state === "play") step(dt, now); else if (G.state === "title" && !reducedMotion()) G.me.a += dt * 0.12;
      buffers(viewH);
      const labels = render3D(now);
      if (G.state !== "title") drawGun(now);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(R.cv, 0, 0, R.rw, R.rh, 0, 0, W, viewH); ctx.imageSmoothingEnabled = true;
      if (G.state !== "title") { drawPlayOverlay(labels, viewH, font); drawHud(viewH); }
      if (G.state === "title") drawTitle(font);
      else if (G.state === "paused") { const y = drawCard("PAUSED", "#e7e5e4", `Level ${G.level + 1} · ${G.L.def.name}`, font); buttonRow(y, 46, [["RESUME", resume, true], ["RESTART", retry], ["TITLE", toTitle]]); }
      else if (G.state === "dead") { const y = drawCard("YOU DIED", "#ef4444", `Killed by ${clip(G.killer, 46)}`, font); text(`Score ${G.me.score}`, W / 2, y, 15, "#e7e5e4", "center", font); buttonRow(y + 16, 46, [["TRY AGAIN", retry, true], ["TITLE", toTitle]]); }
      else if (G.state === "tally") drawTally(font);
      setSceneStat(G.state === "title" ? `${plural(ls.reduce((s, l) => s + l.notes.length, 0), "note")} to kill` : `Level ${G.level + 1} · ${G.L.def.name} · ${G.L.kills}/${G.L.total} killed`);
    },
    legend: item => item("<b style='color:#ef4444'>✛</b>", "every note is an enemy") + item("▮", "every topic is a level"),
  });
