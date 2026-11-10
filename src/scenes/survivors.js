  // Vault Survivors: five minutes in a swarm of your notes. You move, the gun aims itself. A note is the same enemy as in the
  // Dungeon (VGRules.foeKind); the longest notes come as bosses, one a minute. What falls from a note is its tags, and they
  // decide which upgrades come up. It only reads the vault: nothing here touches a note.
  ICON.survivors = '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="8"/>';
  const SV_SECONDS = 300, SV_CAP = 110, SV_SCALE = 26, SV_ME_R = 11;
  const SV_COLOUR = { wisp: "#8fb8d8", grunt: "#c9c1b8", spitter: "#79c7a0", hunter: "#e9a95e", brute: "#c98bd9", boss: "#e0796f" };
  // the upgrade a tag's namespace gives; anything else improves health
  const SV_UPGRADES = {
    technology: { name: "Faster fire", apply: me => { me.rate *= 0.85; } },
    project: { name: "Heavier shots", apply: me => { me.dmg *= 1.25; } },
    activity: { name: "Shots go through", apply: me => { me.pierce += 1; } },
    type: { name: "Longer reach", apply: me => { me.reach *= 1.2; } },
    feature: { name: "Faster feet", apply: me => { me.speed *= 1.12; } },
    health: { name: "More health", apply: me => { me.maxHp += 25; me.hp = Math.min(me.maxHp, me.hp + 40); } },
  };
  const SV = { state: "title", t: 0, me: null, foes: [], shots: [], gems: [], score: 0, kills: 0, xp: 0, level: 1, need: 6, spawn: 0, bossAt: 60, bosses: [], pool: [], stats: null, tags: new Map(), choices: [], keys: new Set(), stick: null, buttons: [], last: 0, won: false, killer: "", newBest: false };
  const svNotes = () => nodes.filter(n => !n.ghost);
  function svStart() {
    const all = svNotes(); if (!all.length) return;
    SV.stats = VGRules.foeStats(all); SV.pool = all.slice(); SV.bosses = all.filter(n => (n.words || 0) > 0).sort((a, b) => (b.words || 0) - (a.words || 0)).slice(0, 5);
    Object.assign(SV, { state: "play", t: 0, foes: [], shots: [], gems: [], score: 0, kills: 0, xp: 0, level: 1, need: 6, spawn: 0, bossAt: 60, tags: new Map(), choices: [], stick: null, won: false, killer: "", newBest: false, last: 0 });
    SV.keys.clear(); SV.me = { x: 0, y: 0, hp: 100, maxHp: 100, speed: 150, rate: 0.42, dmg: 22, pierce: 0, reach: 340, cool: 0, hurt: 0 };
  }
  function svAdd(n, boss) {
    const kind = boss ? "boss" : VGRules.foeKind(n, SV.stats), K = VGRules.FOE_KINDS[kind], a = Math.random() * Math.PI * 2, dist = Math.hypot(W, H) / 2 + 40, grow = 1 + SV.t / 150;
    SV.foes.push({ n, kind, x: SV.me.x + Math.cos(a) * dist, y: SV.me.y + Math.sin(a) * dist, hp: K.hp * grow * (boss ? 0.8 : 0.55), max: K.hp * grow * (boss ? 0.8 : 0.55), speed: K.speed * SV_SCALE * (boss ? 1.05 : 0.8), r: Math.max(7, K.r * SV_SCALE), melee: K.melee * (boss ? 0.5 : 0.6), score: K.score, hit: 0 });
  }
  function svTagsOf(n) { return [].concat(n.tags || []).map(t => String(t).replace(/^#/, "")); }
  function svKill(f) {
    SV.kills++; SV.score += f.score;
    SV.gems.push({ x: f.x, y: f.y, value: f.kind === "boss" ? 12 : f.kind === "brute" ? 4 : 1, tags: svTagsOf(f.n) });
    SV.foes.splice(SV.foes.indexOf(f), 1);
  }
  // three upgrades, led by the tags you've collected most, named by the tag that earned them
  function svChoices() {
    const count = new Map(); SV.tags.forEach((k, tag) => { const ns = tag.split("/")[0]; if (SV_UPGRADES[ns] && ns !== "health") count.set(ns, Math.max(count.get(ns) || 0, k)); });
    const top = ns => { let best = null, most = 0; SV.tags.forEach((k, tag) => { if (tag.split("/")[0] === ns && k > most) { most = k; best = tag; } }); return best; };
    const order = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(x => x[0]);
    const pick = [...order, ...Object.keys(SV_UPGRADES).filter(k => !order.includes(k))];
    if (!pick.slice(0, 2).includes("health")) pick.splice(2, 0, "health");   // there's always a way to heal
    return [...new Set(pick)].slice(0, 3).map(ns => ({ ns, name: SV_UPGRADES[ns].name, from: top(ns) }));
  }
  function svChoose(i) {
    const c = SV.choices[i]; if (SV.state !== "choose" || !c) return;
    SV_UPGRADES[c.ns].apply(SV.me); SV.choices = []; SV.state = "play"; SV.last = 0;
  }
  function svEnd(won) {
    if (SV.state !== "play" && SV.state !== "choose") return;
    SV.won = !!won; SV.state = "over"; SV.keys.clear(); SV.stick = null;
    const was = cos.survivors || {}; SV.newBest = SV.score > (was.best || 0);
    cos.survivors = { best: Math.max(was.best || 0, SV.score), longest: Math.max(was.longest || 0, Math.floor(SV.t)), wins: (was.wins || 0) + (won ? 1 : 0), runs: (was.runs || 0) + 1 }; persistSoon();
  }
  // one step of the game; the clock stops while an upgrade is being chosen
  function svStep(dt) {
    if (SV.state !== "play") return;
    const me = SV.me; SV.t += dt;
    if (SV.t >= SV_SECONDS) { svEnd(true); return; }
    let ix = 0, iy = 0; const k = SV.keys;
    if (k.has("arrowleft") || k.has("a")) ix--; if (k.has("arrowright") || k.has("d")) ix++; if (k.has("arrowup") || k.has("w")) iy--; if (k.has("arrowdown") || k.has("s")) iy++;
    if (SV.stick) { const dx = SV.stick.x - SV.stick.x0, dy = SV.stick.y - SV.stick.y0, l = Math.hypot(dx, dy); if (l > 6) { ix = dx / Math.max(l, 40); iy = dy / Math.max(l, 40); } }
    const len = Math.hypot(ix, iy); if (len > 1) { ix /= len; iy /= len; }
    me.x += ix * me.speed * dt; me.y += iy * me.speed * dt; me.hurt = Math.max(0, me.hurt - dt);
    // the swarm grows; a boss every minute
    SV.spawn -= dt;
    if (SV.spawn <= 0 && SV.foes.length < SV_CAP) { const each = 1 + Math.floor(SV.t / 60); for (let i = 0; i < each && SV.foes.length < SV_CAP; i++) svAdd(SV.pool[Math.floor(Math.random() * SV.pool.length)]); SV.spawn = Math.max(0.35, 1.2 - SV.t / 240); }
    if (SV.t >= SV.bossAt) { const b = SV.bosses[Math.floor(SV.bossAt / 60 - 1) % Math.max(1, SV.bosses.length)]; if (b) svAdd(b, true); SV.bossAt += 60; }
    // the gun aims at whatever's closest
    me.cool -= dt;
    if (me.cool <= 0) { let near = null, d0 = me.reach; SV.foes.forEach(f => { const d = Math.hypot(f.x - me.x, f.y - me.y); if (d < d0) { d0 = d; near = f; } });
      if (near) { const a = Math.atan2(near.y - me.y, near.x - me.x); SV.shots.push({ x: me.x, y: me.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, life: me.reach / 520 + 0.1, pierce: me.pierce, hit: new Set() }); me.cool = me.rate; } }
    for (let i = SV.shots.length - 1; i >= 0; i--) { const s = SV.shots[i]; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; let gone = s.life <= 0;
      if (!gone) for (const f of SV.foes.slice()) { if (s.hit.has(f) || Math.hypot(f.x - s.x, f.y - s.y) > f.r + 4) continue; s.hit.add(f); f.hp -= me.dmg; f.hit = 0.08; if (f.hp <= 0) svKill(f); if (s.pierce-- <= 0) { gone = true; break; } }
      if (gone) SV.shots.splice(i, 1); }
    for (const f of SV.foes) { const dx = me.x - f.x, dy = me.y - f.y, d = Math.hypot(dx, dy) || 1; f.hit = Math.max(0, (f.hit || 0) - dt);
      if (d > f.r + SV_ME_R) { f.x += dx / d * f.speed * dt; f.y += dy / d * f.speed * dt; }
      else if (me.hurt <= 0) { me.hp -= f.melee; me.hurt = 0.55; SV.killer = f.n.name; if (me.hp <= 0) { me.hp = 0; svEnd(false); return; } } }
    // what falls comes to you when you're close; its tags count toward the upgrades
    for (let i = SV.gems.length - 1; i >= 0; i--) { const g = SV.gems[i], dx = me.x - g.x, dy = me.y - g.y, d = Math.hypot(dx, dy) || 1;
      if (d < 90) { g.x += dx / d * 300 * dt; g.y += dy / d * 300 * dt; }
      if (d < SV_ME_R + 6) { SV.xp += g.value; g.tags.forEach(t => SV.tags.set(t, (SV.tags.get(t) || 0) + 1)); SV.gems.splice(i, 1); } }
    if (SV.xp >= SV.need) { SV.xp -= SV.need; SV.level++; SV.need = Math.round(SV.need * 1.32) + 2; SV.choices = svChoices(); SV.state = "choose"; SV.keys.clear(); SV.stick = null; }
  }
  const svClock = s => `${Math.floor(s / 60)}:${VGShared.pad2(Math.floor(s % 60))}`;
  function svButton(x, y, w, h, label, run, font, primary, sub) {
    ctx.fillStyle = primary ? "#f1b88a" : "#2a2522"; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = primary ? "#2b1a0e" : "#f4efe9"; ctx.font = `600 14px ${font}`; ctx.fillText(label, x + w / 2, y + (sub ? h / 2 - 9 : h / 2 + 1));
    if (sub) { ctx.font = `12px ${font}`; ctx.fillStyle = "#a79f97"; ctx.fillText(sub, x + w / 2, y + h / 2 + 11); }
    ctx.textBaseline = "alphabetic"; SV.buttons.push([x, y, w, h, run]);
  }
  function svDraw(now) {
    const { font } = mapFrame(); SV.buttons = [];
    const dt = SV.last ? Math.min(0.05, (now - SV.last) / 1000) : 0; SV.last = now; svStep(dt);
    ctx.fillStyle = "#14110f"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, narrow = W < 520;
    if (SV.state === "title" || SV.state === "over") {
      const best = (cos.survivors || {}).best || 0, n = svNotes().length; ctx.textAlign = "center";
      ctx.fillStyle = "#f4efe9"; ctx.font = `700 ${narrow ? 30 : 40}px ${font}`; ctx.fillText(SV.state === "title" ? "Vault Survivors" : SV.won ? "You survived" : `${SV.score} points`, cx, H * 0.27);
      ctx.font = `15px ${font}`; ctx.fillStyle = "#c9c1b8"; let y = H * 0.27 + 36;
      const lines = SV.state === "over" ? [`${svClock(SV.t)} · ${SV.kills} notes · Level ${SV.level}`, ...(SV.won ? [`${SV.score} points`] : SV.killer ? [`Stopped by ${SV.killer}`] : []), SV.newBest ? "New best" : best ? `Best ${best}` : ""].filter(Boolean)
        : n ? ["Five minutes against your notes. Move, and the gun aims itself.", "Tags that fall choose your upgrades. The longest notes are bosses.", ...(best ? [`Best ${best}`] : [])] : ["No notes to fight yet."];
      lines.forEach(l => { ctx.fillText(l.length * 7.4 > W - 32 ? l.slice(0, Math.floor((W - 32) / 7.4) - 1) + "…" : l, cx, y); y += 22; });
      const bw = narrow ? Math.min(170, (W - 44) / 2) : 170; y += 12;
      if (n) svButton(SV.state === "over" ? cx - bw - 6 : cx - bw / 2, y, bw, 44, SV.state === "over" ? "Play again" : "Start", svStart, font, true);
      if (SV.state === "over" || !n) svButton(n ? cx + 6 : cx - bw / 2, y, bw, 44, "Back to the graph", () => setView("2d"), font, !n);
      return;
    }
    const me = SV.me, ox = cx - me.x, oy = H / 2 - me.y;
    // the floor moves under you, so you can tell you're moving
    ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = ((ox % 60) + 60) % 60; x < W; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = ((oy % 60) + 60) % 60; y < H; y += 60) { ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke();
    SV.gems.forEach(g => { ctx.fillStyle = "#f1b88a"; ctx.beginPath(); ctx.arc(g.x + ox, g.y + oy, g.value > 1 ? 5 : 3, 0, 7); ctx.fill(); });
    ctx.textAlign = "center";
    SV.foes.forEach(f => { const x = f.x + ox, y = f.y + oy; if (x < -40 || y < -40 || x > W + 40 || y > H + 40) return;
      ctx.fillStyle = f.hit > 0 ? "#fff" : SV_COLOUR[f.kind]; ctx.beginPath(); ctx.arc(x, y, f.r, 0, 7); ctx.fill();
      if (f.kind === "boss" || f.kind === "brute") { ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x - f.r, y - f.r - 8, f.r * 2, 3); ctx.fillStyle = "#e0796f"; ctx.fillRect(x - f.r, y - f.r - 8, f.r * 2 * Math.max(0, f.hp / f.max), 3); ctx.fillStyle = "#f4efe9"; ctx.font = `600 11px ${font}`; ctx.fillText(f.n.name.length > 28 ? f.n.name.slice(0, 27) + "…" : f.n.name, x, y - f.r - 12); } });
    ctx.fillStyle = "#f4efe9"; SV.shots.forEach(s => { ctx.beginPath(); ctx.arc(s.x + ox, s.y + oy, 2.5, 0, 7); ctx.fill(); });
    ctx.fillStyle = me.hurt > 0.4 ? "#e0796f" : "#f1b88a"; ctx.beginPath(); ctx.arc(cx, H / 2, SV_ME_R, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(241,184,138,.14)"; ctx.beginPath(); ctx.arc(cx, H / 2, me.reach, 0, 7); ctx.stroke();
    // health and level along the bottom, the clock and score under the toolbar
    const barW = Math.min(420, W - 32), bx = cx - barW / 2, by = H - 34;
    ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fillRect(bx, by, barW, 8); ctx.fillStyle = me.hp < me.maxHp * 0.3 ? "#e0796f" : "#79c7a0"; ctx.fillRect(bx, by, barW * me.hp / me.maxHp, 8);
    ctx.fillStyle = "rgba(255,255,255,.1)"; ctx.fillRect(bx, by + 12, barW, 4); ctx.fillStyle = "#f1b88a"; ctx.fillRect(bx, by + 12, barW * Math.min(1, SV.xp / SV.need), 4);
    ctx.font = `700 22px ${font}`; ctx.fillStyle = "#f4efe9"; ctx.textAlign = "center"; ctx.fillText(svClock(Math.max(0, SV_SECONDS - SV.t)), cx, 92);
    ctx.textAlign = "left"; ctx.font = `600 14px ${font}`; ctx.fillStyle = "#c9c1b8"; ctx.fillText(`${SV.score}`, 16, 90); ctx.textAlign = "right"; ctx.fillText(`Level ${SV.level}`, W - 16, 112);
    if (SV.state === "choose") {
      ctx.fillStyle = "rgba(10,8,7,.72)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#f4efe9"; ctx.textAlign = "center"; ctx.font = `700 22px ${font}`; ctx.fillText(`Level ${SV.level}: pick one`, cx, H * 0.28);
      const bw = Math.min(380, W - 40); SV.choices.forEach((c, i) => svButton(cx - bw / 2, H * 0.28 + 24 + i * 70, bw, 60, `${i + 1}. ${c.name}`, () => svChoose(i), font, false, c.from || ""));
    }
  }
  scene("survivors", {
    name: "Vault Survivors", icon: "survivors", fps: 60, game: true,
    menu: "play", hint: "Five minutes against a swarm of your notes: tags choose your upgrades, the longest notes are bosses",
    toast: "",
    layout() { const pos = new Map(), span = 800; nodes.forEach(n => { const [u, v] = scatter("sv:" + n.id); pos.set(n.id, [u * span, v * span]); }); if (SV.state !== "play" && SV.state !== "choose") SV.state = "title"; return { pos, bounds: [[0, 0], [span, 0], [span, span], [0, span]] }; },
    fit: n => !n.ghost,
    keys: { test: k => (SV.state === "play" ? /^(arrow(left|right|up|down)|[wasd])$/.test(k) : SV.state === "choose" ? /^[123]$/.test(k) : k === "enter" || k === " ") },
    key(k, down) {
      if (!down) { SV.keys.delete(k); return; }
      if (SV.state === "play") SV.keys.add(k);
      else if (SV.state === "choose" && /^[123]$/.test(k)) svChoose(+k - 1);
      else if ((k === "enter" || k === " ") && SV.state !== "choose") svStart();
    },
    pointer(phase, e, x, y) {
      if (phase === "down") { const b = SV.buttons.find(([bx, by, w, h]) => x >= bx && x <= bx + w && y >= by && y <= by + h); if (b) { b[4](); return true; }
        if (SV.state === "play") { SV.stick = { x0: x, y0: y, x, y }; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* it still works inside the canvas */ } } return true; }
      if (phase === "move") { if (SV.stick) { SV.stick.x = x; SV.stick.y = y; } return SV.state === "play"; }
      if (phase === "up" || phase === "cancel") { SV.stick = null; return true; }
      return false;
    },
    escape() { if (SV.state === "play" || SV.state === "choose") { svEnd(false); return true; } return false; },
    release() { SV.keys.clear(); SV.stick = null; },
    state: SV,   // for tests/test_play.js
    api: { start: svStart, step: svStep, choose: svChoose, end: svEnd, choices: svChoices, kill: svKill, add: svAdd },
    draw: svDraw,
  });
