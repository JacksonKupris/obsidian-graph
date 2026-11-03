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
      const NIGHT = [11, 18, 32], c = v < 0 ? [226, 62, 72].map((x, i) => NIGHT[i] + (x - NIGHT[i]) * Math.pow(-v, 1.25) * 0.85) : [46, 118, 232].map((x, i) => NIGHT[i] + (x - NIGHT[i]) * Math.pow(v, 1.25) * 0.75);   // storms glow out of the dark
      img.data.set([c[0], c[1], c[2], 255], k * 4); }
    oc.putImageData(img, 0, 0);
    const byC = Object.fromEntries(tops.map(t => [t.c, t]));
    const fronts = (DATA.pairs || []).filter(([a, b, l, m]) => m >= 2 && byC[a] && byC[b]).sort((p, q) => q[3] - p[3]).slice(0, 7).map(([a, b, l, m]) => ({ a: byC[a], b: byC[b], m }));
    return { pos: geo, tops, iso, img: off, x0, y0, w: gw * CELL, h: gh * CELL, fronts, E, gw, gh, CELL };
  }
  function drawWeather(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), Wd = mapCache.weather;
    const gl3 = glOn() && !!Wd, heightAt = (x, y) => { const i = Math.round((x - Wd.x0) / Wd.CELL), j = Math.round((y - Wd.y0) / Wd.CELL); return i < 0 || j < 0 || i >= Wd.gw || j >= Wd.gh ? 0 : -Wd.E[j * Wd.gw + i] * WEATHER_RELIEF; }, on3 = (x, y, up = 0) => (gl3 ? proj(x, y, heightAt(x, y) - up, R) : scr(x, y, R));
    if (!gl3) { ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, W, H); } if (!Wd) return;
    if (gl3) drawWeatherGL(Wd, R);
    else { worldTransform(dpr, R); ctx.imageSmoothingEnabled = true; ctx.drawImage(Wd.img, Wd.x0, Wd.y0, Wd.w, Wd.h);
    Wd.iso.forEach(c => { ctx.strokeStyle = c.lv < 0 ? "rgba(254,178,178,.28)" : "rgba(147,197,253,.24)"; ctx.lineWidth = (Math.abs(c.lv) % 0.48 < 0.01 ? 1.6 : 0.8) / k; strokeSegs(c.seg); }); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // surface wind: round the lows and highs along the isobars, leaning 25 degrees in towards low pressure (Buys Ballot's law)
    const wind = (x, y) => { const i = Math.round((x - Wd.x0) / Wd.CELL), j = Math.round((y - Wd.y0) / Wd.CELL);
      if (i < 1 || j < 1 || i >= Wd.gw - 1 || j >= Wd.gh - 1) return null;
      const gx = Wd.E[j * Wd.gw + i + 1] - Wd.E[j * Wd.gw + i - 1], gy = Wd.E[(j + 1) * Wd.gw + i] - Wd.E[(j - 1) * Wd.gw + i];
      const v = VGScience.surfaceWind(gx, gy); return [v[0] * 9, v[1] * 9]; };
    const wx = Wd.wx || (Wd.wx = { parts: [] }), wdt = tickOf(wx, now);
    while (wx.parts.length < (MOBILE ? 140 : 280)) wx.parts.push({ x: Wd.x0 + Math.random() * Wd.w, y: Wd.y0 + Math.random() * Wd.h, life: Math.random() * 4000 });
    ctx.strokeStyle = "rgba(186,230,253,.3)"; ctx.lineWidth = 1.2; ctx.beginPath();
    wx.parts.forEach(q => { const v = wind(q.x, q.y); q.life -= wdt;
      if (!v || q.life <= 0 || Math.hypot(v[0], v[1]) < 0.01) { q.x = Wd.x0 + Math.random() * Wd.w; q.y = Wd.y0 + Math.random() * Wd.h; q.life = 2500 + Math.random() * 3500; return; }
      const m = Math.hypot(v[0], v[1]), sp = 0.4 + 1.2 * Math.min(1, m * 4), ux = v[0] / m, uy = v[1] / m; q.x += ux * sp * wdt * 0.06; q.y += uy * sp * wdt * 0.06;
      const L = 6 + 14 * Math.min(1, m * 4), a = on3(q.x, q.y, 3), b = on3(q.x - ux * L, q.y - uy * L, 3); if (a && b) { ctx.moveTo(b.x, b.y); ctx.lineTo(a.x, a.y); } });   // a streak, longer in stronger wind
    ctx.stroke();
    // fronts: two topics that keep coming up together. Warm (red, half-moons) when both are heating up,
    // cold (blue, triangles) when one is heating and one cooling, stationary (alternating) otherwise
    Wd.fronts.forEach(f => {
      const a = on3(f.a.x, f.a.y), b = on3(f.b.x, f.b.y); if (!a || !b) return; const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L, half = Math.min(90, L * 0.35) * 1, kind = f.a.a > 0.2 && f.b.a > 0.2 ? "warm" : (f.a.a > 0.2) !== (f.b.a > 0.2) ? "cold" : "still";
      const p0 = [mx - nx * half, my - ny * half], p1 = [mx + nx * half, my + ny * half], col = kind === "warm" ? "#dc2626" : kind === "cold" ? "#2563eb" : "#7c3aed";
      ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke();
      for (let t = 0.1; t < 0.95; t += 0.2) { const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, sgn = dx * 0 + 1, kd = kind === "still" ? (Math.round(t * 5) % 2 ? "warm" : "cold") : kind;
        ctx.fillStyle = kd === "warm" ? "#dc2626" : "#2563eb"; ctx.beginPath();
        if (kd === "warm") ctx.arc(x, y, 5, Math.atan2(ny, nx) + Math.PI / 2, Math.atan2(ny, nx) + Math.PI * 1.5);
        else { ctx.moveTo(x - nx * 5, y - ny * 5); ctx.lineTo(x + nx * 5, y + ny * 5); ctx.lineTo(x + dx / L * 7 * sgn, y + dy / L * 7 * sgn); }
        ctx.closePath(); ctx.fill(); }
    });
    dots(n => !special(n) && !n.ghost, () => "rgba(226,232,240,.55)", () => Math.max(1.4, 1.8 * Math.sqrt(k)), R);
    // clouds drift round busy topics; a storm's clouds are darker and spin faster
    Wd.tops.forEach(t => { if (t.a < 0.35 && !t.storm) return;
      const p = on3(t.x, t.y, gl3 ? 90 : 0); if (!p) return; const puffs = t.storm ? 6 : 3, spin = (reducedMotion() ? 0 : now) / (t.storm ? 2600 : 9000);
      for (let i = 0; i < puffs; i++) { const a = spin + i / puffs * 2 * Math.PI, rr = (t.storm ? 46 : 60) * Math.sqrt(k), x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr * 0.6, cr = (t.storm ? 30 : 26) * Math.sqrt(k);
        const g = ctx.createRadialGradient(x, y, 0, x, y, cr); g.addColorStop(0, t.storm ? "rgba(203,213,225,.42)" : "rgba(255,255,255,.2)"); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, cr, cr * 0.65, 0, 0, 2 * Math.PI); ctx.fill(); } });
    // pressure centres: L for busy, H for quiet; storms get rain and lightning
    Wd.tops.slice().sort((a, b) => Math.abs(b.a) - Math.abs(a.a)).forEach(t => {
      const p = on3(t.x, t.y, gl3 ? 14 : 0); if (!p) return; const lit = !litSet || nodes.some(n => n.cluster === t.c && litSet.has(n.id));
      ctx.globalAlpha = lit ? 1 : 0.3;
      if (t.storm && !reducedMotion()) { ctx.strokeStyle = "rgba(125,211,252,.6)"; ctx.lineWidth = 1;
        for (let i = 0; i < 26; i++) { const h = hash(t.c + "r" + i), x = p.x + ((h % 160) - 80) * Math.sqrt(k), y0 = p.y - 60 + (((h >>> 8) % 120) + now / 6) % 120 * Math.sqrt(k);
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x - 3, y0 + 9); ctx.stroke(); }
        if ((now / 1200 + t.c) % 4 < 0.12) { ctx.fillStyle = "rgba(250,204,21,.9)"; ctx.font = `700 26px ${font}`; ctx.textAlign = "center"; ctx.fillText("⚡", p.x + 24, p.y - 24); } }
      if (Math.abs(t.a) >= 0.35) { const L = t.a > 0; ctx.font = `800 ${Math.round(18 + 8 * Math.abs(t.a))}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = L ? "#ef4444" : "#3b82f6"; ctx.shadowBlur = 14; ctx.fillStyle = L ? "#fecaca" : "#bfdbfe"; ctx.fillText(L ? "L" : "H", p.x, p.y); ctx.shadowBlur = 0; }
      const name = clip(clusterName(t.c), 26), sub = t.storm ? `⛈ storm · ${t.ratio.toFixed(1)}× usual` : t.a >= 0.35 ? `heating up · ${t.ratio.toFixed(1)}× usual` : t.a <= -0.35 ? "quiet" : "steady";
      const f = `700 11px ${font}`; ctx.font = `500 9.5px ${font}`; const ws = ctx.measureText(sub).width; ctx.font = f; const w = Math.max(ctx.measureText(name).width, ws);   // the box covers both lines
      if (freeSpot(p.x - w / 2, p.y + 14, w, 26)) { haloText(name, p.x, p.y + 20, "#f1f5f9", "rgba(8,12,24,.88)", f, "center"); haloText(sub, p.x, p.y + 33, "#a3b5cc", "rgba(8,12,24,.88)", `500 9.5px ${font}`, "center"); }
      ctx.globalAlpha = 1;
    });
    selRing(R, "#f8fafc");
  }

  // Food web: which notes feed which. Notes others rely on but that link out little are producers (context, reference);
  // notes that mostly link out are consumers (logs, plans, task lists). Energy flows up the links. A relied-on note
  // that has gone stale is endangered: the notes above it feed on something that's out of date.
  function foodwebLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost && !n.isolated), pos = new Map(geo);
    // trophic levels from which way links really point (science.js): a note feeds on what it links to. Each note's height is its level.
    const dg = directedNotes(), order0 = dg && VGScience.trophic(dg.adj), byLevel = new Map(), stats = order0 ? { ...order0, mean: order0.meanLevel, n: dg.n } : null;
    if (dg) dg.ids.forEach((id, i) => byLevel.set(id, order0.level[i]));
    const lvl = dg ? null : VGRules.trophicLevels(ns);   // no direction to work from (the test page): the shared rule, a rank of out-share
    const levelOf = n => dg ? (byLevel.get(n.id) ?? 2) : lvl.get(n.id) + 1;
    const bands = dg ? Math.max(2, Math.ceil(order0.maxLevel)) : 5, step = 840 / (bands - 1), yOf = v => 420 - (v - 1) * step, levels = Array.from({ length: bands }, () => []);
    ns.forEach(n => levels[Math.max(0, Math.min(bands - 1, Math.round(levelOf(n)) - 1))].push(n));
    const order = topicOrder().map(c => c.id), ci = c => { const i = order.indexOf(c); return i < 0 ? 99 : i; };
    levels.forEach((ms, L) => { ms.sort((a, b) => ci(a.cluster) - ci(b.cluster) || importance(b) - importance(a));
      const rows = Math.max(1, Math.min(5, Math.ceil(ms.length * 24 / 1800))), cols = Math.max(1, Math.ceil(ms.length / rows)), width = Math.min(1800, Math.max(600, cols * 26));
      ms.forEach((n, i) => { const row = i % rows, j = Math.floor(i / rows); pos.set(n.id, [-width / 2 + (j + 0.5 + (row % 2) * 0.5) * width / cols, dg ? yOf(levelOf(n)) + (row - (rows - 1) / 2) * Math.min(7, step / 8) : 420 - L * 210 + row * 30 - (rows - 1) * 15]); }); });   // staggered, so topics read as bands of colour
    const endangered = new Set(ns.filter(n => n.inlinks >= 4 && staleFor(n, Q.stale_days)).map(n => n.id));
    return { pos, levels: levels.map(l => l.length), endangered, stats, step };
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
    const NAMES = F.stats ? F.levels.map((_, L) => (L === 0 ? "Level 1 · the base" : `Level ${L + 1}`)) : ["Producers · relied on, link out little", "Primary consumers", "Mixed", "Secondary consumers", "Apex · logs, plans, task lists"];
    if (F.stats) setSceneStat(`mean level ${F.stats.mean.toFixed(1)} · top ${F.stats.maxLevel.toFixed(1)} · incoherence ${F.stats.incoherence.toFixed(2)} · connectance ${(F.stats.connectance * 100).toFixed(1)}%`);
    NAMES.forEach((nm, L) => { const p = scr(0, 420 - L * F.step, R), half = F.step * 0.45; if (L % 2 === 0) { ctx.fillStyle = "rgba(255,255,255,.03)"; ctx.fillRect(0, p.y - half * k, W, 2 * half * k); }
      if (!F.levels[L]) return; const t = `${nm} (${F.levels[L]})`, f = `700 10.5px ${font}`, y = p.y - half * 0.8 * k;
      ctx.font = f; freeSpot(14, y - 8, ctx.measureText(t).width + 6, 16);   // reserved, so note labels steer around the level's name
      haloText(t, 14, y, "rgba(220,252,231,.75)", "#14231b", f); });
    ctx.lineWidth = 0.7;
    for (const l of visLinks) { if (l.kind !== "link" || special(l.s) || special(l.t) || l.s.isolated || l.t.isolated) continue;
      const [lo, hi] = l.s.y > l.t.y ? [l.s, l.t] : [l.t, l.s], a = scr(lo.x, lo.y, R), b = scr(hi.x, hi.y, R), on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      ctx.strokeStyle = on && litSet ? "rgba(253,224,71,.7)" : "rgba(187,247,208,.07)"; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x, (a.y + b.y) / 2, b.x, (a.y + b.y) / 2, b.x, b.y); ctx.stroke(); }
    dots(n => !special(n) && !n.ghost && !n.isolated, n => F.endangered.has(n.id) ? "#f87171" : colorOf(n.cluster), n => Math.max(2.4, (2.8 + 13 * importance(n)) * Math.sqrt(k)), R);
    stepFoodweb(now, k, R);
    if (st.selected && P.has(st.selected) && !special(byId[st.selected])) {   // what depends on this note
      const q = P.get(st.selected), d = dependents(st.selected).size, t = d ? `${d} note${d > 1 ? "s" : ""} depend on this` : "nothing above depends on this";
      haloText(t, q.x, q.y - q.r - 12, "#fde68a", "#14231b", `700 11px ${font}`, "center");
    }
    F.endangered.forEach(id => { const p = P.get(id); if (!p) return; ctx.strokeStyle = `rgba(248,113,113,${0.5 + 0.4 * Math.sin(now / 400)})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 3, 0, 2 * Math.PI); ctx.stroke(); });
    noteLabels([...F.endangered, ...nodes.filter(n => !special(n) && !n.isolated && P.has(n.id)).sort(byImportance).map(n => n.id)], "#ecfdf5", "#14231b", k > 1.3 ? 90 : 24);
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
    const key = [W, H, dpr, k.toFixed(4), cam.tx.toFixed(1), cam.ty.toFixed(1), A.count, replay ? replay.k : "", litSet ? [...litSet].length + (st.hover || "") + (st.selected || "") : "", nodes.reduce((a, n) => a + (n.tasks || 0), 0)].join("|");
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


