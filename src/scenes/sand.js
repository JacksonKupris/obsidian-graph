  // Falling sand, the toy (after the 2005 Falling Sand Game and The Powder Toy): paint elements with the brush and
  // watch them react. Your vault keeps the wells topped up: each topic pours its notes in as elements (active notes
  // are water, current ones sand, stale ones ash, open tasks oil waiting for a spark, notes from the last two weeks
  // seeds). Stone walls part the wells, as high as the topic's map coverage; topics that link share a pipe through
  // their wall, so what they pour mixes; topics talked about together but never linked throw sparks at their wall.
  ICON.sand = '<path d="M6 3h12l-4 7v4l4 7H6l4-7v-4Z"/><path d="M9 18h6"/>';
  const E = { EMPTY: 0, SAND: 1, WATER: 2, WALL: 3, FIRE: 4, PLANT: 5, OIL: 6, LAVA: 7, SALT: 8, ACID: 9, POWDER: 10, STEAM: 11, SMOKE: 12, ASH: 13, SEED: 14, STONE: 15,
    ICE: 16, WOOD: 17, CLONE: 18, GLASS: 19 };
  // kind: how it moves; dens: what it sinks through (only fluids lighter than it); col: its colour
  const EP = [
    null,
    { name: "Sand", kind: "powder", dens: 6, col: [226, 194, 122] },
    { name: "Water", kind: "liquid", dens: 3, col: [59, 130, 246] },
    { name: "Wall", kind: "static", dens: 99, col: [120, 113, 108] },
    { name: "Fire", kind: "gas", dens: 0, col: [249, 115, 22], life: 30 },
    { name: "Plant", kind: "static", dens: 99, col: [22, 163, 74] },
    { name: "Oil", kind: "liquid", dens: 2, col: [120, 72, 30] },
    { name: "Lava", kind: "liquid", dens: 5, col: [239, 68, 68] },
    { name: "Salt", kind: "powder", dens: 6, col: [241, 245, 249] },
    { name: "Acid", kind: "liquid", dens: 3, col: [190, 242, 100] },
    { name: "Gunpowder", kind: "powder", dens: 6, col: [68, 64, 60] },
    { name: "Steam", kind: "gas", dens: 0, col: [203, 213, 225], life: 90 },
    { name: "Smoke", kind: "gas", dens: 0, col: [87, 83, 78], life: 50 },
    { name: "Ash", kind: "powder", dens: 4, col: [120, 120, 130] },
    { name: "Seed", kind: "powder", dens: 5, col: [163, 230, 53] },
    { name: "Stone", kind: "static", dens: 99, col: [87, 83, 78] },
    { name: "Ice", kind: "static", dens: 99, col: [186, 230, 253] },
    { name: "Wood", kind: "static", dens: 99, col: [133, 77, 14] },
    { name: "Clone", kind: "static", dens: 99, col: [217, 70, 239] },
    { name: "Glass", kind: "static", dens: 99, col: [165, 243, 252] },
  ];
  const FLAMMABLE = { [E.OIL]: 0.25, [E.PLANT]: 0.12, [E.SEED]: 0.2, [E.POWDER]: 1, [E.WOOD]: 0.03 };
  const PALETTE = [E.SAND, E.WATER, E.WALL, E.FIRE, E.PLANT, E.OIL, E.LAVA, E.SALT, E.ACID, E.POWDER, E.SEED, E.ICE, E.WOOD, E.CLONE, E.EMPTY];
  const SD = { W: 300, H: 180, X0: -900, Y0: -540, CELL: 6, grid: null, life: null, moved: null, tick: 0, brush: E.SAND, size: 4, img: null, cv: null, wells: null, rect: null, last: null, paused: false };
  const sIdx = (x, y) => y * SD.W + x;
  function sandReset(M) {
    const N = SD.W * SD.H; SD.grid = new Uint8Array(N); SD.life = new Uint8Array(N); SD.moved = new Uint8Array(N); SD.wells = M.wells;
    M.wells.forEach((w, i) => { if (i === 0) return; const x = w.c0 - 1;
      for (let y = SD.H - 1; y >= SD.H - w.wallH; y--) SD.grid[sIdx(x, y)] = E.STONE;
      if (w.pipe) for (let y = SD.H - 8; y >= SD.H - 14; y--) SD.grid[sIdx(x, y)] = E.EMPTY; });   // linked: a pipe through the wall
  }
  function sandSet(x, y, e) { if (x < 0 || y < 0 || x >= SD.W || y >= SD.H) return; const i = sIdx(x, y); SD.grid[i] = e; SD.life[i] = 0; }
  function sandPaint(gx, gy) { const r = SD.size;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const x = gx + dx, y = gy + dy;
      if (x < 0 || y < 0 || x >= SD.W || y >= SD.H) continue;
      const cur = SD.grid[sIdx(x, y)]; if (SD.brush !== E.EMPTY && SD.brush !== E.WALL && cur && cur !== SD.brush) continue;   // pour around what's there; walls and the eraser overwrite
      if (EP[SD.brush] && EP[SD.brush].kind !== "static" && SD.brush !== E.FIRE && Math.random() < 0.45) continue;   // loose grains, not a solid block
      sandSet(x, y, SD.brush); } }
  function explode(x0, y0, r) { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r) continue; const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= SD.W || y >= SD.H) continue; const c = SD.grid[sIdx(x, y)]; if (c === E.WALL || c === E.STONE) continue; sandSet(x, y, Math.random() < 0.7 ? E.FIRE : E.SMOKE); } }
  function sandStep() {
    const G = SD.grid, L = SD.life, Mv = SD.moved, Wd = SD.W, Hd = SD.H;
    const at = (x, y) => (x < 0 || x >= Wd || y < 0 || y >= Hd ? E.WALL : G[y * Wd + x]);
    const move = (i, j) => { const t = G[i]; G[i] = G[j]; G[j] = t; const l = L[i]; L[i] = L[j]; L[j] = l; Mv[j] = 1; };
    const canEnter = (e, v) => v === E.EMPTY || (EP[v] && EP[v].kind !== "static" && EP[v].kind !== "powder" && EP[v].dens < EP[e].dens);
    Mv.fill(0); SD.tick++;
    const flip = SD.tick & 1;
    for (let y = Hd - 1; y >= 0; y--) for (let xi = 0; xi < Wd; xi++) {
      const x = flip ? xi : Wd - 1 - xi, i = y * Wd + x, e = G[i];
      if (!e || Mv[i]) continue;
      const P0 = EP[e], r = Math.random() < 0.5 ? -1 : 1;
      // reactions with a random neighbour
      const nx = x + (Math.random() < 0.5 ? r : 0), ny = y + (nx === x ? r : 0), j = nx >= 0 && nx < Wd && ny >= 0 && ny < Hd ? ny * Wd + nx : -1, nbv = j >= 0 ? G[j] : E.WALL;
      if (e === E.FIRE || e === E.LAVA) {
        if (j >= 0 && FLAMMABLE[nbv] && Math.random() < FLAMMABLE[nbv]) { if (nbv === E.POWDER) explode(nx, ny, 5); else { G[j] = E.FIRE; L[j] = 0; } }
        if (nbv === E.WATER) { if (e === E.LAVA) { G[i] = E.STONE; G[j] = E.STEAM; L[j] = 0; continue; } G[i] = E.STEAM; L[i] = 0; G[j] = Math.random() < 0.5 ? E.STEAM : E.WATER; continue; }
        if (e === E.LAVA && Math.random() < 0.004 && at(x, y - 1) === E.EMPTY) { G[i - Wd] = E.FIRE; L[i - Wd] = 0; }
      }
      if (e === E.ACID && j >= 0 && nbv && nbv !== E.ACID && nbv !== E.WALL && nbv !== E.STONE && EP[nbv].kind !== "gas" && Math.random() < 0.15) { G[j] = E.EMPTY; if (Math.random() < 0.3) { G[i] = E.SMOKE; L[i] = 0; continue; } }
      if (e === E.WATER && nbv === E.SALT && Math.random() < 0.05) G[j] = E.EMPTY;   // salt dissolves
      if (e === E.SEED && nbv === E.WATER) { G[i] = E.PLANT; continue; }
      if (e === E.PLANT) { if (nbv === E.WATER && Math.random() < 0.06) G[j] = E.PLANT; continue; }   // plants drink and spread
      if (e === E.ICE) {   // freezes the water it touches; melts by fire and lava
        if (nbv === E.WATER && Math.random() < 0.01) G[j] = E.ICE;
        if ((nbv === E.FIRE || nbv === E.LAVA) && Math.random() < 0.2) G[i] = E.WATER;
        continue; }
      if (e === E.CLONE) {   // copies whatever touches it into the empty cells around it (the classic spout)
        if (j >= 0 && nbv && nbv !== E.CLONE && nbv !== E.WALL && nbv !== E.STONE && nbv !== E.GLASS) {
          for (const k of [i - Wd, i + Wd, i - 1, i + 1]) if (k >= 0 && k < G.length && G[k] === E.EMPTY && Math.random() < 0.3) { G[k] = nbv; L[k] = 0; } }
        continue; }
      if (e === E.SAND && nbv === E.LAVA && Math.random() < 0.02) { G[i] = E.GLASS; continue; }   // lava fuses sand into glass
      if (e === E.WOOD && nbv === E.FIRE && Math.random() < 0.01) { G[i] = E.FIRE; L[i] = 0; continue; }
      if (P0.kind === "static") continue;
      if (P0.life) { L[i]++; if (L[i] > P0.life + (i % 23)) { G[i] = e === E.FIRE ? (Math.random() < 0.4 ? E.SMOKE : E.EMPTY) : e === E.STEAM && Math.random() < 0.35 ? E.WATER : E.EMPTY; L[i] = 0; continue; } }
      if (P0.kind === "gas") {   // rises, drifts
        const tries = [[x, y - 1], [x + r, y - 1], [x - r, y - 1], [x + r, y]];
        for (const [a, b] of tries) { const v = at(a, b); if (v === E.EMPTY || (EP[v] && EP[v].kind === "gas" && v !== e && Math.random() < 0.3)) { move(i, b * Wd + a); break; } }
        continue;
      }
      // powders and liquids fall, sinking through lighter fluids; liquids also spread sideways
      if (canEnter(e, at(x, y + 1))) { move(i, i + Wd); continue; }
      if (canEnter(e, at(x + r, y + 1))) { move(i, i + Wd + r); continue; }
      if (canEnter(e, at(x - r, y + 1))) { move(i, i + Wd - r); continue; }
      if (P0.kind === "liquid") { const spread = e === E.LAVA ? 1 : 3; for (let s = 1; s <= spread; s++) { if (at(x + r * s, y) !== E.EMPTY) break; if (s === spread || at(x + r * s, y + 1) === E.EMPTY) { move(i, i + r * s); break; } } }
    }
    // the floor drains a little, so the wells keep flowing
    for (let x = 0; x < Wd; x++) { const i = (Hd - 1) * Wd + x; if (G[i] && G[i] !== E.STONE && G[i] !== E.WALL && Math.random() < 0.01) G[i] = E.EMPTY; }
    // the vault pours: each well, as often as its topic is busy, one of its notes' elements
    SD.wells.forEach(w => { for (let n = 0; n < 3; n++) { if (Math.random() > w.rate) continue;
      const el = w.mix[Math.floor(Math.random() * w.mix.length)], x = w.c0 + 2 + Math.floor(Math.random() * Math.max(1, w.c1 - w.c0 - 4));
      if (at(x, 0) === E.EMPTY) sandSet(x, 0, el); }
      if (w.gap && Math.random() < 0.02) { const y = SD.H - w.wallH - 1; if (at(w.c0 - 1, y) === E.EMPTY) sandSet(w.c0 - 1, y, E.FIRE); } });   // sparks at the wall
  }
  function sandBar() {
    let bar = root.querySelector(".vg-sandbar"); if (bar) return bar;
    bar = document.createElement("div"); bar.className = "vg-sandbar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Falling sand elements"); wrap.appendChild(bar);
    const render = () => {
      bar.innerHTML = PALETTE.map(e => { const c = EP[e] ? EP[e].col : [30, 30, 30]; return `<button class="vg-sandel" data-el="${e}" aria-pressed="${SD.brush === e}"><i style="background:rgb(${c.join(",")})"></i>${e ? EP[e].name : "Erase"}</button>`; }).join("") +
        `<label class="vg-sandsize" title="Brush size"><span>Brush</span><input type="range" min="1" max="12" value="${SD.size}"></label>` +
        `<button class="vg-sandel" data-act="pause" aria-pressed="${SD.paused}">${SD.paused ? "Play" : "Pause"}</button><button class="vg-sandel" data-act="clear">Clear</button>`;
      bar.querySelectorAll("[data-el]").forEach(b => b.onclick = () => { SD.brush = +b.dataset.el; render(); });
      bar.querySelector("input").oninput = e => { SD.size = +e.target.value; };
      bar.querySelector('[data-act="pause"]').onclick = () => { SD.paused = !SD.paused; render(); };
      bar.querySelector('[data-act="clear"]').onclick = () => { if (mapCache.sand) sandReset(mapCache.sand); };
    };
    render(); return bar;
  }
  scene("sand", {
    name: "Falling sand", icon: "sand", fps: 60,
    blurb: "The falling sand toy: paint elements and watch them react; your topics keep their wells topped up",
    toast: "Falling sand — paint with the brush below. Topics pour their notes in: water = active, sand = current, ash = stale, oil = open tasks, seeds = new. Linked topics share pipes; sparks fly where topics should link",
    layout(geo) {
      const pos = new Map(geo), cs = topicsWithNotes(true);
      const wt = c => Math.sqrt(topicNotes(c.id).length) + 2, total = cs.reduce((s, c) => s + wt(c), 0);
      let x = 0; const wells = cs.map((c, i) => {
        const ms = topicNotes(c.id, true), m = mocOf[c.id];
        const c0 = Math.round(x), c1 = Math.round(x += SD.W * wt(c) / total), prev = cs[i - 1];
        const mix = ms.map(n => n.tasks > 0 ? E.OIL : n.age <= 14 ? E.SEED : activity(n) > 0.3 ? E.WATER : staleFor(n, Q.stale_days) ? E.ASH : E.SAND);
        const listed = m ? ms.filter(n => VGRules.onMap(m, n.id)).length : 0;
        ms.sort(byImportance).forEach((n, j) => {   // the notes themselves: gems along the floor of their well
          const per = Math.max(1, Math.floor((c1 - c0 - 2) / 2)), col = j % per, row = Math.floor(j / per);
          pos.set(n.id, [SD.X0 + (c0 + 1.5 + col * 2) * SD.CELL, SD.Y0 + (SD.H + 3 + row * 2.4) * SD.CELL]); });
        if (m && byId[m.id]) pos.set(m.id, [SD.X0 + (c0 + (c1 - c0) / 2) * SD.CELL, SD.Y0 - 5 * SD.CELL]);
        return { c: c.id, c0, c1, mix: mix.length ? mix : [E.SAND], rate: Math.min(0.6, 0.05 + topicBusy(c.id) / 10),
          wallH: Math.round(20 + 100 * (ms.length ? listed / ms.length : 0)), pipe: !!(prev && topicPair(prev.id, c.id).links),
          gap: !!(prev && topicPair(prev.id, c.id).gap), prev: prev && prev.id };
      });
      const M = { pos, wells, bounds: [[SD.X0 - 20, SD.Y0 - 60], [SD.X0 + SD.W * SD.CELL + 20, SD.Y0 + (SD.H + 34) * SD.CELL]] };
      sandReset(M);
      return M;
    },
    fit: n => !special(n) && !n.ghost && !n.isolated,
    press(phase, x, y) {
      const r = SD.rect; if (!r) return false;
      const gx = Math.floor((x - r.x) / r.cw), gy = Math.floor((y - r.y) / r.cw);
      if (phase === "down") { if (gx < 0 || gy < 0 || gx >= SD.W || gy >= SD.H) return false; SD.last = [gx, gy]; sandPaint(gx, gy); return true; }
      if (phase === "move" && SD.last) { const [x0, y0] = SD.last, n = Math.max(1, Math.ceil(Math.hypot(gx - x0, gy - y0) / Math.max(1, SD.size / 2)));   // a stroke, not dots
        for (let s = 1; s <= n; s++) sandPaint(Math.round(x0 + (gx - x0) * s / n), Math.round(y0 + (gy - y0) * s / n)); SD.last = [gx, gy]; }
      if (phase === "up") SD.last = null;
      return true;
    },
    draw(now) {
      const { R, litSet, font, k } = mapFrame(), M = mapCache.sand;
      ctx.fillStyle = "#0f0d0a"; ctx.fillRect(0, 0, W, H);
      sandBar();
      if (!M) return;
      if (SD.wells !== M.wells) sandReset(M);
      if (SD.last) sandPaint(SD.last[0], SD.last[1]);   // holding still keeps pouring, like the game
      if (!SD.paused && !reducedMotion()) { const dt = Math.min(100, now - (SD.at || now)); SD.at = now; SD.carry = (SD.carry || 0) + dt / 16; let n = 0; while (SD.carry >= 1 && n < 4) { sandStep(); SD.carry--; n++; } }   // 60 steps a second whatever the frame rate
      if (!SD.cv) { SD.cv = document.createElement("canvas"); SD.cv.width = SD.W; SD.cv.height = SD.H; SD.img = SD.cv.getContext("2d").createImageData(SD.W, SD.H); }
      const d = SD.img.data;
      for (let i = 0; i < SD.grid.length; i++) { const e = SD.grid[i], o = i * 4; if (!e) { d[o + 3] = 0; continue; }
        const c = EP[e].col, j = ((i * 2654435761) >>> 28) - 8, fl = e === E.FIRE || e === E.LAVA ? Math.random() * 40 - 20 : 0;
        d[o] = Math.min(255, Math.max(0, c[0] + j + fl)); d[o + 1] = Math.min(255, Math.max(0, c[1] + j + fl * 0.6)); d[o + 2] = Math.min(255, Math.max(0, c[2] + j));
        d[o + 3] = EP[e].kind === "gas" ? 150 : 255; }
      SD.cv.getContext("2d").putImageData(SD.img, 0, 0);
      const tl = scr(SD.X0, SD.Y0, R), br = scr(SD.X0 + SD.W * SD.CELL, SD.Y0 + SD.H * SD.CELL, R), cw = (br.x - tl.x) / SD.W;
      SD.rect = { x: tl.x, y: tl.y, cw };
      ctx.fillStyle = "#1c1915"; ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.imageSmoothingEnabled = false; ctx.drawImage(SD.cv, tl.x, tl.y, br.x - tl.x, br.y - tl.y); ctx.imageSmoothingEnabled = true;
      ctx.strokeStyle = "#57534e"; ctx.lineWidth = 2; ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      // well names above; the notes as gems below the floor (click one for the inspector)
      M.wells.forEach(w => topicLabel(w.c, clip(shortName(w.c), 24), tl.x + (w.c0 + w.c1) / 2 * cw, tl.y - 12, (w.c1 - w.c0) * cw - 4, colorOf(w.c), "#0f0d0a"));
      dots(n => !special(n) && !n.ghost && !n.isolated, n => staleFor(n, Q.stale_days) ? "#78716c" : colorOf(n.cluster), n => Math.max(1.6, (1.4 + 2.5 * importance(n)) * Math.sqrt(k)), R);
      selRing(R);
      if (SD.tick % 30 === 0) { const cnt = e => { let n = 0; for (let i = 0; i < SD.grid.length; i++) if (SD.grid[i] === e) n++; return n; };
        setSceneStat(`🌱 ${cnt(E.PLANT)} · 💧 ${cnt(E.WATER)} · 🔥 ${cnt(E.FIRE)} · brush: ${SD.brush ? EP[SD.brush].name : "Erase"}`); }
    },
    legend: item => item("<b style='color:#3b82f6'>■</b>", "water = active") + item("<b style='color:#e2c27a'>■</b>", "sand = current") + item("<b style='color:#787882'>■</b>", "ash = stale")
      + item("<b style='color:#78481e'>■</b>", "oil = open tasks") + item("<b style='color:#a3e635'>■</b>", "seed = new") + item("▮", "wall height = map coverage") + item("<b style='color:#f97316'>✦</b>", "sparks = should link"),
    today() {
      const M = mapCache.sand, w = M && M.wells.find(x => x.gap); if (!w) return null;
      return { text: `Sparks at the wall: ${clusterName(w.prev)} ↔ ${clusterName(w.c)} · talked about together, no pipe between them`, label: "Show both", run: () => focusClusters([w.prev, w.c]) };
    },
  });
