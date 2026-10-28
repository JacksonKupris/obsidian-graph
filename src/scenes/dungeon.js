  // Dungeon: a first-person crawl through the vault. Each topic is a room walled in its colour, doors join neighbouring
  // rooms, and the room's stale notes are the monsters in it. W A S D or the arrows walk (a drag on the floor on a
  // phone); Space, a tap or a click attacks the monster in the crosshair, which selects its note: the inspector's
  // Reviewed or Archive clears it, and it's gone on the next redraw. Walls are a grid raycast, monsters billboards.
  ICON.dungeon = '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6a3 3 0 0 1 6 0v6"/>';
  const DG = { x: 1.5, y: 1.5, a: 0, keys: new Set(), last: 0, flash: 0, drag: null, aim: null, gw: 0 };
  const RS = 7, CELL = 40, REACH = 6;   // room size in cells; a cell in graph units; how far an attack reaches (cells)
  const monster = n => !special(n) && !n.ghost && staleFor(n, Q.stale_days);
  const shades = new Map();   // wall colour by topic and distance band: the raycast asks for one per column
  const wallCol = (v, band) => { const key = v * 32 + band; let c = shades.get(key);
    if (!c) { c = hexMix(v > 0 ? colorOf(v - 1) : "#57534e", "#000000", 1 - band / 31); shades.set(key, c); } return c; };
  function attack() {
    const t = performance.now(); if (t - DG.flash < 200) return;
    DG.flash = t; if (DG.aim && byId[DG.aim]) select(DG.aim); dirty = true; kick();
  }
  function roomCentre(D, r) { return [r.x0 + (RS >> 1) + 0.5, r.y0 + (RS >> 1) + 0.5]; }
  scene("dungeon", {
    name: "Dungeon", icon: "dungeon", fps: 30,
    blurb: "Walk the vault first-person; topics are rooms, stale notes are the monsters",
    toast: "Dungeon — W A S D or arrows walk (drag on a phone), Space or a click attacks: the note opens in the inspector",
    layout(geo) {
      const pos = new Map(geo), cs = topicsWithNotes(true), { cols, rows } = gridDims(Math.max(1, cs.length));
      const S = RS + 1, gw = cols * S + 1, gh = rows * S + 1, G = new Int16Array(gw * gh).fill(-1), mid = RS >> 1;   // -1 rock, 0 floor, c + 1 a wall of topic c
      const rooms = cs.map((c, i) => ({ c: c.id, x0: (i % cols) * S + 1, y0: Math.floor(i / cols) * S + 1 }));
      rooms.forEach(r => { for (let y = r.y0 - 1; y <= r.y0 + RS; y++) for (let x = r.x0 - 1; x <= r.x0 + RS; x++)
        G[y * gw + x] = y < r.y0 || y >= r.y0 + RS || x < r.x0 || x >= r.x0 + RS ? r.c + 1 : 0; });
      rooms.forEach((r, i) => {   // doors to the room on the right and the one below
        if (i % cols < cols - 1 && rooms[i + 1]) for (let d = -1; d <= 1; d++) G[(r.y0 + mid + d) * gw + r.x0 + RS] = 0;
        if (rooms[i + cols]) for (let d = -1; d <= 1; d++) G[(r.y0 + RS) * gw + r.x0 + mid + d] = 0;
      });
      const mobs = new Map();
      rooms.forEach(r => topicNotes(r.c, true).filter(monster).sort(byImportance).slice(0, 16).forEach(n => {
        const [u, v] = scatter("dg:" + n.id), x = r.x0 + 0.5 + u * (RS - 1), y = r.y0 + 0.5 + v * (RS - 1);
        mobs.set(n.id, [x, y]); pos.set(n.id, [x * CELL, y * CELL]); }));
      const D = { pos, G, gw, gh, cols, rooms, mobs, bounds: [[0, 0], [gw * CELL, 0], [gw * CELL, gh * CELL], [0, gh * CELL]] };
      if (DG.gw !== gw || G[(DG.y | 0) * gw + (DG.x | 0)] !== 0) { [DG.x, DG.y] = rooms[0] ? roomCentre(D, rooms[0]) : [1.5, 1.5]; DG.a = 0; }
      DG.gw = gw;
      return D;
    },
    fit: n => !!mapCache.dungeon && mapCache.dungeon.mobs.has(n.id),
    keys: /^(w|a|s|d|arrowup|arrowdown|arrowleft|arrowright| )$/,
    key(k, down) { if (k === " ") { if (down) attack(); return; } down ? DG.keys.add(k) : DG.keys.delete(k); },
    press(kind, x, y) {   // drag on the floor: sideways turns, up and down walks; a tap attacks
      if (kind === "down") { DG.drag = { x0: x, y0: y, turn: 0, go: 0, moved: false }; return true; }
      const d = DG.drag; if (!d) return false;
      if (kind === "move") { d.turn = Math.max(-1.5, Math.min(1.5, (x - d.x0) / 80)); d.go = Math.max(-1.5, Math.min(1.5, (d.y0 - y) / 80)); d.moved = d.moved || Math.hypot(x - d.x0, y - d.y0) > 8; }
      if (kind === "up") { DG.drag = null; if (!d.moved) attack(); }
      return true;
    },
    draw(now) {
      const { litSet, font } = mapFrame(), D = mapCache.dungeon; if (!D) return;
      const { G, gw, gh } = D, dt = Math.min(100, now - (DG.last || now)) / 1000; DG.last = now;
      // walk: keys and the drag; slide along walls by moving each axis on its own
      const has = (...ks) => ks.some(x => DG.keys.has(x)), dr = DG.drag || { turn: 0, go: 0 };
      DG.a += ((has("d", "arrowright") ? 1 : 0) - (has("a", "arrowleft") ? 1 : 0) + dr.turn) * 2.4 * dt;
      const step = ((has("w", "arrowup") ? 1 : 0) - (has("s", "arrowdown") ? 1 : 0) + dr.go) * 3.2 * dt;
      const open = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && G[(y | 0) * gw + (x | 0)] === 0;
      if (step) { const nx = DG.x + Math.cos(DG.a) * step, ny = DG.y + Math.sin(DG.a) * step;
        if (open(nx + Math.sign(nx - DG.x) * 0.25, DG.y)) DG.x = nx; if (open(DG.x, ny + Math.sign(ny - DG.y) * 0.25)) DG.y = ny; }
      if (DG.keys.size || DG.drag) kick();
      backdrop([0, "#0c0a09"], [0.5, "#1c1917"], [0.5, "#24201c"], [1, "#4a4038"]);
      // walls: one ray per column strip (DDA through the grid), the distance kept for hiding monsters behind them
      const dirX = Math.cos(DG.a), dirY = Math.sin(DG.a), plX = -dirY * 0.66, plY = dirX * 0.66;
      const colW = Math.max(2, Math.ceil(W / 360)), Z = new Float32Array(Math.ceil(W / colW));
      for (let i = 0; i < Z.length; i++) {
        const c = 2 * i * colW / W - 1, rx = dirX + plX * c, ry = dirY + plY * c, ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
        let mx = DG.x | 0, my = DG.y | 0, tx = (rx < 0 ? DG.x - mx : mx + 1 - DG.x) * ddx, ty = (ry < 0 ? DG.y - my : my + 1 - DG.y) * ddy, side = 0, v = -1;
        for (let s = 0; s < 96; s++) { if (tx < ty) { tx += ddx; mx += sx; side = 0; } else { ty += ddy; my += sy; side = 1; }
          if (mx < 0 || my < 0 || mx >= gw || my >= gh) break; v = G[my * gw + mx]; if (v !== 0) break; }
        const d = Z[i] = Math.max(0.05, side ? ty - ddy : tx - ddx), h = H / d;
        ctx.fillStyle = wallCol(v, Math.round(31 * Math.max(0.15, 1 - d / 14) * (side ? 0.75 : 1)));
        ctx.fillRect(i * colW, (H - h) / 2, colW + 1, h);
      }
      // monsters, far to near; the nearest one in the crosshair is the one an attack hits
      const inv = 1 / (plX * dirY - dirX * plY), sprites = [];
      for (const [id, [x, y]] of D.mobs) { const n = byId[id]; if (!n || !monster(n) || !mapShown(n)) continue;
        const dx = x - DG.x, dy = y - DG.y, tX = inv * (dirY * dx - dirX * dy), tY = inv * (-plY * dx + plX * dy);
        if (tY > 0.25) sprites.push([n, tY, W / 2 * (1 + tX / tY)]); }
      sprites.sort((a, b) => b[1] - a[1]);
      DG.aim = null;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      for (const [n, d, cx] of sprites) {
        const col = Math.floor(cx / colW); if (col >= 0 && col < Z.length && Z[col] < d) continue;   // behind a wall
        const s = H / d * (0.3 + 0.25 * importance(n)), bob = reducedMotion() ? 0 : Math.sin(now / 260 + hash(n.id)) * s * 0.04, cy = H / 2 + H / d / 2 - s * 0.5 + bob;
        ctx.globalAlpha = (!litSet || litSet.has(n.id) ? 1 : 0.35) * Math.max(0.3, 1 - d / 16);
        ctx.fillStyle = hexMix(colorOf(n.cluster), "#3f6212", 0.6);
        ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.36, s * 0.45, 0, 0, 2 * Math.PI); ctx.fill();
        ctx.beginPath(); [-1, 1].forEach(k => { ctx.moveTo(cx + k * s * 0.3, cy - s * 0.28); ctx.lineTo(cx + k * s * 0.22, cy - s * 0.62); ctx.lineTo(cx + k * s * 0.1, cy - s * 0.38); }); ctx.fill();
        ctx.fillStyle = "#fca5a5"; [-1, 1].forEach(k => { ctx.beginPath(); ctx.arc(cx + k * s * 0.13, cy - s * 0.12, s * 0.055, 0, 2 * Math.PI); ctx.fill(); });
        ctx.fillStyle = "#1c1917"; ctx.fillRect(cx - s * 0.15, cy + s * 0.1, s * 0.3, s * 0.05);
        if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, cy, s * 0.5, s * 0.58, 0, 0, 2 * Math.PI); ctx.stroke(); }
        if (d < 5) { ctx.font = `600 ${Math.round(Math.max(10, Math.min(14, s * 0.12)))}px ${font}`; ctx.fillStyle = "#fde68a"; ctx.fillText(`${clip(n.name, 32)} · ${n.age || 0}d`, cx, cy - s * 0.66); }
        P.set(n.id, { x: cx, y: cy, r: s * 0.45, s: 1, depth: -d, a: 1 });
        if (d < REACH && Math.abs(cx - W / 2) < s * 0.4) DG.aim = n.id;
      }
      ctx.globalAlpha = 1;
      // crosshair and the muzzle flash
      const f = Math.max(0, 1 - (now - DG.flash) / 160);
      ctx.strokeStyle = DG.aim ? "#f87171" : "rgba(245,245,244,.7)"; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(W / 2 - 10, H / 2); ctx.lineTo(W / 2 - 4, H / 2); ctx.moveTo(W / 2 + 4, H / 2); ctx.lineTo(W / 2 + 10, H / 2);
      ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2, H / 2 - 4); ctx.moveTo(W / 2, H / 2 + 4); ctx.lineTo(W / 2, H / 2 + 10); ctx.stroke();
      if (f) { ctx.fillStyle = `rgba(253,224,71,${0.5 * f})`; ctx.beginPath(); ctx.arc(W / 2, H - 40, 60 * f + 20, 0, 2 * Math.PI); ctx.fill(); }
      ctx.fillStyle = "#44403c"; ctx.fillRect(W / 2 - 9, H - 70 + f * 8, 18, 70); ctx.fillStyle = "#a8a29e"; ctx.fillRect(W / 2 - 5, H - 80 + f * 8, 10, 14);
      // minimap: rooms in their colour, monsters red, you white
      const mm = Math.max(1, Math.min(4, 130 / Math.max(gw, gh))), ox = 12, oy = 64;
      if (!D.mini) { D.mini = document.createElement("canvas"); D.mini.width = gw; D.mini.height = gh; const m = D.mini.getContext("2d");
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const v = G[y * gw + x]; if (v > 0) { m.fillStyle = colorOf(v - 1); m.fillRect(x, y, 1, 1); } } }
      ctx.globalAlpha = 0.85; ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(ox - 4, oy - 4, gw * mm + 8, gh * mm + 8);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(D.mini, ox, oy, gw * mm, gh * mm); ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = "#ef4444"; for (const [id, [x, y]] of D.mobs) if (byId[id] && monster(byId[id])) ctx.fillRect(ox + x * mm - 1, oy + y * mm - 1, 2, 2);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ox + DG.x * mm, oy + DG.y * mm, 2.5, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(ox + DG.x * mm, oy + DG.y * mm); ctx.lineTo(ox + (DG.x + dirX * 2) * mm, oy + (DG.y + dirY * 2) * mm); ctx.stroke(); ctx.globalAlpha = 1;
      const r = D.rooms[Math.floor((DG.y - 1) / (RS + 1)) * D.cols + Math.floor((DG.x - 1) / (RS + 1))];
      const here = r ? [...D.mobs].filter(([id]) => byId[id] && monster(byId[id]) && byId[id].cluster === r.c).length : 0;
      const all = [...D.mobs.keys()].filter(id => byId[id] && monster(byId[id])).length;
      setSceneStat(`${r ? clusterName(r.c) + " · " + plural(here, "monster") + " here · " : ""}${all} in the dungeon`);
    },
    legend: item => item("<b style='color:#65a30d'>☗</b>", "monster = stale note") + item("▮", "wall colour = topic") + item("✛", "Space or click: attack, opens the note"),
    today() {
      const D = mapCache.dungeon; if (!D) return null;
      const count = r => [...D.mobs].filter(([id]) => byId[id] && monster(byId[id]) && byId[id].cluster === r.c).length;
      const worst = D.rooms.slice().sort((a, b) => count(b) - count(a))[0]; if (!worst || !count(worst)) return null;
      return { text: `Most monsters: ${clusterName(worst.c)} · ${plural(count(worst), "stale note")}`, label: "Go there",
        run: () => { [DG.x, DG.y] = roomCentre(D, worst); dirty = true; kick(); } };
    },
  });
