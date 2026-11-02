  // Cyberpunk: the vault as a rain-soaked neon city, seen from the street. Each topic is a district on a skyline; rows of
  // districts stack into the haze behind each other. A note is a tower: height is how much the vault relies on it, width
  // how long it is, lit windows how recently it was active. A stale tower is dark and its sign flickers; open tasks blink
  // a pink beacon on the roof; a topic's map is the spire over its district; notes with no topic are stalls down on the street.
  // Traffic in a district's air lane is its activity. Selecting a tower draws its links as neon arcs.
  ICON.cyberpunk = '<path d="M3 21V10l4-2v13M7 21V4l6 3v14M13 21v-9l4-2 4 2v9"/><path d="M2 21h20"/>';
  const CP = { DW: 860, ROW: 480, STREET: 70, cars: [], last: 0, t: 0, facades: null, scan: null, city: null };
  const WINDOWS = ["#22d3ee", "#f472b6", "#facc15", "#a5f3fc"];
  // A sheet of windows per colour and how many are lit, 96 x 512; towers cut their own stretch out of it, so 500 towers are 500 images, not 100,000 rectangles
  function facades() {
    if (CP.facades) return CP.facades;
    CP.facades = WINDOWS.map((col, ci) => [0.05, 0.25, 0.65].map((lit_, di) => { const c = document.createElement("canvas"); c.width = 96; c.height = 512; const g = c.getContext("2d");
      for (let y = 4; y < 508; y += 11) for (let x = 3; x < 93; x += 8) { const h = hash(`${ci}:${di}:${x}:${y}`) % 1000 / 1000; g.fillStyle = h < lit_ ? col : "rgba(148,163,184,.08)"; g.globalAlpha = h < lit_ ? 0.45 + h / lit_ * 0.55 : 1; g.fillRect(x, y, 5, 7); }
      return c; }));
    return CP.facades;
  }
  const litLevel = n => { const a = activity(n); return staleFor(n, Q.stale_days) ? 0 : a > 0.3 ? 2 : 1; };
  scene("cyberpunk", {
    name: "Cyberpunk", icon: "cyberpunk", fps: 30, phoneFps: 30, restFps: 30, own3d: true,   // a frame only adds what moves, so a phone can afford it, and fast rain judders below 30
    blurb: "A rain-soaked neon city: topics are districts, notes are towers, stale ones go dark",
    toast: "Cyberpunk — a district per topic. Height is how relied-on a note is, lit windows how active, dark towers are stale, pink beacons are open tasks, the spire is the topic's map, stalls are notes with no topic",
    layout(geo) {
      const pos = new Map(geo), cs = topicsWithNotes(), { cols, rows } = gridDims(Math.max(1, cs.length), 0.8), blds = [], districts = [];
      const X0 = -cols * CP.DW / 2, Y0 = -rows * CP.ROW / 2;
      cs.forEach((c, i) => {
        const col = i % cols, row = Math.floor(i / cols), x0 = X0 + col * CP.DW + 30, base = Y0 + (row + 1) * CP.ROW - CP.STREET, span = CP.DW - 60, neon = colorOf(c.id);
        const towers = topicNotes(c.id, true).sort(byImportance).map(n => { const imp = importance(n), w = Math.max(26, Math.min(74, 16 + Math.log1p(n.words || 0) * 6.5)); return { n, w, h: 56 + 400 * Math.sqrt(imp), neon, kind: "tower", hue: hash(n.id) % WINDOWS.length, off: hash(n.id) % 240, row }; });
        // taller towers stand further back: three layers at most, each spread across the district
        const area = towers.reduce((s, t) => s + t.w * 0.82, 0), layers = Math.max(1, Math.min(3, Math.ceil(area / span))), per = Math.ceil(towers.length / layers);
        for (let l = 0; l < layers; l++) { const part = towers.slice(l * per, (l + 1) * per), layerBase = base - (layers - 1 - l) * 16, step = span / Math.max(1, part.length);
          part.forEach((t, j) => { const jitter = (hash(t.n.id) % 100) / 100 * step * 0.25; t.x = x0 + (part.length < 6 ? (span - part.length * 92) / 2 + j * 92 : j * step + jitter); t.x = Math.min(x0 + span - t.w, t.x); t.base = layerBase; t.layer = l; t.dim = 1 - (layers - 1 - l) * 0.22; blds.push(t); pos.set(t.n.id, [t.x + t.w / 2, t.base - t.h / 2]); }); }
        const m = mocOf[c.id]; if (m && byId[m.id]) { const t = { n: byId[m.id], w: 40, h: 500, neon, kind: "spire", hue: 3, off: 0, row, x: x0 + span / 2 - 20, base: base - 48, layer: -1, dim: 0.95 }; blds.push(t); pos.set(m.id, [t.x + 20, t.base - t.h / 2]); }
        districts.push({ c: c.id, x0, base, span, row, neon, cars: Math.round(2 + 10 * Math.min(1, topicBusy(c.id) / 6)) });
      });
      // the notes with no district (unlinked, or linked but in no topic) are stalls down on the street, along the front row
      const front = rows - 1, baseFront = Y0 + (front + 1) * CP.ROW - CP.STREET;
      nodes.filter(n => !special(n) && !n.ghost && !blds.some(b => b.n === n)).forEach(n => { const [u] = scatter("stall:" + n.id), t = { n, w: 20, h: 22, neon: "#94a3b8", kind: "stall", hue: 2, off: 0, row: front, x: X0 + u * (cols * CP.DW - 40), base: baseFront + 10, layer: 9, dim: 1 }; blds.push(t); pos.set(n.id, [t.x + 10, t.base - 11]); });
      blds.sort((a, b) => a.row - b.row || a.layer - b.layer || b.h - a.h);
      CP.cars = []; districts.forEach(d => { for (let i = 0; i < d.cars; i++) { const [u, v] = scatter(`car:${d.c}:${i}`); CP.cars.push({ d, u, lane: 150 + v * 300, v: (0.03 + v * 0.06) * (i % 2 ? 1 : -1), col: i % 3 ? "#fca5a5" : "#e0f2fe" }); } });
      const XE = -X0 + 40, YT = Y0 - 80, YB = -Y0 + 40;
      return { pos, blds, districts, rows, cols, bounds: [[-XE, YT], [XE, YT], [XE, YB], [-XE, YB]] };
    },
    fit: n => !!mapCache.cyberpunk && mapCache.cyberpunk.pos.has(n.id) && !n.ghost,
    lit: id => new Set([id, ...nb[id]]),
    // The city stands still, so it's painted once and kept: full-screen haze per row, the sky and the scanlines are what a phone
    // can't afford thirty times a second. Each frame shows the kept picture and adds what moves: flicker, beacons, traffic, rain.
    draw(now) {
      const { dpr, R, litSet, font, k } = mapFrame(), D = mapCache.cyberpunk, reduced = reducedMotion(), dt = tickOf(CP, now); CP.t += dt / 1000; const t = CP.t;
      const backdrop = (mx = 0, my = 0) => { const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, "#05010f"); sky.addColorStop(0.5, "#1a0533"); sky.addColorStop(1, "#4a0e4e"); ctx.fillStyle = sky; ctx.fillRect(-mx, -my, W + 2 * mx, H + 2 * my);
        // the low sun behind everything, cut by bands of smog
        const sr = Math.min(W, H) * 0.3, sx = W * 0.5, sy = H * 0.34, sun = ctx.createLinearGradient(0, sy - sr, 0, sy + sr); sun.addColorStop(0, "#fde047"); sun.addColorStop(0.55, "#f472b6"); sun.addColorStop(1, "#7e22ce");
        ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = "#1a0533"; for (let i = 0; i < 7; i++) { const y = sy + sr * (0.08 + i * 0.13), h = 2 + i * 1.6; ctx.fillRect(sx - sr, y, sr * 2, h); } };
      if (!D) { backdrop(); return; }
      // a phone paints the kept picture a little softer and with a margin around the screen, so it can be slid under a finger
      const phone = MOBILE && !reduced, mx = phone ? W * 0.4 : 0, my = phone ? H * 0.25 : 0, ld = phone ? Math.min(dpr, 1.5) : dpr;
      const shown = n => n && mapShown(n), F = facades(), onScreen = (x, w) => x + w > -20 - mx && x < W + mx + 20;
      // 3D: each street further back is smaller and nearer the horizon. 2D: the same city, flat on.
      const deep = st.angles.cyberpunk === "tilt3d", vy = H * 0.16, depthOf = row => deep ? 0.42 + 0.58 * Math.pow((row + 1) / Math.max(1, D.rows), 1.25) : 1;
      const at = (x, y, row) => { const q = scr(x, y, R), sc = depthOf(row); return { x: W / 2 + (q.x - W / 2) * sc, y: vy + (q.y - vy) * sc }; };
      // what the kept picture depends on: the camera, what's selected, and each tower's showing, lit, stale and tasks
      let sig = 0; for (const b of D.blds) { const n = b.n; sig = (Math.imul(sig, 31) + (shown(n) ? 1 + (!litSet || litSet.has(n.id) ? 2 : 0) + litLevel(n) * 4 + (n.tasks > 0 ? 16 : 0) : 0)) | 0; }
      const size = [W, H, dpr].join("x"), key = [k.toFixed(4), cam.tx.toFixed(1), cam.ty.toFixed(1), cam.yaw.toFixed(3), cam.pitch.toFixed(3), deep, st.selected || "", sig].join("|");
      const kept = CP.city && CP.city.map === D && CP.city.size === size ? CP.city : null;
      // a repaint is the long frame a finger feels, so a phone doesn't repaint while the camera moves: it slides and scales the kept
      // picture, and repaints once the camera has stopped, or when it would run out of picture
      if (key !== CP.seenKey) { CP.seenKey = key; CP.seenAt = now; }
      const scale = kept ? k / kept.k : 1, o0 = scr(0, 0, R), ox = kept ? o0.x - kept.o.x * scale : 0, oy = kept ? o0.y - kept.o.y * scale : 0;
      const covered = kept && ox - mx * scale <= 0 && ox + (W + mx) * scale >= W && oy - my * scale <= 0 && oy + (H + my) * scale >= H;
      const wait = kept && kept.key !== key && phone && covered && (drag || tween || now - CP.seenAt < 180);
      if (kept && (kept.key === key || wait)) kept.P.forEach((v, id) => P.set(id, v));
      else {
        const px = [Math.round((W + 2 * mx) * ld), Math.round((H + 2 * my) * ld)], cv2 = CP.city && CP.city.canvas.width === px[0] && CP.city.canvas.height === px[1] ? CP.city.canvas : Object.assign(document.createElement("canvas"), { width: px[0], height: px[1] });
        const main = ctx; ctx = cv2.getContext("2d"); ctx.setTransform(ld, 0, 0, ld, ld * mx, ld * my); ctx.globalAlpha = 1;
        backdrop(mx, my); ctx.imageSmoothingEnabled = false;
        // the parts that move, each found here so a frame needn't walk the city; one a nearer tower stands in front of isn't added
        const rects = [], flicks = [], beacons = [], tips = [];
        let row = -1; const finishRow = r => { if (r < 0) return;
          ctx.fillStyle = "rgba(38,10,60,.2)"; ctx.fillRect(-mx, -my, W + 2 * mx, H + 2 * my);   // the haze: everything further away has passed under this once more
          // the street: wet asphalt, with the district's neon smeared into it
          D.districts.forEach(d => { if (d.row !== r) return; const p = at(d.x0 - 30, d.base, d.row), wpx = CP.DW * k * depthOf(d.row), hpx = CP.STREET * k * depthOf(d.row); if (!onScreen(p.x, wpx)) return; const wet = ctx.createLinearGradient(0, p.y, 0, p.y + hpx); wet.addColorStop(0, hexMix(d.neon, "#0b0716", 0.72)); wet.addColorStop(1, "#07040f"); ctx.fillStyle = wet; ctx.fillRect(p.x, p.y, wpx, hpx);
            topicLabel(d.c, clip(shortName(d.c), 30), p.x + wpx / 2, p.y + hpx * 0.55, wpx * 0.9, hexMix(d.neon, "#ffffff", 0.5), "#07040f"); }); };
        for (const b of D.blds) { if (b.row !== row) { finishRow(row); row = b.row; } const n = b.n; if (!shown(n)) continue;
          const kk = k * depthOf(b.row), p = at(b.x, b.base, b.row), wpx = b.w * kk, hpx = b.h * kk, top = p.y - hpx; if (!onScreen(p.x, wpx)) { P.set(n.id, { x: p.x + wpx / 2, y: p.y - hpx / 2, r: 0.1, s: 1, depth: 0, a: 0 }); continue; }
          const on = !litSet || litSet.has(n.id), level = b.kind === "spire" ? 2 : litLevel(n), dark = level === 0, flick = dark ? 0.85 : 1, own = rects.length;
          rects.push([p.x, top, p.x + wpx, p.y]);
          ctx.globalAlpha = on ? b.dim : 0.2;
          ctx.fillStyle = dark ? "#0d0d16" : hexMix(b.neon, "#0a0a18", 0.88); ctx.fillRect(p.x, top, wpx, hpx);
          if (b.kind === "stall") { ctx.fillStyle = "#facc15"; ctx.globalAlpha *= 0.8; ctx.fillRect(p.x, top + hpx * 0.1, wpx, Math.max(1, hpx * 0.18)); }
          else {
            if (wpx > 2.5 && hpx > 6) { const sw = Math.min(b.w, 96), sh = Math.min(b.h, 500), hm = Math.floor(hpx / (b.h / sh)); ctx.drawImage(F[b.hue][level], b.off % (96 - sw + 1), 0, sw, sh, p.x, p.y - hm, wpx, hm); }
            // the roof's neon line, doubled for the glow
            ctx.strokeStyle = b.neon; ctx.globalAlpha *= 0.4 * flick; ctx.lineWidth = Math.max(1, 3.5 * kk); ctx.beginPath(); ctx.moveTo(p.x, top); ctx.lineTo(p.x + wpx, top); ctx.stroke();
            ctx.globalAlpha = (on ? b.dim : 0.2) * flick; ctx.lineWidth = Math.max(0.6, 1.2 * kk); ctx.stroke();
            ctx.globalAlpha = on ? b.dim : 0.2;
            if (dark && on) flicks.push({ x: p.x, y: top - 2, w: wpx, h: 4, off: b.off, own });
            if (b.kind === "spire") { const tip = top - 90 * kk; ctx.strokeStyle = b.neon; ctx.lineWidth = Math.max(1, 2 * kk); ctx.beginPath(); ctx.moveTo(p.x + wpx / 2, top); ctx.lineTo(p.x + wpx / 2, tip); ctx.stroke(); tips.push({ x: p.x + wpx / 2, y: tip, r: Math.max(1.5, 4 * kk), own }); }
            // the vertical sign down one side, with the note's name once it can be read
            const signW = Math.max(2, Math.min(16, b.w * 0.26)) * kk, sx_ = p.x + (b.off % 2 ? -signW * 0.4 : wpx - signW * 0.6), signH = Math.min(hpx * 0.72, 260 * kk);
            if (hpx > 26) { ctx.globalAlpha = (on ? 0.9 : 0.2) * flick * (dark ? 0.6 : 1); ctx.fillStyle = hexMix(b.neon, "#000000", 0.2); ctx.fillRect(sx_, top + hpx * 0.08, signW, signH); ctx.fillStyle = "#050510"; ctx.fillRect(sx_ + 1, top + hpx * 0.08 + 1, Math.max(0, signW - 2), Math.max(0, signH - 2));
              if (signW > 9) { ctx.save(); const px = Math.min(13, signW * 0.7); ctx.translate(sx_ + signW / 2, top + hpx * 0.08 + 4); ctx.rotate(Math.PI / 2); ctx.font = `700 ${px}px ${font}`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = dark ? hexMix(b.neon, "#94a3b8", 0.6) : hexMix(b.neon, "#ffffff", 0.45); ctx.fillText(clip(n.name, Math.floor(signH / (px * 0.56))), 0, 0); ctx.restore(); }
              if (dark && on) flicks.push({ x: sx_, y: top + hpx * 0.08, w: signW, h: signH, off: b.off, own }); }
            ctx.globalAlpha = on ? 1 : 0.2;
            // a pink beacon for open tasks: blinking on a tower that's lit, steady and faint on one that isn't
            if (n.tasks > 0) { const r = Math.max(1.6, 4 * kk), bx = p.x + wpx / 2; if (on) beacons.push({ x: bx, y: top - r, r, off: b.off, own }); else { ctx.fillStyle = "#fb7185"; ctx.beginPath(); ctx.arc(bx, top - r, r, 0, 2 * Math.PI); ctx.fill(); } }
          }
          if (st.selected === n.id) { ctx.globalAlpha = 1; ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.strokeRect(p.x - 1, top - 1, wpx + 2, hpx + 2); }
          P.set(n.id, { x: p.x + wpx / 2, y: p.y - hpx / 2, r: Math.max(wpx * 0.6, hpx * 0.38), s: kk, depth: -b.layer, a: on ? 1 : 0.3 });
        }
        finishRow(row); ctx.globalAlpha = 1;
        // the selected tower's links, as neon arcs
        if (st.selected && P.has(st.selected) && nb[st.selected]) { const a = P.get(st.selected); ctx.lineWidth = 1.5; ctx.strokeStyle = "#22d3ee"; ctx.shadowColor = "#22d3ee"; ctx.shadowBlur = 8; ctx.beginPath(); nb[st.selected].forEach(id => { const q = P.get(id); if (!q || q.r < 1) return; ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + q.x) / 2, Math.min(a.y, q.y) - 80 * k - 20, q.x, q.y); }); ctx.stroke(); ctx.shadowBlur = 0; }
        // scanlines over the lot
        if (!CP.scan) { const c = document.createElement("canvas"); c.width = 2; c.height = 3; const g = c.getContext("2d"); g.fillStyle = "rgba(0,0,0,.2)"; g.fillRect(0, 2, 2, 1); CP.scan = c; }
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = ctx.createPattern(CP.scan, "repeat"); ctx.fillRect(0, 0, px[0], px[1]); ctx.imageSmoothingEnabled = true;   // in the layer's own pixels, so the lines stay even
        const seen = i => { const cx = i.x + (i.w || 0) / 2, cy = i.y + (i.h || 0) / 2; for (let j = i.own + 1; j < rects.length; j++) { const r = rects[j]; if (cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]) return false; } return true; };
        CP.city = { key, size, map: D, canvas: cv2, k, o: scr(0, 0, R), P: new Map(P), flicks: flicks.filter(seen), beacons: beacons.filter(seen), tips: tips.filter(seen) };
        const dark = D.blds.filter(b => b.kind === "tower" && shown(b.n) && litLevel(b.n) === 0).length; setSceneStat(`${plural(D.blds.filter(b => b.kind === "tower" && shown(b.n)).length, "tower")} · ${dark} dark`);
        ctx = main; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const C = CP.city, o = scr(0, 0, R), s = k / C.k, dx = o.x - C.o.x * s, dy = o.y - C.o.y * s, slid = s !== 1 || dx !== 0 || dy !== 0;
      if (slid || phone) { if (slid) { ctx.fillStyle = "#1a0533"; ctx.fillRect(0, 0, W, H); } ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * dx, dpr * dy); ctx.drawImage(C.canvas, -mx, -my, W + 2 * mx, H + 2 * my); }
      else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(C.canvas, 0, 0); ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * dx, dpr * dy); }
      // a stale tower's sign and roof flicker
      if (!reduced && C.flicks.length) { ctx.fillStyle = "rgba(5,5,16,.7)"; ctx.beginPath(); C.flicks.forEach(f => { if (Math.sin(t * 13 + f.off) > 0.72 || Math.sin(t * 2.1 + f.off) > 0.92) ctx.rect(f.x, f.y, f.w, f.h); }); ctx.fill(); }
      const dots = (list, r, fill, when) => { ctx.fillStyle = fill; ctx.beginPath(); list.forEach(i => { if (reduced || when(i)) { const q = r(i); ctx.moveTo(i.x + q, i.y); ctx.arc(i.x, i.y, q, 0, 2 * Math.PI); } }); ctx.fill(); };
      const blink = i => Math.sin(t * 4 + i.off) > -0.3;
      dots(C.beacons, i => i.r * 3, "rgba(244,63,94,.28)", blink); dots(C.beacons, i => i.r, "#fb7185", blink); dots(C.tips, i => i.r, "#ef4444", () => Math.sin(t * 3) > 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // traffic: each district's air lane, as busy as the district
      ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(0.8, 1.8 * k);
      for (const [sign, col] of [[1, "#f87171"], [-1, "#e0f2fe"]]) { ctx.strokeStyle = col; ctx.beginPath(); CP.cars.forEach(c => { const dir = Math.sign(c.v); if (dir !== sign) return; const u = ((c.u + c.v * t) % 1 + 1) % 1, p = at(c.d.x0 + u * c.d.span, c.d.base - c.lane, c.d.row); if (!onScreen(p.x, 1)) return; const len = Math.max(3, 18 * k * depthOf(c.d.row)); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dir * len, p.y); }); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // rain, in one stroke
      ctx.strokeStyle = "rgba(186,230,253,.22)"; ctx.lineWidth = 1; ctx.beginPath(); const drops = opts.compact ? 40 : MOBILE ? 70 : 170, fall = reduced ? 0 : t;
      for (let i = 0; i < drops; i++) { const h = (i * 2654435761) >>> 0, x = (h % 2003) / 2003 * (W + 60), y = ((h >>> 11) % 1009) / 1009 * (H + 40), sp = 700 + (h % 400), py = (y + fall * sp) % (H + 40) - 20, px = (x - (y + fall * sp) * 0.12 % (W + 60) + W + 60) % (W + 60), len = 9 + (h % 13); ctx.moveTo(px, py); ctx.lineTo(px - len * 0.12, py + len); }
      ctx.stroke();
    },
    legend: item => item("<b style='color:#22d3ee'>▮</b>", "height = relied-on, windows = activity") + item("<b style='color:#475569'>▮</b>", "dark = stale") + item("<b style='color:#fb7185'>●</b>", "open tasks") + item("<b style='color:#facc15'>▂</b>", "stall = no topic"),
    today() {
      const D = mapCache.cyberpunk; if (!D) return null;
      const dark = d => topicNotes(d.c, true).filter(n => litLevel(n) === 0), worst = D.districts.slice().sort((a, b) => dark(b).length - dark(a).length)[0]; if (!worst || !dark(worst).length) return null;
      return { text: `Darkest district: ${clusterName(worst.c)} · ${plural(dark(worst).length, "stale note")}`, label: "Go there", run: () => { const ids = new Set(topicNotes(worst.c, true).map(n => n.id)); fit(n => ids.has(n.id), 700); } };
    },
  });
