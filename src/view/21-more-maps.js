  // ---------------------------------------------------------------- more maps: weather, ships, rings, sky, realm, food web, clock, radar
  // Shared bits: each topic's centre on the familiar 2D map, marching-squares contours, and a raster helper.
  function topicCentres(geo, minSize) {
    const acc = {};
    nodes.forEach(n => { if (special(n) || n.ghost || n.cluster < 0) return; const p = geo.get(n.id); if (!p) return;
      const a = acc[n.cluster] = acc[n.cluster] || { x: 0, y: 0, n: 0 }; a.x += p[0]; a.y += p[1]; a.n++; });
    const out = {}; Object.entries(acc).forEach(([c, a]) => { if (a.n >= (minSize || 1)) out[c] = [a.x / a.n, a.y / a.n, a.n]; });
    return out;
  }
  function contourSegs(E, gw, gh, lv, x0, y0, cell) {   // marching squares: [x1, y1, x2, y2, ...] in world units
    const seg = [];
    for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
      const a = E[j * gw + i], b = E[j * gw + i + 1], c = E[(j + 1) * gw + i + 1], d = E[(j + 1) * gw + i];
      const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = [i + (lv - a) / (b - a), j], Rr = [i + 1, j + (lv - b) / (c - b)], B = [i + (lv - d) / (c - d), j + 1], Lf = [i, j + (lv - a) / (d - a)];
      const pairs = { 1: [Lf, B], 2: [B, Rr], 3: [Lf, Rr], 4: [T, Rr], 5: [Lf, T, B, Rr], 6: [T, B], 7: [Lf, T], 8: [Lf, T], 9: [T, B], 10: [T, Rr, Lf, B], 11: [T, Rr], 12: [Lf, Rr], 13: [B, Rr], 14: [Lf, B] }[idx];
      for (const p of pairs) seg.push(x0 + p[0] * cell, y0 + p[1] * cell);
    }
    return seg;
  }
  function strokeSegs(seg) { ctx.beginPath(); for (let i = 0; i < seg.length; i += 4) { ctx.moveTo(seg[i], seg[i + 1]); ctx.lineTo(seg[i + 2], seg[i + 3]); } ctx.stroke(); }
  const worldTransform = (dpr, R) => { const o = scr(0, 0, R); ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * o.x, dpr * o.y); };
  // the box round some points, padded; no points (an empty vault) gives a small box round the origin, never Infinity
  const bounds = (pts, pad) => { if (!pts.length) return [-pad, -pad, pad, pad]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return [x0 - pad, y0 - pad, x1 + pad, y1 + pad]; };
  const timelineData = () => DATA.timeline || { weeks: [], clusters: {}, notes: {} };
  const dots = (pred, col, r, R) => { for (const n of nodes) { if (!pred(n) || !mapShown(n)) continue; const p = scr(n.x, n.y, R); ctx.fillStyle = col(n); ctx.beginPath(); ctx.arc(p.x, p.y, r(n), 0, 2 * Math.PI); ctx.fill();
    P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -importance(n), r: Math.max(5, r(n) + 2), a: 1 }); } };
  const selRing = (R, col) => { if (!st.selected || !P.has(st.selected)) return; const p = P.get(st.selected); ctx.strokeStyle = col || UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, 2 * Math.PI); ctx.stroke(); };
  // Note names in map views: below the note's shape, else beside it (right, then left), else above, else the same shortened; never
  // over another shape drawn this frame (bodies, from iso.hit: blocks, towers, figures) or another label (freeSpot).
  // A name with no free spot is left out. p.box (from iso.hit) is the shape's own box, the one the name goes around.
  const overBody = (x, y, w, h) => bodies.some(b => x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]);
  const noteLabels = (ids, fill, halo, max) => { const f = `500 10px ${css("--vg-font") || "system-ui"}`;
    ids.slice(0, max).forEach(id => { const p = P.get(id); if (!p) return;
      const own = p.box, top = own ? own[1] : p.y - p.r, bot = own ? own[1] + own[3] : p.y + p.r, left = own ? own[0] : p.x - p.r, right = own ? own[0] + own[2] : p.x + p.r;
      for (const t of [clip(byId[id].name, 24), clip(byId[id].name, 12)]) { ctx.font = f; const w = ctx.measureText(t).width;
        const at = [[p.x - w / 2, bot + 1, "center", p.x, bot + 7], [right + 4, p.y - 6, "left", right + 4, p.y], [left - 4 - w, p.y - 6, "right", left - 4, p.y], [p.x - w / 2, top - 13, "center", p.x, top - 7]]
          .find(([x, y]) => !overBody(paneX(x, w), y, w, 12) && freeSpot(x, y, w, 12));
        if (at) { haloText(t, at[3], at[4], fill, halo, f, at[2]); return; }
      } }); };

  // Weather: which topics are heating up or going quiet. Pressure comes from your dailies: a topic mentioned more
  // than usual over the last three weeks is a low (busy, L), quieter than usual a high (calm, H). A storm is a
  // sudden burst (last week well above usual). Isobars join equal pressure; fronts mark topics that come up together.
  function weatherLayout(geo) {
    const T0 = timelineData(), cut = st.timeAt ? Math.max(4, T0.weeks.filter(w => w <= st.timeAt).length) : T0.weeks.length;   // time-lapse: weather as of that week
    const T = { weeks: T0.weeks.slice(0, cut), clusters: Object.fromEntries(Object.entries(T0.clusters).map(([c, v]) => [c, v.slice(0, cut)])) }, cen = topicCentres(geo, 3), W0 = T.weeks.length;
    const tops = Object.entries(cen).map(([c, [x, y, n]]) => {
      const s = T.clusters[c] || [], last3 = s.slice(-3), base = s.slice(0, Math.max(1, W0 - 3));
      const r = last3.reduce((a, b) => a + b, 0) / Math.max(1, last3.length), b = base.reduce((a, v) => a + v, 0) / Math.max(1, base.length);
      const a = Math.max(-2, Math.min(2, Math.log2((r + 0.5) / (b + 0.5)))), lastW = s[s.length - 1] || 0;
      return { c: +c, x, y, n, a, ratio: (r + 0.5) / (b + 0.5), recent: r, base: b, storm: lastW >= 4 && lastW >= 2.5 * (b + 0.5), sig: 90 + 14 * Math.sqrt(n) };
    });
    const [x0, y0, x1, y1] = bounds([...geo.values()], 220), CELL = Math.max(10, Math.sqrt((x1 - x0) * (y1 - y0) / 26000));
    const gw = Math.ceil((x1 - x0) / CELL) + 1, gh = Math.ceil((y1 - y0) / CELL) + 1, E = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = x0 + i * CELL, y = y0 + j * CELL; let v = 0;
      for (const t of tops) { const d2 = (x - t.x) ** 2 + (y - t.y) ** 2; v -= t.a * Math.exp(-d2 / (2 * t.sig * t.sig)); } E[j * gw + i] = v; }
    let lo = Infinity, hi = -Infinity; for (const v of E) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const iso = []; for (let lv = Math.ceil(lo / 0.12) * 0.12; lv < hi; lv += 0.12) if (Math.abs(lv) > 1e-6) iso.push({ lv, seg: contourSegs(E, gw, gh, lv, x0, y0, CELL) });
    const off = document.createElement("canvas"); off.width = gw; off.height = gh;
    const oc = off.getContext("2d"), img = oc.createImageData(gw, gh);
    for (let k = 0; k < E.length; k++) { const v = Math.max(-1, Math.min(1, E[k] / Math.max(0.3, Math.max(-lo, hi))));
      const c = v < 0 ? [231, 76, 60].map((x, i) => [234, 236, 240][i] + (x - [234, 236, 240][i]) * -v * 0.7) : [59, 130, 246].map((x, i) => [234, 236, 240][i] + (x - [234, 236, 240][i]) * v * 0.6);
      img.data.set([c[0], c[1], c[2], 255], k * 4); }
    oc.putImageData(img, 0, 0);
    const byC = Object.fromEntries(tops.map(t => [t.c, t]));
    const fronts = (DATA.pairs || []).filter(([a, b, l, m]) => m >= 2 && byC[a] && byC[b]).sort((p, q) => q[3] - p[3]).slice(0, 7).map(([a, b, l, m]) => ({ a: byC[a], b: byC[b], m }));
    return { pos: geo, tops, iso, img: off, x0, y0, w: gw * CELL, h: gh * CELL, fronts, E, gw, gh, CELL };
  }
  function drawWeather(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), Wd = mapCache.weather;
    ctx.fillStyle = "#e9ecf1"; ctx.fillRect(0, 0, W, H); if (!Wd) return;
    worldTransform(dpr, R); ctx.imageSmoothingEnabled = true; ctx.drawImage(Wd.img, Wd.x0, Wd.y0, Wd.w, Wd.h);
    Wd.iso.forEach(c => { ctx.strokeStyle = c.lv < 0 ? "rgba(153,27,27,.45)" : "rgba(30,64,175,.4)"; ctx.lineWidth = (Math.abs(c.lv) % 0.48 < 0.01 ? 1.6 : 0.8) / k; strokeSegs(c.seg); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // wind: particles carried from high pressure to low, turned a little (as the Coriolis force does)
    const wind = (x, y) => { const i = Math.round((x - Wd.x0) / Wd.CELL), j = Math.round((y - Wd.y0) / Wd.CELL);
      if (i < 1 || j < 1 || i >= Wd.gw - 1 || j >= Wd.gh - 1) return null;
      const gx = Wd.E[j * Wd.gw + i + 1] - Wd.E[j * Wd.gw + i - 1], gy = Wd.E[(j + 1) * Wd.gw + i] - Wd.E[(j - 1) * Wd.gw + i];
      return [(-gx * 0.85 - gy * 0.5) * 9, (-gy * 0.85 + gx * 0.5) * 9]; };
    const wx = Wd.wx || (Wd.wx = { parts: [] }), wdt = tickOf(wx, now);
    while (wx.parts.length < (MOBILE ? 140 : 280)) wx.parts.push({ x: Wd.x0 + Math.random() * Wd.w, y: Wd.y0 + Math.random() * Wd.h, life: Math.random() * 4000 });
    ctx.strokeStyle = "rgba(51,65,85,.4)"; ctx.lineWidth = 1.2; ctx.beginPath();
    wx.parts.forEach(q => { const v = wind(q.x, q.y); q.life -= wdt;
      if (!v || q.life <= 0 || Math.hypot(v[0], v[1]) < 0.01) { q.x = Wd.x0 + Math.random() * Wd.w; q.y = Wd.y0 + Math.random() * Wd.h; q.life = 2500 + Math.random() * 3500; return; }
      const m = Math.hypot(v[0], v[1]), sp = 0.4 + 1.2 * Math.min(1, m * 4), ux = v[0] / m, uy = v[1] / m; q.x += ux * sp * wdt * 0.06; q.y += uy * sp * wdt * 0.06;
      const L = 6 + 14 * Math.min(1, m * 4), a = scr(q.x, q.y, R), b = scr(q.x - ux * L, q.y - uy * L, R); ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); });   // a streak, longer in stronger wind
    ctx.stroke();
    // fronts: two topics that keep coming up together. Warm (red, half-moons) when both are heating up,
    // cold (blue, triangles) when one is heating and one cooling, stationary (alternating) otherwise
    Wd.fronts.forEach(f => {
      const a = scr(f.a.x, f.a.y, R), b = scr(f.b.x, f.b.y, R), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L, half = Math.min(90, L * 0.35) * 1, kind = f.a.a > 0.2 && f.b.a > 0.2 ? "warm" : (f.a.a > 0.2) !== (f.b.a > 0.2) ? "cold" : "still";
      const p0 = [mx - nx * half, my - ny * half], p1 = [mx + nx * half, my + ny * half], col = kind === "warm" ? "#dc2626" : kind === "cold" ? "#2563eb" : "#7c3aed";
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke();
      for (let t = 0.1; t < 0.95; t += 0.2) { const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, sgn = dx * 0 + 1, kd = kind === "still" ? (Math.round(t * 5) % 2 ? "warm" : "cold") : kind;
        ctx.fillStyle = kd === "warm" ? "#dc2626" : "#2563eb"; ctx.beginPath();
        if (kd === "warm") ctx.arc(x, y, 5, Math.atan2(ny, nx) + Math.PI / 2, Math.atan2(ny, nx) + Math.PI * 1.5);
        else { ctx.moveTo(x - nx * 5, y - ny * 5); ctx.lineTo(x + nx * 5, y + ny * 5); ctx.lineTo(x + dx / L * 7 * sgn, y + dy / L * 7 * sgn); }
        ctx.closePath(); ctx.fill(); }
    });
    dots(n => !special(n) && !n.ghost, () => "rgba(30,41,59,.45)", () => Math.max(1.4, 1.8 * Math.sqrt(k)), R);
    // clouds drift round busy topics; a storm's clouds are darker and spin faster
    Wd.tops.forEach(t => { if (t.a < 0.35 && !t.storm) return;
      const p = scr(t.x, t.y, R), puffs = t.storm ? 6 : 3, spin = (reducedMotion() ? 0 : now) / (t.storm ? 2600 : 9000);
      for (let i = 0; i < puffs; i++) { const a = spin + i / puffs * 2 * Math.PI, rr = (t.storm ? 46 : 60) * Math.sqrt(k), x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr * 0.6, cr = (t.storm ? 30 : 26) * Math.sqrt(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, cr); g.addColorStop(0, t.storm ? "rgba(71,85,105,.5)" : "rgba(255,255,255,.75)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, cr, cr * 0.65, 0, 0, 2 * Math.PI); ctx.fill(); } });
    // pressure centres: L for busy, H for quiet; storms get rain and lightning
    Wd.tops.slice().sort((a, b) => Math.abs(b.a) - Math.abs(a.a)).forEach(t => {
      const p = scr(t.x, t.y, R), lit = !litSet || nodes.some(n => n.cluster === t.c && litSet.has(n.id));
      ctx.globalAlpha = lit ? 1 : 0.3;
      if (t.storm && !reducedMotion()) { ctx.strokeStyle = "rgba(37,99,235,.6)"; ctx.lineWidth = 1;
        for (let i = 0; i < 26; i++) { const h = hash(t.c + "r" + i), x = p.x + ((h % 160) - 80) * Math.sqrt(k), y0 = p.y - 60 + (((h >>> 8) % 120) + now / 6) % 120 * Math.sqrt(k);
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x - 3, y0 + 9); ctx.stroke(); }
        if ((now / 1200 + t.c) % 4 < 0.12) { ctx.fillStyle = "rgba(250,204,21,.9)"; ctx.font = `700 26px ${font}`; ctx.textAlign = "center"; ctx.fillText("⚡", p.x + 24, p.y - 24); } }
      if (Math.abs(t.a) >= 0.35) { const L = t.a > 0; ctx.font = `800 ${Math.round(18 + 8 * Math.abs(t.a))}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = L ? "#b91c1c" : "#1d4ed8"; ctx.fillText(L ? "L" : "H", p.x, p.y); }
      const name = clip(clusterName(t.c), 26), sub = t.storm ? `⛈ storm · ${t.ratio.toFixed(1)}× usual` : t.a >= 0.35 ? `heating up · ${t.ratio.toFixed(1)}× usual` : t.a <= -0.35 ? "quiet" : "steady";
      const f = `700 11px ${font}`; ctx.font = `500 9.5px ${font}`; const ws = ctx.measureText(sub).width; ctx.font = f; const w = Math.max(ctx.measureText(name).width, ws);   // the box covers both lines
      if (freeSpot(p.x - w / 2, p.y + 14, w, 26)) { haloText(name, p.x, p.y + 20, "#0f172a", "rgba(255,255,255,.85)", f, "center"); haloText(sub, p.x, p.y + 33, "#475569", "rgba(255,255,255,.85)", `500 9.5px ${font}`, "center"); }
      ctx.globalAlpha = 1;
    });
    selRing(R, "#0f172a");
  }

  // Shipping lanes: how knowledge moves between topics. Topics are islands (bigger = more notes) with a port; links
  // between topics are shipping lanes, busier with more links; gaps (topics that come up together but don't link)
  // are fogged-in, uncharted crossings.
  function shipsLayout(geo) {
    const cen = topicCentres(geo, 3), ports = {}, pos = new Map(geo);
    Object.entries(cen).forEach(([c, [x, y, n]]) => { ports[c] = { c: +c, x: x * 1.7, y: y * 1.7, n, r: 26 + 7 * Math.sqrt(n) }; });
    // nudge islands apart so they don't overlap
    const ps = Object.values(ports);
    for (let it = 0; it < 60; it++) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, need = a.r + b.r + 95;   // room for a port name between
      if (d < need) { const m = (need - d) / 2 / d; a.x -= dx * m; a.y -= dy * m; b.x += dx * m; b.y += dy * m; } }
    const byC = {}; nodes.forEach(n => { if (!special(n) && !n.ghost && ports[n.cluster]) (byC[n.cluster] = byC[n.cluster] || []).push(n); });
    Object.entries(byC).forEach(([c, ms]) => { const pt = ports[c]; ms.sort(byImportance);
      ms.forEach((n, i) => { const rr = (pt.r - 8) * Math.sqrt((i + 0.5) / ms.length), a = i * 2.39996; pos.set(n.id, [pt.x + Math.cos(a) * rr, pt.y + Math.sin(a) * rr]); }); });
    const lanes = (DATA.pairs || []).filter(([a, b, l]) => l > 0 && ports[a] && ports[b]).map(([a, b, l]) => ({ a: ports[a], b: ports[b], l }));
    const fog = (DATA.gaps || []).filter(g => ports[g.a] && ports[g.b]).map(g => ({ a: ports[g.a], b: ports[g.b], m: g.comentions }));
    return { pos, ports, lanes, fog };
  }
  function drawShips(now) {
    const { R, litSet, font, k } = mapFrame(), S = mapCache.ships;
    backdrop("#0b3a5b", "#06243b");
    if (!S) return;
    ctx.strokeStyle = "rgba(147,197,253,.07)"; ctx.lineWidth = 1;   // swell
    for (let y = 20; y < H; y += 26) { ctx.beginPath(); for (let x = 0; x <= W; x += 16) { const yy = y + Math.sin(x / 40 + y + now / 1600) * 3; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    const curve = (a, b, bend) => { const A = scr(a.x, a.y, R), B = scr(b.x, b.y, R), cx = (A.x + B.x) / 2 + (B.y - A.y) * bend, cy = (A.y + B.y) / 2 - (B.x - A.x) * bend; return [A, B, cx, cy]; };
    const at = ([A, B, cx, cy], t) => { const u = 1 - t; return [u * u * A.x + 2 * u * t * cx + t * t * B.x, u * u * A.y + 2 * u * t * cy + t * t * B.y, 2 * u * (cx - A.x) + 2 * t * (B.x - cx), 2 * u * (cy - A.y) + 2 * t * (B.y - cy)]; };
    const on = l => !litSet || nodes.some(n => (n.cluster === l.a.c || n.cluster === l.b.c) && litSet.has(n.id));
    S.fog.forEach(f => { const cv = curve(f.a, f.b, 0.12); ctx.setLineDash([2, 6]); ctx.strokeStyle = "rgba(226,232,240,.35)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cv[0].x, cv[0].y); ctx.quadraticCurveTo(cv[2], cv[3], cv[1].x, cv[1].y); ctx.stroke(); ctx.setLineDash([]);
      const [mx, my] = at(cv, 0.5); for (let i = 0; i < 4; i++) { const h = hash(f.a.c + "f" + f.b.c + i), r = (30 + h % 30) * Math.sqrt(k), x = mx + ((h >>> 6) % 50 - 25) * Math.sqrt(k), y = my + ((h >>> 12) % 30 - 15) * Math.sqrt(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, "rgba(226,232,240,.22)"); g.addColorStop(1, "rgba(226,232,240,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
      if (k > 0.5) haloText(`uncharted · ${f.m} co-mentions`, mx, my, "rgba(241,245,249,.8)", "rgba(6,36,59,.7)", `italic 500 9.5px ${font}`, "center"); });
    S.lanes.forEach(l => { const cv = curve(l.a, l.b, 0.12); ctx.globalAlpha = on(l) ? 1 : 0.15;
      ctx.strokeStyle = "rgba(186,230,253,.28)"; ctx.lineWidth = Math.min(7, 1 + Math.sqrt(l.l) * 1.3); ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.moveTo(cv[0].x, cv[0].y); ctx.quadraticCurveTo(cv[2], cv[3], cv[1].x, cv[1].y); ctx.stroke(); ctx.setLineDash([]);
      const ships = Math.min(6, Math.ceil(l.l / 2)), speed = 14000 + hash(l.a.c + "|" + l.b.c) % 6000;
      for (let i = 0; i < ships; i++) { const back = i % 2, t0 = ((reducedMotion() ? 0.3 : now / speed) + i / ships) % 1, t = back ? 1 - t0 : t0, [x, y, tx, ty] = at(cv, t), a = Math.atan2(back ? -ty : ty, back ? -tx : tx);
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(-12, -0.6, 8, 1.2);
        ctx.fillStyle = "#f8fafc"; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -3.2); ctx.lineTo(-4, 3.2); ctx.closePath(); ctx.fill(); ctx.restore(); } });
    ctx.globalAlpha = 1;
    Object.values(S.ports).forEach(pt => { const p = scr(pt.x, pt.y, R), r = pt.r * k, lit = !litSet || nodes.some(n => n.cluster === pt.c && litSet.has(n.id));
      ctx.globalAlpha = lit ? 1 : 0.35;
      ctx.fillStyle = "rgba(125,211,252,.18)"; ctx.beginPath(); ctx.arc(p.x, p.y, r + 7 * Math.sqrt(k), 0, 2 * Math.PI); ctx.fill();   // shallows
      ctx.fillStyle = "#e7d3a4"; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = hexMix(colorOf(pt.c), "#3f6b3a", 0.55); ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.84, 0, 2 * Math.PI); ctx.fill(); });
    ctx.globalAlpha = 1;
    dots(n => !special(n) && !n.ghost && S.ports[n.cluster], n => hexMix(colorOf(n.cluster), "#ffffff", 0.35), n => Math.max(1.6, (1.4 + 2.5 * importance(n)) * Math.sqrt(k)), R);
    Object.values(S.ports).sort((a, b) => b.n - a.n).forEach(pt => { const p = scr(pt.x, pt.y, R), name = `⚓ ${clip(clusterName(pt.c), 24)}`, f = `700 11px ${font}`; ctx.font = f; const w = ctx.measureText(name).width;
      if (freeSpot(p.x - w / 2, p.y - pt.r * k - 20, w, 14)) haloText(name, p.x, p.y - pt.r * k - 12, "#f8fafc", "rgba(6,36,59,.85)", f, "center"); });
    selRing(R);
  }

  // Tree rings: how each topic grew. One trunk per topic, one ring per month since its first note; a wide ring is
  // a month that added a lot, a dark scar a month with an incident or failure write-up. Each note sits in the ring
  // of the month it was born.
  const SCAR_RE = /incident|root cause|\brca\b|compromise|outage|failure|breach|exposure|crash/i;
  function ringsLayout(geo) {
    const groups = {}; nodes.forEach(n => { if (!special(n) && !n.ghost && n.cluster >= 0 && n.born && (!st.timeAt || n.born <= st.timeAt)) (groups[n.cluster] = groups[n.cluster] || []).push(n); });
    const mi = d => { const [y, m] = d.split("-").map(Number); return y * 12 + m - 1; }, nowM = mi(st.timeAt || today());   // time-lapse: the trees as they were
    const trunks = Object.entries(groups).filter(([, ms]) => ms.length >= 4).map(([c, ms]) => {
      const m0 = Math.min(...ms.map(n => mi(n.born))), months = nowM - m0 + 1, per = new Array(months).fill(0), scars = new Set();
      ms.forEach(n => { const i = mi(n.born) - m0; per[i]++; if (SCAR_RE.test(n.name)) scars.add(i); });
      const rad = []; let acc = 0; per.forEach((v, i) => { acc += 0.6 + v; rad.push(acc); });
      const R0 = 30 + 9 * Math.sqrt(ms.length); return { c: +c, ms, m0, per, scars, rad: rad.map(v => v / acc * R0), R0 };
    }).sort((a, b) => b.ms.length - a.ms.length);
    const pos = new Map(geo), cols = gridDims(trunks.length, 1.5).cols; let x = 0, y = 0, rowH = 0, col = 0;
    const placed = trunks.map(t => { const d = t.R0 * 2 + 60; if (col >= cols) { col = 0; x = 0; y += rowH; rowH = 0; } const out = { ...t, x: x + d / 2, y: y + d / 2 }; x += d; rowH = Math.max(rowH, d + 24); col++; return out; });
    const wmax = Math.max(...placed.map(t => t.x + t.R0)), hmax = y + rowH; placed.forEach(t => { t.x -= wmax / 2; t.y -= hmax / 2; });
    placed.forEach(t => t.ms.forEach(n => { const i = mi(n.born) - t.m0, r = (t.rad[i] + (i ? t.rad[i - 1] : 0)) / 2, a = (seededHash(n.id) % 6283) / 1000; pos.set(n.id, [t.x + Math.cos(a) * r, t.y + Math.sin(a) * r]); }));
    return { pos, trunks: placed, m0all: Math.min(...placed.map(t => t.m0)) };
  }
  function drawRings(now) {
    const { R, litSet, font, k } = mapFrame(), T = mapCache.rings;
    ctx.fillStyle = "#1c1410"; ctx.fillRect(0, 0, W, H); if (!T) return;
    T.trunks.forEach(t => {
      const p = scr(t.x, t.y, R), lit = !litSet || t.ms.some(n => litSet.has(n.id)), wob = a => 1 + 0.035 * Math.sin(a * 3 + t.c) + 0.02 * Math.sin(a * 7 + t.c * 2);
      ctx.globalAlpha = lit ? 1 : 0.3;
      ctx.fillStyle = "#4a2f1e"; ctx.beginPath(); for (let s = 0; s <= 48; s++) { const a = s / 48 * 2 * Math.PI, r = (t.R0 + 7) * k * wob(a); s ? ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r) : ctx.moveTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r); } ctx.fill();   // bark
      for (let i = t.rad.length - 1; i >= 0; i--) {
        const r = t.rad[i] * k, busy = t.per[i] / Math.max(1, ...t.per);
        ctx.fillStyle = hexMix(i % 2 ? "#e2bf8a" : "#d4a86f", colorOf(t.c), 0.08 + 0.25 * busy);
        ctx.beginPath(); for (let s = 0; s <= 48; s++) { const a = s / 48 * 2 * Math.PI, rr = r * wob(a); s ? ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr) : ctx.moveTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); } ctx.fill();
        ctx.strokeStyle = "rgba(92,58,30,.45)"; ctx.lineWidth = (t.m0 + i) % 12 === 0 ? 1.6 : 0.6; ctx.stroke();   // a darker line at each new year
        if (t.scars.has(i)) { const a = (hash(t.c + "s" + i) % 628) / 100; ctx.strokeStyle = "#3b1f10"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, r * wob(a) - 2), a - 0.25, a + 0.25); ctx.stroke(); }   // never negative, even mid-zoom
      }
      ctx.globalAlpha = 1;
      const m0 = t.m0, label = `${clip(clusterName(t.c), 24)}`, sub = `since ${new Date(Math.floor(m0 / 12), m0 % 12, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" })} · ${t.ms.length} notes${t.scars.size ? ` · ${t.scars.size} scar${t.scars.size > 1 ? "s" : ""}` : ""}`;
      haloText(label, p.x, p.y + (t.R0 + 18) * k, "#f5e6c8", "#1c1410", `700 ${Math.max(9, Math.min(12, 12 * Math.sqrt(k)))}px ${font}`, "center");
      if (k > 0.45) haloText(sub, p.x, p.y + (t.R0 + 18) * k + 13, "#bfa98a", "#1c1410", `500 9.5px ${font}`, "center");
    });
    const pulse = reducedMotion() ? 0.5 : 0.35 + 0.35 * Math.sin(now / 900);
    T.trunks.forEach(t => { const p = scr(t.x, t.y, R), r = t.rad[t.rad.length - 1] * k; ctx.strokeStyle = `rgba(190,242,100,${pulse * (t.per[t.per.length - 1] ? 1 : 0.4)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.stroke(); });   // growing now
    dots(n => !special(n) && !n.ghost && n.born && T.trunks.some(t => t.c === n.cluster), n => staleFor(n, Q.stale_days) ? "#6b5a48" : "#3b2416", () => Math.max(1.4, 2 * Math.sqrt(k)), R);
    const month = Date.now() - 30 * 864e5;
    nodes.forEach(n => { if (!n.born || !P.has(n.id) || new Date(n.born + "T12:00") < month) return; const q = P.get(n.id), tw = reducedMotion() ? 1 : Math.max(0, Math.sin(now / 260 + hash(n.id) % 11));
      ctx.strokeStyle = `rgba(254,249,195,${tw})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q.x - 4, q.y); ctx.lineTo(q.x + 4, q.y); ctx.moveTo(q.x, q.y - 4); ctx.lineTo(q.x, q.y + 4); ctx.stroke(); });   // born this month
    selRing(R, "#fde68a");
  }

  // Sky chart: what to read to get up to speed. Each topic is a constellation traced through its brightest notes
  // (the most relied on); brightness is influence. Rising stars (talked about lately) twinkle, fading ones
  // (stale) glow red. Faint dust is everything else.
  function skyLayout(geo) {
    const cen = topicCentres(geo, 4), pos = new Map(), cons = [];
    const cs = Object.entries(cen).sort((a, b) => b[1][2] - a[1][2]);
    cs.forEach(([c, [cx, cy, n]], i) => {   // constellations along an ecliptic band, ordered by size, alternating above and below
      const a = i / cs.length * 2 * Math.PI, X = Math.cos(a) * 820, Y = Math.sin(a) * 440 + (i % 2 ? 70 : -70);
      const ms = nodes.filter(m => m.cluster === +c && !special(m) && !m.ghost);
      const ds = ms.map(m => { const p = geo.get(m.id); return Math.hypot(p[0] - cx, p[1] - cy); }).sort((x, y) => x - y), q = ds[Math.floor(ds.length * 0.85)] || 1;
      const s = Math.min(0.6, (70 + 6 * Math.sqrt(ms.length)) / q);   // each constellation about the same size; outliers pulled in
      ms.forEach(m => { const p = geo.get(m.id); let dx = (p[0] - cx) * s, dy = (p[1] - cy) * s; const d = Math.hypot(dx, dy), cap = 130;
        if (d > cap) { dx *= cap / d; dy *= cap / d; } pos.set(m.id, [X + dx, Y + dy]); });
      const bright = ms.slice().sort(byImportance).slice(0, 7), ids = bright.map(m => m.id), seg = [];
      const inT = new Set([ids[0]]);   // a minimum spanning tree through the bright stars: the constellation's lines
      while (inT.size < ids.length) { let best = null; for (const u of inT) for (const v of ids) { if (inT.has(v)) continue; const d = Math.hypot(pos.get(u)[0] - pos.get(v)[0], pos.get(u)[1] - pos.get(v)[1]); if (!best || d < best[2]) best = [u, v, d]; } inT.add(best[1]); seg.push([best[0], best[1]]); }
      cons.push({ c: +c, ids, seg, X, Y });
    });
    nodes.forEach(n => { if (!pos.has(n.id)) { const h = hash(n.id); pos.set(n.id, [(h % 1600) - 800, ((h >>> 11) % 900) - 450]); } });
    return { pos, cons };
  }
  function drawSky(now) {
    const { R, litSet, font, k } = mapFrame(), S = mapCache.sky;
    // the sky turns slowly (a gentle sway rather than a full turn, so the constellations stay in frame)
    const th = reducedMotion() ? 0 : 0.12 * Math.sin(now / 45000), c0 = Math.cos(th), s0 = Math.sin(th);
    const scr = (x, y, R0) => proj(x * c0 - y * s0, x * s0 + y * c0, 0, R0);
    const g = ctx.createRadialGradient(W / 2, H * 1.2, 0, W / 2, H * 1.2, Math.max(W, H) * 1.3); g.addColorStop(0, "#1e2a5a"); g.addColorStop(0.5, "#0b1230"); g.addColorStop(1, "#02040d");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); if (!S) return;
    const o = scr(0, 0, R);   // alt-az style grid and a milky way band
    ctx.strokeStyle = "rgba(148,163,184,.08)"; ctx.lineWidth = 1; for (let r = 200; r <= 1000; r += 200) { ctx.beginPath(); ctx.ellipse(o.x, o.y, r * k, r * 0.6 * k, 0, 0, 2 * Math.PI); ctx.stroke(); }
    const mw = ctx.createLinearGradient(o.x - 600 * k, o.y - 400 * k, o.x + 600 * k, o.y + 400 * k); mw.addColorStop(0.35, "rgba(200,210,255,0)"); mw.addColorStop(0.5, "rgba(200,210,255,.06)"); mw.addColorStop(0.65, "rgba(200,210,255,0)");
    ctx.fillStyle = mw; ctx.fillRect(0, 0, W, H);
    const bright = new Set(S.cons.flatMap(c => c.ids));
    S.cons.forEach(c => { const lit = !litSet || c.ids.some(id => litSet.has(id)); ctx.globalAlpha = lit ? 1 : 0.25; ctx.strokeStyle = "rgba(165,180,252,.45)"; ctx.lineWidth = 1;
      c.seg.forEach(([a, b]) => { const p = scr(...S.pos.get(a), R), q = scr(...S.pos.get(b), R); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }); });
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      if (special(n) || n.ghost || !mapShown(n)) continue;
      const p = scr(n.x, n.y, R), b = bright.has(n.id), imp = importance(n), lit = !litSet || litSet.has(n.id);
      const tw = !reducedMotion() && n.recent > 0 ? 0.65 + 0.35 * Math.sin(now / 260 + hash(n.id) % 9) : 1, fading = staleFor(n, Q.stale_days);
      const r = b ? (1.8 + 4.5 * imp) * Math.max(0.7, Math.sqrt(k)) * tw : Math.max(0.8, 1.1 * Math.sqrt(k));
      const col = fading ? "#fca5a5" : n.recent > 0 ? "#fef3c7" : b ? "#e0e7ff" : "rgba(203,213,225,.55)";
      ctx.globalAlpha = lit ? 1 : 0.25;
      if (b) { const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.5); gl.addColorStop(0, col); gl.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gl; ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.5, 0, 2 * Math.PI); ctx.fill(); ctx.globalAlpha = lit ? 1 : 0.25; }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      if (b && n.recent > 0 && k > 0.5) { ctx.fillStyle = "#fde68a"; ctx.font = `700 9px ${font}`; ctx.textAlign = "center"; ctx.fillText("▲", p.x + r + 5, p.y - r - 2); }
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -imp, r: Math.max(5, r + 2), a: lit ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    const sz = S.life || (S.life = { shots: [], next: 0, seen: 0 }), sdt = tickOf(sz, now);
    if (sdt) {
      const fresh = liveEdits.filter(e => e.t > sz.seen && P.has(e.id)); fresh.forEach(e => sz.shots.push({ id: e.id, t: 0, a: 0.5 + Math.random() * 0.6 })); if (liveEdits.length) sz.seen = Math.max(sz.seen, ...liveEdits.map(e => e.t));
      sz.next -= sdt;
      if (sz.next <= 0) { const rec = nodes.filter(n => n.recent > 0 && P.has(n.id)); if (rec.length) sz.shots.push({ id: rec[Math.floor(Math.random() * rec.length)].id, t: 0, a: 0.3 + Math.random() * 0.9 }); sz.next = 2500 + Math.random() * 4500; }
    }
    sz.shots = sz.shots.filter(q => (q.t += sdt) < 1100);
    sz.shots.forEach(q => { const p0 = P.get(q.id); if (!p0) return; const f = q.t / 1100, L = 140, hx = p0.x + Math.cos(q.a) * L * f, hy = p0.y + Math.sin(q.a) * L * f;
      const gr = ctx.createLinearGradient(hx, hy, hx - Math.cos(q.a) * 50, hy - Math.sin(q.a) * 50); gr.addColorStop(0, `rgba(255,255,255,${1 - f})`); gr.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = gr; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(q.a) * 50, hy - Math.sin(q.a) * 50); ctx.stroke(); });
    S.cons.forEach(c => { const p = scr(c.X, c.Y, R), name = clip(clusterName(c.c), 26).toUpperCase(), f = `600 10px ${font}`, ly = p.y - 140 * k; ctx.font = f;
      const w = ctx.measureText(name).width + name.length * 1.5; if (freeSpot(p.x - w / 2, ly - 8, w, 14)) { ctx.fillStyle = "rgba(199,210,254,.75)"; ctx.textAlign = "center"; ctx.letterSpacing = "1.5px"; ctx.fillText(name, p.x, ly); ctx.letterSpacing = "0px"; } });
    noteLabels(S.cons.map(c => c.ids[0]), "#e0e7ff", "#02040d", 40);
    selRing(R, "#fde68a");
  }

  // Realm: the vault as a hand-drawn map. Each topic is a kingdom whose land is where its notes lie; maps (MOCs) are
  // castles, bridge notes are bridges, your most relied-on notes are mountains, stale ground is forest, and unlinked
  // notes drift in the far sea where the dragons are.
  function realmLayout(geo) {
    const pos = new Map(); geo.forEach((p, id) => pos.set(id, [p[0] * 1.2, p[1] * 1.2]));
    const land = nodes.filter(n => !special(n) && !n.ghost && !n.isolated);
    const [x0, y0, x1, y1] = bounds(land.map(n => pos.get(n.id)), 140), CELL = 12, gw = Math.ceil((x1 - x0) / CELL), gh = Math.ceil((y1 - y0) / CELL);
    const G = 60, grid = new Map(); land.forEach(n => { const [x, y] = pos.get(n.id), key = Math.floor(x / G) + "," + Math.floor(y / G); (grid.get(key) || grid.set(key, []).get(key)).push(n); });
    const own = new Int16Array(gw * gh).fill(-9);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const x = x0 + (i + 0.5) * CELL, y = y0 + (j + 0.5) * CELL, gx = Math.floor(x / G), gy = Math.floor(y / G); let best = null, bd = 64 * 64;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const n of grid.get((gx + a) + "," + (gy + b)) || []) { const [nx, ny] = pos.get(n.id), d = (nx - x) ** 2 + (ny - y) ** 2 + (hash(n.id + i) % 300); if (d < bd) { bd = d; best = n; } }
      own[j * gw + i] = best ? best.cluster : -9; }
    const off = document.createElement("canvas"); off.width = gw; off.height = gh; const oc = off.getContext("2d"), img = oc.createImageData(gw, gh);
    const PARCH = [239, 224, 189], SEA = [176, 196, 186], hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    for (let k2 = 0; k2 < own.length; k2++) { const c = own[k2], i = k2 % gw, j = Math.floor(k2 / gw), noise = ((hash("p" + k2) % 13) - 6);
      let col = c === -9 ? SEA.map(v => v + noise * 0.6) : hex(colorOf(c)).map((v, q) => PARCH[q] + (v - PARCH[q]) * 0.22 + noise);
      if (c !== -9) { const nb4 = [own[k2 - 1], own[k2 + 1], own[k2 - gw], own[k2 + gw]]; if (nb4.some(v => v === -9)) col = [120, 92, 60]; else if (nb4.some(v => v !== undefined && v !== c)) col = col.map(v => v * 0.72); }
      else if ((i + j) % 6 === 0) col = col.map(v => v - 14);   // sea hatching
      img.data.set([col[0], col[1], col[2], 255], k2 * 4); }
    oc.putImageData(img, 0, 0);
    const iso = nodes.filter(n => n.isolated && !special(n)), dragon = [x1 + 160, y0 + 120];
    iso.forEach(n => { const h = hash(n.id), a = (h % 628) / 100, r = 30 + (h >>> 9) % 140; pos.set(n.id, [dragon[0] + Math.cos(a) * r, dragon[1] + Math.sin(a) * r * 0.7]); });
    const kingdoms = topicCentres(new Map([...pos].filter(([id]) => byId[id] && !byId[id].isolated)), 3);
    return { pos, img: off, x0, y0, w: gw * CELL, h: gh * CELL, kingdoms, dragon };
  }
  function drawRealm(now) {
    const { dpr, R, litSet, k } = mapFrame(), M = mapCache.realm;
    ctx.fillStyle = "#b0c4ba"; ctx.fillRect(0, 0, W, H); if (!M) return;
    worldTransform(dpr, R); ctx.imageSmoothingEnabled = false; ctx.drawImage(M.img, M.x0, M.y0, M.w, M.h); ctx.imageSmoothingEnabled = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const serif = "Georgia, 'Times New Roman', serif", ink = "#3b2a17";
    for (const n of nodes) {   // landmarks
      if (n.ghost || n.person || !mapShown(n)) continue;
      const p = scr(n.x, n.y, R), lit = !litSet || litSet.has(n.id), s = Math.max(0.6, Math.sqrt(k)); ctx.globalAlpha = lit ? 1 : 0.3; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1.1;
      if (n.moc) { const w = 8 * s; ctx.fillStyle = "#e9dcc0"; ctx.fillRect(p.x - w, p.y - w, w * 2, w * 1.6); ctx.strokeRect(p.x - w, p.y - w, w * 2, w * 1.6);
        for (let i = 0; i < 3; i++) ctx.strokeRect(p.x - w + i * w * 0.8, p.y - w - 4 * s, w * 0.4, 4 * s); ctx.beginPath(); ctx.moveTo(p.x, p.y - w - 4 * s); ctx.lineTo(p.x, p.y - w - 12 * s); ctx.stroke();
        ctx.fillStyle = "#b91c1c"; ctx.fillRect(p.x, p.y - w - 12 * s, 6 * s, 4 * s); P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -3, r: w + 4, a: 1 }); continue; }
      if (n.isolated) { ctx.fillStyle = "rgba(59,42,23,.5)"; ctx.beginPath(); ctx.arc(p.x, p.y, 1.6 * s, 0, 2 * Math.PI); ctx.fill(); P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: 0, r: 5, a: 1 }); continue; }
      const imp = importance(n);
      if (n.bridge) { ctx.beginPath(); ctx.arc(p.x, p.y + 3 * s, 6 * s, Math.PI, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x - 7 * s, p.y - 3 * s); ctx.lineTo(p.x + 7 * s, p.y - 3 * s); ctx.stroke(); }
      else if (imp > 0.42) { const h = (7 + 10 * imp) * s; ctx.fillStyle = "#cdb48c"; ctx.beginPath(); ctx.moveTo(p.x - h * 0.7, p.y + h * 0.3); ctx.lineTo(p.x, p.y - h * 0.7); ctx.lineTo(p.x + h * 0.7, p.y + h * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x, p.y - h * 0.7); ctx.lineTo(p.x + h * 0.15, p.y - h * 0.1); ctx.stroke(); }
      else if (staleFor(n, Q.stale_days)) { ctx.fillStyle = "#4d6b3a"; ctx.beginPath(); ctx.arc(p.x, p.y - 2 * s, 3.2 * s, 0, 2 * Math.PI); ctx.fill(); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + 3 * s); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 * s, 0, 2 * Math.PI); ctx.fill(); }
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -imp, r: Math.max(5, (imp > 0.42 ? 10 : 4) * s), a: lit ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    Object.entries(M.kingdoms).sort((a, b) => b[1][2] - a[1][2]).forEach(([c, [x, y, n]]) => { const p = scr(x, y, R), name = clip(clusterName(+c), 26), size = Math.max(10, Math.min(18, (9 + Math.sqrt(n) * 1.3) * Math.sqrt(k)));
      const f = `italic 700 ${size}px ${serif}`; ctx.font = f; const w = ctx.measureText(name).width; if (freeSpot(p.x - w / 2, p.y - size, w, size * 1.4)) haloText(name, p.x, p.y - size * 0.3, "#4a2d14", "rgba(239,224,189,.75)", f, "center", 3); });
    // roads between kingdoms that link, with caravans: more caravans on busier roads
    if (!M.roads) { const K = M.kingdoms; M.roads = (DATA.pairs || []).filter(([a, b, l]) => l >= 2 && K[a] && K[b]).sort((x, y) => y[2] - x[2]).slice(0, 18).map(([a, b, l]) => ({ a: K[a], b: K[b], l })); }
    M.roads.forEach(rd => { const a = scr(rd.a[0], rd.a[1], R), b = scr(rd.b[0], rd.b[1], R), cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08, cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
      ctx.strokeStyle = "rgba(59,42,23,.45)"; ctx.lineWidth = 1.2; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(cx, cy, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      const n = Math.min(3, Math.ceil(rd.l / 4)), per = 16000 + (rd.l * 997) % 6000;
      for (let j = 0; j < n; j++) { const back = j % 2, t0 = ((reducedMotion() ? 0.4 : now / per) + j / n) % 1, t = back ? 1 - t0 : t0, u2 = 1 - t;
        const x = u2 * u2 * a.x + 2 * u2 * t * cx + t * t * b.x, y = u2 * u2 * a.y + 2 * u2 * t * cy + t * t * b.y, s = Math.max(0.8, Math.sqrt(k));
        ctx.fillStyle = "#7c4a1e"; ctx.fillRect(x - 3 * s, y - 2.5 * s, 6 * s, 3.5 * s); ctx.fillStyle = "#3b2a17"; ctx.beginPath(); ctx.arc(x - 2 * s, y + 1.4 * s, 1.1 * s, 0, 2 * Math.PI); ctx.arc(x + 2 * s, y + 1.4 * s, 1.1 * s, 0, 2 * Math.PI); ctx.fill(); } });
    for (let i = 0; i < 5; i++) {   // cloud shadows drifting east
      const x = (((reducedMotion() ? 0 : now) * 0.012 + i * 397) % (W + 500)) - 250, y = (hash("cloud" + i) % 1000) / 1000 * H;
      ctx.fillStyle = "rgba(40,30,20,.07)"; ctx.beginPath(); ctx.ellipse(x, y, 160, 60, 0.2, 0, 2 * Math.PI); ctx.ellipse(x + 80, y + 20, 110, 45, 0, 0, 2 * Math.PI); ctx.fill(); }
    const d = scr(...M.dragon, R); ctx.font = `italic 600 ${Math.max(10, 14 * Math.sqrt(k))}px ${serif}`; ctx.textAlign = "center"; ctx.fillStyle = "#5b3a1a";
    ctx.fillText("Here be dragons", d.x, d.y - 120 * k * 0.7); ctx.font = `${Math.max(14, 26 * Math.sqrt(k))}px ${serif}`; { const da = (reducedMotion() ? 0 : now) / 3200; ctx.fillText("🐉", d.x + Math.cos(da) * 90 * Math.max(0.5, k), d.y - 40 * k + Math.sin(da) * 45 * Math.max(0.5, k)); }   // circling over the unlinked notes
    if (k > 0.2) haloText("(notes linked to nothing)", d.x, d.y - 120 * k * 0.7 + 14, "#6b4a2a", "rgba(176,196,186,.8)", `italic 500 10px ${serif}`, "center");
    const cx = W - 60, cy = H - 70; ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1;   // compass rose
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 2 * Math.PI); ctx.stroke(); [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([ux, uy], i) => { ctx.beginPath(); ctx.moveTo(cx + ux * 34, cy + uy * 34); ctx.lineTo(cx - uy * 5, cy + ux * 5); ctx.lineTo(cx + uy * 5, cy - ux * 5); ctx.closePath(); i ? ctx.stroke() : ctx.fill(); });
    ctx.font = `700 11px ${serif}`; ctx.textAlign = "center"; ctx.fillText("N", cx, cy - 40);
    ctx.strokeStyle = "rgba(59,42,23,.6)"; ctx.lineWidth = 3; ctx.strokeRect(6, 6, W - 12, H - 12); ctx.lineWidth = 1; ctx.strokeRect(11, 11, W - 22, H - 22);   // border
    selRing(R, "#7f1d1d");
  }

  // Food web: which notes feed which. Notes others rely on but that link out little are producers (context, reference);
  // notes that mostly link out are consumers (logs, plans, task lists). Energy flows up the links. A relied-on note
  // that has gone stale is endangered: the notes above it feed on something that's out of date.
  function foodwebLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && !n.isolated), pos = new Map(geo), levels = [[], [], [], [], []];
    const lvl = VGRules.trophicLevels(ns);   // shared rule (vault_graph_rules.js): rank of out-share, low-degree notes kept off the ends
    ns.forEach(n => levels[lvl.get(n.id)].push(n));
    const order = topicOrder().map(c => c.id), ci = c => { const i = order.indexOf(c); return i < 0 ? 99 : i; };
    levels.forEach((ms, L) => { ms.sort((a, b) => ci(a.cluster) - ci(b.cluster) || importance(b) - importance(a));
      const rows = Math.max(1, Math.ceil(ms.length * 12 / 1800)), cols = Math.max(1, Math.ceil(ms.length / rows)), width = Math.min(1800, Math.max(600, cols * 14));
      ms.forEach((n, i) => { const row = i % rows, j = Math.floor(i / rows); pos.set(n.id, [-width / 2 + (j + 0.5) * width / cols, 420 - L * 210 + row * 24 - (rows - 1) * 12]); }); });
    const endangered = new Set(ns.filter(n => n.inlinks >= 4 && staleFor(n, Q.stale_days)).map(n => n.id));
    return { pos, levels: levels.map(l => l.length), endangered };
  }
  // Sparks climb the links from the notes relied on to the notes that use them, more often into busy notes. A spark
  // leaving a stale (endangered) note -- or one already tainted -- is grey, and taints what it reaches, so you can
  // watch out-of-date knowledge spread upward. Taint fades over a minute or so.
  const fw = { parts: [], taint: new Map(), edges: [], cum: [], tot: 0, map: null, last: 0 };
  function stepFoodweb(now, k, R) {
    const F = mapCache.foodweb;
    if (fw.map !== F || fw.links !== links.length) {
      fw.map = F; fw.links = links.length; fw.edges = []; fw.cum = []; fw.tot = 0;
      for (const l of links) { if (l.kind !== "link" || special(l.s) || special(l.t) || l.s.isolated || l.t.isolated) continue;
        const ys = F.pos.get(l.s.id)[1], yt = F.pos.get(l.t.id)[1], [lo, hi] = ys > yt ? [l.s, l.t] : [l.t, l.s];   // the layout's levels, not mid-morph spots
        if (Math.abs(ys - yt) < 60) continue;   // same level: nothing climbs
        fw.tot += 0.15 + activity(hi); fw.edges.push([lo, hi]); fw.cum.push(fw.tot); }
    }
    const dt = Math.min(100, now - (fw.last || now)); fw.last = now;
    if (!reducedMotion() && fw.edges.length) for (let i = 0; i < Math.min(6, dt / 16 * 2.2) && fw.parts.length < 260; i++) {
      const r = Math.random() * fw.tot; let a = 0, b = fw.cum.length - 1; while (a < b) { const m = (a + b) >> 1; if (fw.cum[m] < r) a = m + 1; else b = m; }
      const [lo, hi] = fw.edges[a]; if (!visible(lo) || !visible(hi)) continue;
      fw.parts.push({ a: lo, b: hi, t: 0, grey: F.endangered.has(lo.id) || (fw.taint.get(lo.id) || 0) > 0.3, sp: 0.0007 + Math.random() * 0.0006 });
    }
    fw.taint.forEach((v, id) => { const nv = v * Math.pow(0.9996, dt); if (nv < 0.03) fw.taint.delete(id); else fw.taint.set(id, nv); });
    ctx.globalCompositeOperation = "lighter";
    for (let i = fw.parts.length - 1; i >= 0; i--) {
      const q = fw.parts[i]; q.t += q.sp * dt;
      if (q.t >= 1) { if (q.grey) fw.taint.set(q.b.id, Math.min(1, (fw.taint.get(q.b.id) || 0) + 0.35)); fw.parts.splice(i, 1); continue; }
      const A = scr(q.a.x, q.a.y, R), B = scr(q.b.x, q.b.y, R), my = (A.y + B.y) / 2, u = 1 - q.t, t = q.t;   // the same curve the link is drawn with
      const x = u * u * u * A.x + 3 * u * u * t * A.x + 3 * u * t * t * B.x + t * t * t * B.x, y = u * u * u * A.y + 3 * u * u * t * my + 3 * u * t * t * my + t * t * t * B.y;
      ctx.fillStyle = q.grey ? "rgba(148,163,184,.8)" : "rgba(253,224,71,.85)"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, 1.7 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    fw.taint.forEach((v, id) => { const q = P.get(id); if (!q) return; ctx.strokeStyle = `rgba(148,163,184,${0.2 + 0.55 * v})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q.x, q.y, q.r + 1.5, 0, 2 * Math.PI); ctx.stroke(); });
  }
  function drawFoodweb(now) {
    const { R, litSet, font, k } = mapFrame(), F = mapCache.foodweb;
    backdrop("#14231b", "#22331c"); if (!F) return;
    const NAMES = ["Producers · relied on, link out little", "Primary consumers", "Mixed", "Secondary consumers", "Apex · logs, plans, task lists"];
    NAMES.forEach((nm, L) => { const p = scr(0, 420 - L * 210, R); ctx.fillStyle = "rgba(255,255,255,.03)"; ctx.fillRect(0, p.y - 95 * k, W, 190 * k);
      const t = `${nm} (${F.levels[L]})`, f = `700 10.5px ${font}`, y = p.y - 80 * k;
      ctx.font = f; freeSpot(14, y - 8, ctx.measureText(t).width + 6, 16);   // reserved, so note labels steer around the level's name
      haloText(t, 14, y, "rgba(220,252,231,.75)", "#14231b", f); });
    ctx.lineWidth = 0.7;
    for (const l of visLinks) { if (l.kind !== "link" || special(l.s) || special(l.t) || l.s.isolated || l.t.isolated) continue;
      const [lo, hi] = l.s.y > l.t.y ? [l.s, l.t] : [l.t, l.s], a = scr(lo.x, lo.y, R), b = scr(hi.x, hi.y, R), on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      ctx.strokeStyle = on && litSet ? "rgba(253,224,71,.7)" : "rgba(187,247,208,.07)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y); ctx.stroke(); }
    dots(n => !special(n) && !n.ghost && !n.isolated, n => F.endangered.has(n.id) ? "#f87171" : colorOf(n.cluster), n => Math.max(1.8, (1.8 + 4 * importance(n)) * Math.sqrt(k)), R);
    stepFoodweb(now, k, R);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) {   // what depends on this note
      const q = P.get(st.selected), d = dependents(st.selected).size, t = d ? `${d} note${d > 1 ? "s" : ""} depend on this` : "nothing above depends on this";
      haloText(t, q.x, q.y - q.r - 12, "#fde68a", "#14231b", `700 11px ${font}`, "center");
    }
    F.endangered.forEach(id => { const p = P.get(id); if (!p) return; ctx.strokeStyle = `rgba(248,113,113,${0.5 + 0.4 * Math.sin(now / 400)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, 2 * Math.PI); ctx.stroke(); });
    noteLabels([...F.endangered, ...nodes.filter(n => !special(n) && !n.isolated && P.has(n.id)).sort(byImportance).map(n => n.id)], "#ecfdf5", "#14231b", k > 1.3 ? 90 : 24);
    selRing(R);
  }

  // Reactions: pairs of notes that want joining, one set for every view that shows them (Alchemy, Periodic table).
  // Bond: similar meaning or talked about together, never linked. Fusion: near-duplicates, maybe one note. Transmutation:
  // a topic's gold note (goldOf picks it from the topic's notes) and an unconnected note beside it. Strongest first.
  const REACTIONS = { bond: ["Bond", "#22d3ee", "similar meaning, never linked"], fusion: ["Fusion", "#c084fc", "near-duplicates, maybe one note"],
    transmute: ["Transmutation", "#fbbf24", "a gold note can lift an unconnected one"] };
  function reactionsAmong(keep, goldOf = mem => mem.slice().sort(byImportance)[0]) {
    const rx = [], topics = new Map();
    links.forEach(l => { if (VGRules.isSuggestion(l) && keep.has(l.s.id) && keep.has(l.t.id) && !nb[l.s.id].has(l.t.id))
      rx.push({ type: "bond", a: l.s, b: l.t, why: l.why || (l.kind === "similar" ? "similar meaning" : "talked about together") }); });
    (DATA.near_dupes || []).forEach(([a, b, sim]) => { if (keep.has(a) && keep.has(b)) rx.push({ type: "fusion", a: byId[a], b: byId[b], why: `${Math.round(sim * 100)}% alike` }); });
    keep.forEach(id => { const n = byId[id]; if (n && n.cluster >= 0) (topics.get(n.cluster) || topics.set(n.cluster, []).get(n.cluster)).push(n); });
    topics.forEach(mem => { const gold = goldOf(mem); if (!gold) return;
      mem.filter(n => n.isolated && (n.words || 0) >= Q.stub_words && !nb[gold.id].has(n.id)).sort((a, b) => b.words - a.words).slice(0, 3)
        .forEach(n => rx.push({ type: "transmute", a: gold, b: n, why: `${n.name} links to nothing; ${gold.name} is the topic's gold` })); });
    return rx.sort((x, y) => importance(y.a) + importance(y.b) - importance(x.a) - importance(x.b));
  }
  // run one: link the pair (Bond, Transmutation) or open both to merge by hand (Fusion). hooks.skip on Cancel,
  // hooks.done(colour) once it's run, for a view's own score and effects.
  async function runReaction(x, hooks = {}) {
    const [nm, col] = REACTIONS[x.type], fusion = x.type === "fusion";
    const body = fusion ? `<b>${esc(x.a.name)}</b> and <b>${esc(x.b.name)}</b> look like the same note (${esc(x.why)}). This opens both so you can merge them by hand; nothing is merged for you.`
      : `Link <b>${esc(x.a.name)}</b> ↔ <b>${esc(x.b.name)}</b>? ${esc(x.why)}. A Related link goes into the staler note.`;
    if (!await confirmBox(`${nm} reaction`, body + (hooks.skip ? " Cancel to see the next reaction." : ""), fusion ? "Open both" : "Link them")) { if (hooks.skip) hooks.skip(); renderToday(); return; }
    if (fusion) { if (!opts.openNote) return; opts.openNote(x.a.id, false); opts.openNote(x.b.id, true); }
    else { if (!opts.linkNotes) { toast("Linking runs in the plugin", "warn"); return; }
      await actOnSuggestion("link", x.a.id, x.b.id, document.createElement("button"), x.type === "transmute" ? "transmutation: the topic's most relied-on note" : null);
      if (!nb[x.a.id].has(x.b.id)) return; }   // the link failed; actOnSuggestion already said so
    x.done = true; if (hooks.done) hooks.done(col); renderToday();
  }

  // Alchemy: each topic is a flask; its notes sit in rings by stage of the Great Work, raw lead (nigredo) outside and
  // relied-on gold (rubedo) at the centre. Sparks run along the waiting reactions (the shared set above, gold = the
  // flask's rubedo); the Today bar runs them one at a time and keeps score.
  const AL_STAGES = [["Nigredo", "#78716c"], ["Albedo", "#e7e5e4"], ["Citrinitas", "#facc15"], ["Rubedo", "#f97316"]];
  const alStage = n => n.isolated || (n.words || 0) < Q.stub_words ? 0 : (n.inlinks || 0) < 2 ? 1 : importance(n) >= 0.35 && !staleFor(n, Q.stale_days) ? 3 : 2;
  // reactions run: in the shared game state with XP (per vault, every device). Before that it was this browser's
  // own count, carried over once (then removed, so a second vault doesn't take it too).
  const alScore = { get() { if (typeof cos.alchemyRuns !== "number") { let old = 0; try { old = +localStorage.getItem("vg-alchemy-runs") || 0; localStorage.removeItem("vg-alchemy-runs"); } catch (e) { }
      cos.alchemyRuns = old; } return cos.alchemyRuns; },
    add() { cos.alchemyRuns = this.get() + 1; persistSoon(); } };
  const al = { sparks: [], flash: [], idx: 0, spawn: 0, last: 0 };
  const alPartners = id => (mapCache.alchemy ? mapCache.alchemy.rx : []).filter(x => !x.done && (x.a.id === id || x.b.id === id)).map(x => x.a.id === id ? x.b.id : x.a.id);
  function alchemyLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && n.cluster >= 0), pos = new Map(geo), used = new Set(), keep = new Set(ns.map(n => n.id));
    const symbol = name => { const w = name.replace(/[^A-Za-z]/g, "") || "X", c = [...w.slice(1).toLowerCase()].map(ch => w[0].toUpperCase() + ch);
      const s = c.find(x => !used.has(x)) || w[0].toUpperCase() + used.size; used.add(s); return s; };
    const cs = topicOrder().map(c => ({ c, mem: ns.filter(n => n.cluster === c.id) })).filter(f => f.mem.length);
    cs.forEach(f => f.r = 36 + 11 * Math.sqrt(f.mem.length));
    const ring = Math.max(300, cs.reduce((t, f) => t + 2 * f.r + 40, 0) / (2 * Math.PI));
    let ang = -Math.PI / 2;
    const flasks = cs.map(f => { ang += (f.r + 20) / ring; const x = ring * Math.cos(ang), y = ring * Math.sin(ang); ang += (f.r + 20) / ring;
      [0, 1, 2, 3].forEach(s => { const ms = f.mem.filter(n => alStage(n) === s), rr = f.r * [0.84, 0.6, 0.36, 0.13][s];
        ms.forEach((n, j) => { const a = s + 2 * Math.PI * j / ms.length; pos.set(n.id, [x + rr * Math.cos(a), y + rr * Math.sin(a)]); }); });
      return { c: f.c, x, y, r: f.r, sym: symbol(clusterName(f.c.id)), n: f.mem.length }; });
    const rx = reactionsAmong(keep, mem => mem.filter(n => alStage(n) === 3).sort(byImportance)[0]);
    return { pos, flasks, rx, gold: ns.filter(n => alStage(n) === 3).length, total: ns.length };
  }
  // the alchemy's own bookkeeping around a shared reaction: skip moves to the next, a run scores and flashes
  const alRun = x => runReaction(x, { skip: () => al.idx++,
    done: col => { alScore.add(); [x.a, x.b].forEach(n => al.flash.push({ n, t: 0, col })); toast(`${REACTIONS[x.type][0]} complete · ${plural(alScore.get(), "reaction")} run`, "ok"); } });
  function drawAlchemy(now) {
    const { R, litSet, font, k } = mapFrame(), A = mapCache.alchemy;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7); g.addColorStop(0, "#1f1a33"); g.addColorStop(1, "#0b0a12");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); if (!A) return;
    A.flasks.forEach(f => { const p = scr(f.x, f.y, R), r = f.r * k, col = colorOf(f.c.id), on = !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === f.c.id);
      ctx.globalAlpha = on ? 0.1 : 0.03; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = on ? 0.6 : 0.15; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      if (on) haloText(`${f.sym} · ${clip(clusterName(f.c.id), 26)} (${f.n})`, p.x, p.y - r - 9, "#ede9fe", "#0b0a12", `700 10.5px ${font}`, "center"); });
    ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
    A.rx.forEach(x => { if (x.done || !mapShown(x.a) || !mapShown(x.b)) return; const a = scr(x.a.x, x.a.y, R), b = scr(x.b.x, x.b.y, R), on = litSet && litSet.has(x.a.id) && litSet.has(x.b.id);
      ctx.strokeStyle = REACTIONS[x.type][1]; ctx.globalAlpha = on ? 0.9 : litSet ? 0.04 : 0.18; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    dots(n => !special(n) && !n.ghost && n.cluster >= 0, n => litSet && !litSet.has(n.id) ? "rgba(120,113,108,.25)" : AL_STAGES[alStage(n)][1],
      n => Math.max(1.8, (1.8 + 3.5 * importance(n)) * Math.sqrt(k)), R);
    nodes.forEach(n => { if (special(n) || n.ghost || alStage(n) !== 3) return; const p = P.get(n.id); if (!p) return;   // gold glows
      ctx.strokeStyle = `rgba(251,191,36,${0.35 + 0.3 * Math.sin(now / 500 + n.x)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 2.5, 0, 2 * Math.PI); ctx.stroke(); });
    const dt = tickOf(al, now), open = A.rx.filter(x => !x.done && mapShown(x.a) && mapShown(x.b));
    if (dt && open.length && now - al.spawn > 650 && al.sparks.length < 12) { al.spawn = now; al.sparks.push({ x: open[Math.floor(Math.random() * open.length)], t: 0 }); }
    ctx.globalCompositeOperation = "lighter";
    for (let i = al.sparks.length - 1; i >= 0; i--) { const s = al.sparks[i]; s.t += dt / 1300;
      if (s.t >= 1 || s.x.done) { if (!s.x.done) al.flash.push({ n: s.x.b, t: 0, col: REACTIONS[s.x.type][1] }); al.sparks.splice(i, 1); continue; }
      const a = scr(s.x.a.x, s.x.a.y, R), b = scr(s.x.b.x, s.x.b.y, R);
      ctx.fillStyle = REACTIONS[s.x.type][1]; ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * s.t, a.y + (b.y - a.y) * s.t, Math.max(1.6, 2.2 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
    for (let i = al.flash.length - 1; i >= 0; i--) { const f = al.flash[i]; f.t += (dt || 16) / 700; if (f.t >= 1) { al.flash.splice(i, 1); continue; }
      const p = scr(f.n.x, f.n.y, R); ctx.strokeStyle = f.col; ctx.globalAlpha = 1 - f.t; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 4 + 16 * f.t, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    setSceneStat(`⚗ ${plural(alScore.get(), "reaction")} run · ${open.length} waiting · gold ${A.gold}/${A.total}`);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) { const q = P.get(st.selected), m = alPartners(st.selected).length;
      haloText(`${AL_STAGES[alStage(byId[st.selected])][0]} · ${m ? plural(m, "possible reaction") : "nothing to react with"}`, q.x, q.y - q.r - 12, "#fde68a", "#0b0a12", `700 11px ${font}`, "center"); }
    noteLabels(nodes.filter(n => !special(n) && !n.ghost && P.has(n.id) && (alStage(n) === 3 || alPartners(n.id).length)).sort(byImportance).map(n => n.id), "#f5f3ff", "#0b0a12", k > 1.3 ? 80 : 20);
    selRing(R, "#fbbf24");
  }

  // Lineage: where each note came from. Time runs left to right by birth order (so a busy month doesn't crush a quiet
  // one) and each topic is a lane. A note's parent is a note it links with that already existed -- its own topic
  // first, then the most relied-on. Orange curves are ideas that crossed into another topic. Click a note for its
  // ancestry and everything that grew from it.
  function lineageLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost), dated = ns.filter(n => n.born).sort((a, b) => a.born.localeCompare(b.born) || a.id.localeCompare(b.id));
    const rank = new Map(dated.map((n, i) => [n.id, i])), Wd = Math.max(1600, dated.length * 3.2), xOf = i => -Wd / 2 + Wd * i / Math.max(1, dated.length - 1);
    const laneOf = n => (n.cluster >= 0 && clusterById[n.cluster] ? n.cluster : -1);
    const lanes = topicOrder().map(c => c.id).concat([-1]).filter(c => ns.some(n => laneOf(n) === c));
    const laneY = {}; let y = 0;
    lanes.forEach(c => { const h = 60 + 9 * Math.sqrt(ns.filter(n => laneOf(n) === c).length); laneY[c] = [y, h]; y += h + 14; });
    const pos = new Map(geo), parent = new Map(), kids = new Map(), desc = new Map();
    dated.forEach(n => { let best = null, bv = -1;
      (nb[n.id] || []).forEach(id => { const m = byId[id]; if (!m || special(m) || !rank.has(id) || rank.get(id) >= rank.get(n.id)) return;
        const v = importance(m) + (m.cluster === n.cluster ? 1 : 0); if (v > bv) { bv = v; best = m; } });
      if (best) { parent.set(n.id, best.id); if (!kids.has(best.id)) kids.set(best.id, []); kids.get(best.id).push(n.id); } });
    for (let i = dated.length - 1; i >= 0; i--) { const id = dated[i].id; desc.set(id, (kids.get(id) || []).reduce((s, c) => s + 1 + (desc.get(c) || 0), 0)); }   // children are always born later
    lanes.forEach(c => { const ms = dated.filter(n => laneOf(n) === c), [ly, lh] = laneY[c], rows = Math.max(2, Math.round(lh / 13));
      ms.forEach((n, i) => pos.set(n.id, [xOf(rank.get(n.id)), ly + (i % rows + 0.5) * lh / rows])); });
    ns.filter(n => !n.born).forEach((n, i) => { const [ly, lh] = laneY[laneOf(n)] || [y, 40]; pos.set(n.id, [-Wd / 2 - 120, ly + (i % 6 + 0.5) * lh / 6]); });   // undated: a column of their own
    const ticks = []; let last = "";
    dated.forEach((n, i) => { const m = n.born.slice(0, 7); if (m !== last) { last = m; ticks.push([xOf(i), m]); } });
    return { pos, parent, kids, desc, laneY, lanes, ticks };
  }
  const lineageOf = id => { const L = mapCache.lineage, out = new Set(); if (!L) return out;
    for (let p = L.parent.get(id); p && !out.has(p); p = L.parent.get(p)) out.add(p);
    const q = [id]; while (q.length) (L.kids.get(q.pop()) || []).forEach(c => { if (!out.has(c)) { out.add(c); q.push(c); } });
    return out; };
  function drawLineage(now) {
    const { R, litSet, font, k } = mapFrame(), L = mapCache.lineage;
    ctx.fillStyle = "#0f131b"; ctx.fillRect(0, 0, W, H); if (!L) return;
    L.lanes.forEach((c, i) => { const [ly, lh] = L.laneY[c], a = scr(0, ly, R).y, b = scr(0, ly + lh, R).y;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,.022)" : "rgba(255,255,255,.045)"; ctx.fillRect(0, a, W, b - a);
      if (b - a > 12) haloText(c < 0 ? "Unclustered" : clip(clusterName(c), 30), 12, a + 9, c < 0 ? "#94a3b8" : colorOf(c), "#0f131b", `700 10px ${font}`); });
    let lastX = -1e9;
    L.ticks.forEach(([x, m]) => { const p = scr(x, 0, R); if (p.x < -50 || p.x > W + 50) return; const yr = m.endsWith("-01");
      ctx.strokeStyle = yr ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.05)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
      if (p.x - lastX > 58) { const first = lastX < -1e8; lastX = p.x;   // the first label and every January carry the year
        haloText(yr ? m.slice(0, 4) : new Date(m + "-15T12:00").toLocaleDateString(undefined, { month: "short" }) + (first ? ` ’${m.slice(2, 4)}` : ""), p.x + 3, H - 14, yr ? "#e2e8f0" : "#94a3b8", "#0f131b", `${yr ? 700 : 500} 10px ${font}`); } });
    ctx.lineWidth = 1;
    L.parent.forEach((pid, id) => { const n = byId[id], p = byId[pid]; if (!mapShown(n) || !mapShown(p)) return;
      const a = scr(p.x, p.y, R), b = scr(n.x, n.y, R), on = litSet && litSet.has(id) && litSet.has(pid), cross = n.cluster !== p.cluster, mx = (a.x + b.x) / 2;
      ctx.globalAlpha = on ? 0.9 : litSet ? 0.05 : cross ? 0.35 : 0.22; ctx.strokeStyle = on ? "#fde047" : cross ? "#fb923c" : colorOf(n.cluster);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y); ctx.stroke(); });
    ctx.globalAlpha = 1;
    dots(n => !special(n) && !n.ghost, n => litSet && !litSet.has(n.id) ? "rgba(100,116,139,.3)" : colorOf(n.cluster), n => Math.max(1.6, (1.6 + 1.3 * Math.log1p(L.desc.get(n.id) || 0)) * Math.sqrt(k)), R);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) { const q = P.get(st.selected), n = byId[st.selected], pid = L.parent.get(n.id);
      haloText(`${n.born ? "born " + n.born : "undated"}${pid ? " · grew from " + clip(byId[pid].name, 28) : " · a root"} · ${plural(L.desc.get(n.id) || 0, "descendant")}`, q.x, q.y - q.r - 12, "#fde68a", "#0f131b", `700 11px ${font}`, "center"); }
    noteLabels(nodes.filter(n => P.has(n.id) && !special(n)).sort((a, b) => (L.desc.get(b.id) || 0) - (L.desc.get(a.id) || 0)).map(n => n.id), "#e2e8f0", "#0f131b", k > 1.3 ? 70 : 18);
    selRing(R);
  }

  // Click depth: how many link-clicks each note is from your maps (or from a note you centre on), following links
  // the way you would in Obsidian. Rings are clicks; each note fans out under the note that first reaches it. The
  // red outer belt is what no link reaches -- only search finds those. Information architects call this click depth.
  function ripplesLayout(geo) {
    const pos = new Map(geo), keep = n => n && !n.person && !n.ghost, out = {};
    links.forEach(l => { if ((l.kind === "link" || l.kind === "moc") && keep(l.s) && keep(l.t)) (out[l.s.id] = out[l.s.id] || []).push(l.t.id); });
    const rootId = st.rippleRoot && byId[st.rippleRoot] ? st.rippleRoot : null;
    const starts = rootId ? [rootId] : nodes.filter(n => n.moc && keep(n)).map(n => n.id);
    const depth = new Map(), parent = new Map(), kids = new Map([["", starts.slice()]]);
    starts.forEach(id => { depth.set(id, rootId ? 0 : 1); parent.set(id, ""); });
    for (const q = starts.slice(); q.length;) { const x = q.shift();
      (out[x] || []).forEach(y => { if (depth.has(y)) return; depth.set(y, depth.get(x) + 1); parent.set(y, x); if (!kids.has(x)) kids.set(x, []); kids.get(x).push(y); q.push(y); }); }
    const RING = 150, leaves = new Map();
    const leafCount = id => { if (!leaves.has(id)) { const ks = kids.get(id) || []; leaves.set(id, ks.length ? ks.reduce((s, c) => s + leafCount(c), 0) : 1); } return leaves.get(id); };
    const place = (id, a0, a1) => { if (id) { const d = depth.get(id), a = (a0 + a1) / 2; pos.set(id, [d * RING * Math.cos(a), d * RING * Math.sin(a)]); }
      let a = a0; (kids.get(id) || []).slice().sort((x, y) => layoutSeed() ? topicRank(byId[x].cluster) - topicRank(byId[y].cluster) : byId[x].cluster - byId[y].cluster).forEach(c => { const span = (a1 - a0) * leafCount(c) / leafCount(id); place(c, a, a + span); a += span; }); };
    place("", -Math.PI / 2, 1.5 * Math.PI);
    const maxD = Math.max(1, ...depth.values()), beltR = (maxD + 1.4) * RING;
    const lost = nodes.filter(n => keep(n) && !n.moc && !depth.has(n.id))
      .sort((a, b) => (layoutSeed() ? topicRank(a.cluster) - topicRank(b.cluster) : a.cluster - b.cluster) || importance(b) - importance(a));   // the belt follows the seed too
    lost.forEach((n, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(1, lost.length), r = beltR + (i % 3) * 22; pos.set(n.id, [r * Math.cos(a), r * Math.sin(a)]); });
    return { pos, depth, parent, maxD, lost, lostSet: new Set(lost.map(n => n.id)), beltR, RING, rootId };
  }
  const ripplePath = id => { const Rp = mapCache.ripples, s = new Set([id]); if (Rp) for (let p = Rp.parent.get(id); p; p = Rp.parent.get(p)) s.add(p); return s; };
  function drawRipples(now) {
    const { R, litSet, font, k } = mapFrame(), Rp = mapCache.ripples;
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, W, H); if (!Rp) return;
    const c = scr(0, 0, R), rootN = Rp.rootId && byId[Rp.rootId];
    for (let d = 1; d <= Rp.maxD; d++) { const r = d * Rp.RING * k; ctx.strokeStyle = "rgba(148,197,255,.12)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, 2 * Math.PI); ctx.stroke();
      haloText(plural(d, "click"), c.x + 4, c.y - r - 6, "rgba(186,214,255,.75)", "#0b1220", `600 10px ${font}`); }
    const br = Rp.beltR * k;
    if (Rp.lost.length) { ctx.setLineDash([4, 6]); ctx.strokeStyle = "rgba(248,113,113,.35)"; ctx.beginPath(); ctx.arc(c.x, c.y, br - 14 * k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      haloText(`No link reaches these ${Rp.lost.length} · only search finds them`, c.x, c.y - br - 34 * k, "#fca5a5", "#0b1220", `700 10.5px ${font}`, "center"); }
    if (!reducedMotion()) { const t = (now % 4200) / 4200; ctx.strokeStyle = `rgba(147,197,253,${0.35 * (1 - t)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.x, c.y, t * (Rp.maxD + 0.5) * Rp.RING * k, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.lineWidth = 0.8;
    Rp.parent.forEach((pid, id) => { const n = byId[id]; if (!mapShown(n)) return;
      const a = pid ? scr(byId[pid].x, byId[pid].y, R) : c, b = scr(n.x, n.y, R), on = litSet && litSet.has(id) && (!pid || litSet.has(pid));
      if (!pid && rootN) return;
      ctx.globalAlpha = on ? 0.9 : litSet ? 0.05 : pid ? 0.25 : 0.4; ctx.strokeStyle = on ? "#fde047" : pid ? colorOf(n.cluster) : "#93c5fd";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); });
    ctx.globalAlpha = 1;
    if (!rootN) { ctx.fillStyle = "#93c5fd"; ctx.beginPath(); ctx.arc(c.x, c.y, 7, 0, 2 * Math.PI); ctx.fill(); haloText("Your maps", c.x, c.y + 18, "#dbeafe", "#0b1220", `700 11px ${font}`, "center"); }
    dots(n => !n.person && !n.ghost && (Rp.depth.has(n.id) || Rp.lostSet.has(n.id)),
      n => litSet && !litSet.has(n.id) ? "rgba(100,116,139,.3)" : Rp.lostSet.has(n.id) ? "#f87171" : n.moc ? "#93c5fd" : colorOf(n.cluster),
      n => Math.max(1.8, (n.moc || n.id === Rp.rootId ? 6 : 1.8 + 3 * importance(n)) * Math.sqrt(k)), R);
    if (st.selected && P.has(st.selected)) { const q = P.get(st.selected), d = Rp.depth.get(st.selected), chain = [];
      for (let p = st.selected; p; p = Rp.parent.get(p)) chain.unshift(byId[p].name);
      haloText(d == null ? "No link path reaches this note" : `${plural(d, "click")}: ${clip((rootN ? "" : "Maps › ") + chain.join(" › "), 90)}`, q.x, q.y - q.r - 12, "#fde68a", "#0b1220", `700 11px ${font}`, "center"); }
    noteLabels([...(rootN ? [rootN.id] : []), ...nodes.filter(n => n.moc && P.has(n.id)).map(n => n.id), ...Rp.lost.slice().sort(byImportance).map(n => n.id)], "#e2e8f0", "#0b1220", k > 1.3 ? 60 : 16);
    selRing(R);
  }

  // Heat clock: when you work on what. Two dials: days of the week and months of the year. Each ring is a topic
  // (busiest outside); a cell's heat is that topic's share of its daily-note mentions on that day or in that month.
  function clockLayout(geo) {
    const rh = DATA.rhythm || {}, cs = Object.entries(rh).map(([c, v]) => ({ c: +c, ...v, tot: v.wd.reduce((a, b) => a + b, 0) })).filter(x => x.tot >= 3 && clusterById[x.c]).sort((a, b) => a.tot - b.tot).slice(-12);
    const pos = new Map(geo), DIAL = [[-330, 0, "wd", 7], [330, 0, "mo", 12]];
    const ring = i => 70 + i * 20;
    // a topic's notes sit in its ring at its busiest weekday (half of them) and busiest month (the other half)
    cs.forEach((x, i) => { const ms = nodes.filter(n => n.cluster === x.c && !special(n) && !n.ghost);
      ms.forEach((n, j) => { const [dx, dy, key, N] = DIAL[j % 2], pk = x[key].indexOf(Math.max(...x[key])), a = (pk + 0.15 + 0.7 * ((seededHash(n.id) % 100) / 100)) / N * 2 * Math.PI - Math.PI / 2;
        pos.set(n.id, [dx + Math.cos(a) * (ring(i) + 9), dy + Math.sin(a) * (ring(i) + 9)]); }); });
    // notes of other topics aren't drawn here; parked on the dials' outer edges and the list below, they make "fit" frame the whole clock
    const rOut = ring(cs.length) + 30, edge = [[-330 - rOut, 0], [330 + rOut, 0], [-330, -rOut], [330, -rOut], [0, rOut + 30 + cs.length * 8]], inCs = new Set(cs.map(x => x.c));
    nodes.filter(n => !special(n) && !n.ghost && !inCs.has(n.cluster)).forEach((n, i) => pos.set(n.id, edge[i % edge.length]));
    return { pos, cs, DIAL, ring, rOut };
  }
  let clockSpots = [];
  function drawClock(now) {
    const { R, litSet, font, k } = mapFrame(), C = mapCache.clock; clockSpots = [];
    ctx.fillStyle = "#101418"; ctx.fillRect(0, 0, W, H); if (!C) return;
    const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    C.DIAL.forEach(([dx, dy, key, N]) => {
      const o = scr(dx, dy, R);
      C.cs.forEach((x, i) => { const v = x[key], mx = Math.max(1, ...v), r0 = (C.ring(i)) * k, r1 = (C.ring(i) + 18) * k, lit = !litSet || nodes.some(n => n.cluster === x.c && litSet.has(n.id));
        for (let s = 0; s < N; s++) { const a0 = s / N * 2 * Math.PI - Math.PI / 2, a1 = (s + 1) / N * 2 * Math.PI - Math.PI / 2, t = v[s] / mx;
          ctx.globalAlpha = lit ? 1 : 0.25; ctx.fillStyle = t ? hexMix("#1f2933", colorOf(x.c), 0.15 + 0.85 * t) : "#1a2027";
          ctx.beginPath(); ctx.arc(o.x, o.y, r1, a0 + 0.012, a1 - 0.012); ctx.arc(o.x, o.y, r0, a1 - 0.012, a0 + 0.012, true); ctx.closePath(); ctx.fill(); } });
      ctx.globalAlpha = 1;
      const rOut = (C.ring(C.cs.length) + 14) * k, labels = key === "wd" ? WD : MO;
      labels.forEach((l, s) => { const a = (s + 0.5) / N * 2 * Math.PI - Math.PI / 2; haloText(l, o.x + Math.cos(a) * rOut, o.y + Math.sin(a) * rOut, "#e2e8f0", "#101418", `700 ${Math.max(9, 11 * Math.sqrt(k))}px ${font}`, "center"); });
      const totals = new Array(N).fill(0); C.cs.forEach(x => x[key].forEach((v, s) => totals[s] += v)); const pk = totals.indexOf(Math.max(...totals));
      haloText(key === "wd" ? "WEEK" : "YEAR", o.x, o.y - 10, "#94a3b8", "#101418", `700 10px ${font}`, "center");
      haloText(`busiest: ${labels[pk]}`, o.x, o.y + 8, "#f8fafc", "#101418", `600 ${Math.max(10, 12 * Math.sqrt(k))}px ${font}`, "center");
    });
    // hands at right now; today's slice glows; a note edited while you watch sends a spark into its topic's ring
    const d = new Date(), wd = (d.getDay() + 6) % 7, dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const frac = { wd: (wd + (d.getHours() + d.getMinutes() / 60) / 24) / 7, mo: (d.getMonth() + (d.getDate() - 1 + d.getHours() / 24) / dim) / 12 }, slot = { wd, mo: d.getMonth() };
    const pulse = reducedMotion() ? 0.6 : 0.45 + 0.3 * Math.sin(now / 700);
    C.DIAL.forEach(([dx, dy, key, N]) => {
      const o = scr(dx, dy, R), r0 = (C.ring(0) - 4) * k, r1 = (C.ring(C.cs.length) + 2) * k, a = frac[key] * 2 * Math.PI - Math.PI / 2;
      const s0 = slot[key] / N * 2 * Math.PI - Math.PI / 2, s1 = (slot[key] + 1) / N * 2 * Math.PI - Math.PI / 2;
      ctx.fillStyle = `rgba(253,224,71,${0.07 * pulse})`; ctx.beginPath(); ctx.arc(o.x, o.y, r1, s0, s1); ctx.arc(o.x, o.y, r0, s1, s0, true); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(253,224,71,${pulse})`; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = "rgba(253,224,71,.25)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(o.x + Math.cos(a) * r0, o.y + Math.sin(a) * r0); ctx.lineTo(o.x + Math.cos(a) * r1, o.y + Math.sin(a) * r1); ctx.stroke();
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fde047"; ctx.beginPath(); ctx.arc(o.x + Math.cos(a) * r1, o.y + Math.sin(a) * r1, 3.5, 0, 2 * Math.PI); ctx.fill();
      const tnow = performance.now();
      liveEdits.forEach(e => { const n = byId[e.id], i = n ? C.cs.findIndex(x => x.c === n.cluster) : -1, u = (tnow - e.t) / 1600; if (i < 0 || u > 1.6) return;
        const rr = (C.ring(i) + 9) * k, f = Math.min(1, u), x = o.x + Math.cos(a) * rr * f, y = o.y + Math.sin(a) * rr * f;
        ctx.fillStyle = `rgba(254,240,138,${u > 1 ? 1.6 - u : 1})`; ctx.beginPath(); ctx.arc(x, y, u > 1 ? 3 + (u - 1) * 14 : 3, 0, 2 * Math.PI); ctx.fill(); });
    });
    // the rings, outermost (busiest) first, in two columns under the dials: topic · busiest weekday · busiest month
    const top = scr(0, C.rOut + 10, R), rows = Math.ceil(C.cs.length / 2);
    // small cards: the dials carry it, the list would crowd them
    if (!opts.compact) C.cs.slice().reverse().forEach((x, i) => { const pk = x.wd.indexOf(Math.max(...x.wd)), pm = x.mo.indexOf(Math.max(...x.mo)), col = Math.floor(i / rows), y = top.y + (i % rows) * 15, xx = top.x + (col ? 20 : -300);
      const on0 = st.clockFocus === x.c; ctx.fillStyle = colorOf(x.c); ctx.fillRect(xx, y - 4, 8, 8);
      haloText(`${clip(clusterName(x.c), 26)} · ${WD[pk]} · ${MO[pm]}`, xx + 12, y, on0 ? "#fde047" : "#e2e8f0", "#101418", `${on0 ? 700 : 500} 10px ${font}`); clockSpots.push([xx - 2, y - 7, 300, 14, x.c]); });
    if (st.clockFocus != null) {   // drill-down: the topic's weekly mentions over the timeline, this week against its usual
      const T0 = DATA.timeline || { weeks: [], clusters: {} }, ser = T0.clusters[st.clockFocus] || [], n0 = ser.length;
      if (n0) { const mx = Math.max(1, ...ser), usual = ser.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, n0 - 1), cw = Math.min(520, W - 40), ch = 96, cx0 = (W - cw) / 2, cy0 = H - ch - 44;
        ctx.fillStyle = "rgba(15,23,32,.92)"; ctx.strokeStyle = colorOf(st.clockFocus); ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(cx0, cy0, cw, ch, 10) : ctx.rect(cx0, cy0, cw, ch); ctx.fill(); ctx.stroke();
        haloText(`${clusterName(st.clockFocus)} · daily-note mentions per week`, cx0 + 12, cy0 + 14, "#f8fafc", "#0f1720", `700 11px ${font}`);
        haloText(`this week ${ser[n0 - 1]} · usual ${usual.toFixed(1)} · ${ser[n0 - 1] > usual * 1.5 ? "busier than usual" : ser[n0 - 1] < usual * 0.5 ? "quieter than usual" : "about usual"}`, cx0 + cw - 12, cy0 + 14, "#cbd5e1", "#0f1720", `500 10px ${font}`, "right");
        const bw = (cw - 24) / n0; ser.forEach((v, i) => { const h0 = (ch - 40) * v / mx; ctx.fillStyle = i === n0 - 1 ? "#fde047" : colorOf(st.clockFocus); ctx.fillRect(cx0 + 12 + i * bw + 1, cy0 + ch - 10 - h0, bw - 2, h0); });
        ctx.strokeStyle = "rgba(226,232,240,.5)"; ctx.setLineDash([3, 3]); const uy = cy0 + ch - 10 - (ch - 40) * usual / mx; ctx.beginPath(); ctx.moveTo(cx0 + 12, uy); ctx.lineTo(cx0 + cw - 12, uy); ctx.stroke(); ctx.setLineDash([]);
        haloText(`${(T0.weeks[0] || "").slice(5)} → now · click the topic again to close`, cx0 + 12, cy0 + ch - 2, "#94a3b8", "#0f1720", `500 9px ${font}`); }
    }
    dots(n => C.cs.some(x => x.c === n.cluster) && !special(n) && !n.ghost, n => hexMix(colorOf(n.cluster), "#ffffff", 0.3), () => Math.max(1.2, 1.6 * Math.sqrt(k)), R);
    selRing(R);
  }

  // Air traffic control: open tasks on radar. Each blip is a note with open tasks (bigger = more); sectors are topics.
  // Notes drift toward the runway at the centre as they go untouched -- inside the red ring they've been holding
  // for a long time. Click a blip to see its tasks and tick them off.
  function radarLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && n.tasks > 0), pos = new Map(geo), groups = {};
    ns.forEach(n => (groups[n.cluster] = groups[n.cluster] || []).push(n));
    const keys = Object.keys(groups).map(Number).sort((a, b) => groups[b].length - groups[a].length), total = ns.length || 1, sectors = []; let a0 = -Math.PI / 2;
    keys.forEach(c => { const span = Math.max(0.25, groups[c].length / total * 2 * Math.PI * 0.92 + 0.08); sectors.push({ c, a0, a1: a0 + span, n: groups[c].length }); a0 += span; });
    const scale = 2 * Math.PI / (a0 + Math.PI / 2); sectors.forEach(s => { s.a0 = -Math.PI / 2 + (s.a0 + Math.PI / 2) * scale; s.a1 = -Math.PI / 2 + (s.a1 + Math.PI / 2) * scale; });
    // distance from the centre = how long its oldest open task has waited (first journal or standup it appeared in)
    const RMAX = 420, rOf = n => 50 + (RMAX - 50) * (1 - Math.min(1, Math.log1p(n.taskAge ?? n.age ?? 0) / Math.log1p(365)));
    sectors.forEach(s => groups[s.c].forEach(n => { const a = s.a0 + (s.a1 - s.a0) * (0.1 + 0.8 * ((hash(n.id) % 100) / 100)), r = rOf(n) + ((hash(n.id) >>> 7) % 41) - 20; pos.set(n.id, [Math.cos(a) * r, Math.sin(a) * r]); }));
    return { pos, sectors, RMAX, hold: rOf({ taskAge: 90 }), count: ns.reduce((s, n) => s + n.tasks, 0), notes: ns.length };
  }
  let radarStatic = null, radarTasks = null, radarFx = [];   // still layer { key, canvas, blips: [[id, x, y, r, holding, lit, angle]] }; open tasks per note; arrivals/landings
  function drawRadar(now) {
    const { dpr, R, litSet, k } = mapFrame(), A = mapCache.radar;
    if (!A) { ctx.fillStyle = "#020a05"; ctx.fillRect(0, 0, W, H); return; }
    const o = scr(0, 0, R), RM = A.RMAX * k, green = "34,197,94", mono = css("--vg-mono") || "monospace";
    const key = [W, H, dpr, k.toFixed(4), cam.tx.toFixed(1), cam.ty.toFixed(1), A.count, litSet ? [...litSet].length + (st.hover || "") + (st.selected || "") : "", nodes.reduce((a, n) => a + (n.tasks || 0), 0)].join("|");
    if (!radarStatic || radarStatic.key !== key || radarStatic.map !== A) {
      const cv2 = radarStatic && radarStatic.canvas.width === Math.round(W * dpr) && radarStatic.canvas.height === Math.round(H * dpr) ? radarStatic.canvas : Object.assign(document.createElement("canvas"), { width: Math.round(W * dpr), height: Math.round(H * dpr) });
      const main = ctx; ctx = cv2.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#020a05"; ctx.fillRect(0, 0, W, H);
      const sg = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, RM); sg.addColorStop(0, "rgba(6,40,20,.9)"); sg.addColorStop(1, "rgba(2,14,7,.95)"); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(o.x, o.y, RM, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = `rgba(${green},.22)`; ctx.lineWidth = 1; for (let r = 1; r <= 4; r++) { ctx.beginPath(); ctx.arc(o.x, o.y, RM * r / 4, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.strokeStyle = "rgba(239,68,68,.55)"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(o.x, o.y, A.hold * k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
      A.sectors.forEach(s0 => { ctx.strokeStyle = `rgba(${green},.25)`; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(s0.a0) * RM, o.y + Math.sin(s0.a0) * RM); ctx.stroke();
        const am = (s0.a0 + s0.a1) / 2, name = `${clip(clusterById[s0.c] ? clusterName(s0.c) : "No topic", 20).toUpperCase()} · ${s0.n}`;
        const lx = o.x + Math.cos(am) * (RM + 16), ly = o.y + Math.sin(am) * (RM + 16), al = Math.cos(am) > 0.2 ? "left" : Math.cos(am) < -0.2 ? "right" : "center", f = `600 10px ${mono}`;
        ctx.font = f; const w = ctx.measureText(name).width, bx = al === "left" ? lx : al === "right" ? lx - w : lx - w / 2;
        if (freeSpot(bx, ly - 7, w, 14)) haloText(name, lx, ly, `rgb(${green})`, "#020a05", f, al); });
      const blips = [];
      ctx.font = `600 9px ${mono}`; ctx.textAlign = "left";
      for (const n of nodes.filter(n => !special(n) && !n.ghost && n.tasks > 0 && mapShown(n)).sort((a, b) => b.tasks - a.tasks)) {   // biggest first: they get the label room
        const p = scr(n.x, n.y, R), holding = Math.hypot(p.x - o.x, p.y - o.y) < A.hold * k, lit = !litSet || litSet.has(n.id), r = Math.max(1.6, (2 + 2.2 * Math.sqrt(n.tasks)) * Math.min(Math.sqrt(k), k * 1.6) * (opts.compact ? 0.45 : 1));   // scales with the scope, so a small card isn't all blip
        blips.push([n.id, p.x, p.y, r, holding, lit, Math.atan2(p.y - o.y, p.x - o.x)]);
        const t = `${clip(n.name, 18)} · ${n.tasks}`, w = ctx.measureText(t).width;
        if ((k > 1.2 || n.tasks >= 4) && freeSpot(p.x + r + 3, p.y - 6, w, 12)) { ctx.fillStyle = holding ? "#fecaca" : "#bbf7d0"; ctx.globalAlpha = lit ? 0.85 : 0.25; ctx.fillText(t, p.x + r + 4, p.y + 3); ctx.globalAlpha = 1; }
        P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -n.tasks, r: Math.max(6, r + 3), a: lit ? 1 : 0.3 });
      }
      setSceneStat(`${plural(A.count, "open task")} · ${plural(A.notes, "note")}`);
      ctx = main; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // tasks added since the last frame fly in from the rim; notes whose tasks went down (ticked off) land at the centre
      const tasksNow = new Map(nodes.filter(n => n.tasks > 0).map(n => [n.id, n.tasks])), tnow = performance.now();
      if (radarTasks) {
        blips.forEach(b => { const was = radarTasks.get(b[0]) || 0; if (tasksNow.get(b[0]) > was) radarFx.push({ kind: "in", id: b[0], t0: tnow, x: b[1], y: b[2], r: b[3], a: b[6] }); });
        radarTasks.forEach((was, id) => { const nowT = tasksNow.get(id) || 0, old = radarStatic && radarStatic.blips.find(b => b[0] === id);
          if (nowT < was && old) radarFx.push({ kind: "land", id, t0: tnow, x: old[1], y: old[2], r: old[3], ticked: was - nowT }); });
      }
      radarTasks = tasksNow;
      radarStatic = { key, canvas: cv2, blips, map: A, P: new Map(P) };
    } else radarStatic.P.forEach((v, id) => P.set(id, v));   // hit-testing still needs every blip
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(radarStatic.canvas, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // moving parts: the sweep with its afterglow, and the blips lighting up as it passes
    const sweep = reducedMotion() ? -Math.PI / 2 : (now / 4000 * 2 * Math.PI) % (2 * Math.PI) - Math.PI / 2;
    if (ctx.createConicGradient) { const wedge = ctx.createConicGradient(sweep - 0.6, o.x, o.y);
      wedge.addColorStop(0, `rgba(${green},0)`); wedge.addColorStop(0.095, `rgba(${green},.28)`); wedge.addColorStop(0.0955, `rgba(${green},0)`); wedge.addColorStop(1, `rgba(${green},0)`);
      ctx.fillStyle = wedge; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.arc(o.x, o.y, RM, sweep - 0.6, sweep); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = `rgba(${green},.9)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(sweep) * RM, o.y + Math.sin(sweep) * RM); ctx.stroke();
    const blink = 0.55 + 0.45 * Math.abs(Math.sin(now / 300)), flying = new Set(radarFx.filter(f => f.kind === "in").map(f => f.id));
    for (const [id, x0, y0, r, holding, lit, ang] of radarStatic.blips) {
      let x = x0, y = y0;
      if (holding && !reducedMotion()) {   // a holding pattern: circle slowly at its distance, with a short trail
        const rad = Math.hypot(x0 - o.x, y0 - o.y), a = ang + now * 0.00007 + (hash(id) % 7) * 0.1;
        x = o.x + Math.cos(a) * rad; y = o.y + Math.sin(a) * rad;
        ctx.globalAlpha = lit ? 0.35 : 0.1; ctx.strokeStyle = "#f87171"; ctx.lineWidth = Math.max(1, r * 0.6); ctx.beginPath(); ctx.arc(o.x, o.y, rad, a - 0.22, a); ctx.stroke();
        const q = P.get(id); if (q) { q.x = x; q.y = y; }
      }
      if (flying.has(id)) continue;
      const since = ((sweep - Math.atan2(y - o.y, x - o.x)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
      ctx.globalAlpha = (lit ? 1 : 0.25) * (holding ? blink : Math.max(0.25, 1 - since / (2 * Math.PI) * 1.4));
      ctx.fillStyle = holding ? "#f87171" : `rgb(${green})`; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill();
    }
    const tfx = performance.now();
    radarFx = radarFx.filter(f => tfx - f.t0 < 2600);
    radarFx.forEach(f => {
      const u = (tfx - f.t0) / 1400, e = 1 - Math.pow(1 - Math.min(1, u), 3);
      if (f.kind === "in") {   // inbound from the rim along its bearing, then a ping
        const x = o.x + Math.cos(f.a) * (RM + (Math.hypot(f.x - o.x, f.y - o.y) - RM) * e), y = o.y + Math.sin(f.a) * (RM + (Math.hypot(f.x - o.x, f.y - o.y) - RM) * e);
        ctx.globalAlpha = 1; ctx.fillStyle = "#bbf7d0"; ctx.beginPath(); ctx.arc(x, y, f.r, 0, 2 * Math.PI); ctx.fill();
        if (u > 1) { ctx.globalAlpha = Math.max(0, 1.85 - u); ctx.strokeStyle = "#bbf7d0"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + (u - 1) * 30, 0, 2 * Math.PI); ctx.stroke(); }
      } else {                 // landing: glides into the centre and touches down
        const x = f.x + (o.x - f.x) * e, y = f.y + (o.y - f.y) * e;
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, u - 1) * 1.2); ctx.fillStyle = "#86efac"; ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, f.r * (1 - e * 0.6)), 0, 2 * Math.PI); ctx.fill();
        if (u > 1) { ctx.strokeStyle = "#86efac"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(o.x, o.y, 6 + (u - 1) * 22, 0, 2 * Math.PI); ctx.stroke();
          ctx.font = `700 11px ${mono}`; ctx.textAlign = "center"; ctx.fillStyle = "#bbf7d0"; ctx.fillText(`✓ LANDED · ${f.ticked} DONE`, o.x, o.y - 18); }
      }
    });
    ctx.globalAlpha = 1;
    selRing(R, UI.colour.selected);
  }


