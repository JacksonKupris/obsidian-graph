  // ---------------------------------------------------------------- draw
  const shadeCache = new Map();
  function shade(col, f) {   // f > 0 lightens toward white, f < 0 darkens toward black
    const key = col + f; if (shadeCache.has(key)) return shadeCache.get(key);
    const rgb = col.startsWith("#") ? [1, 3, 5].map(i => parseInt(col.slice(i, i + 2), 16)) : (col.match(/[\d.]+/g) || [128, 128, 128]).slice(0, 3).map(Number);
    const target = f > 0 ? 255 : 0, u = Math.abs(f);
    const out = `rgb(${rgb.map(v => Math.round(v + (target - v) * u)).join(",")})`;
    shadeCache.set(key, out); return out;
  }
  const rgbaCache = new Map();
  const rgba = (col, a) => { const key = col + "|" + a; let s = rgbaCache.get(key); if (!s) { s = shade(col, 0.0001).replace("rgb(", "rgba(").replace(")", `,${a})`); rgbaCache.set(key, s); } return s; };
  // pre-rendered glows and orbs: drawing an image is far cheaper than building a gradient per note per frame
  const spriteCache = new Map();
  function sprite(kind, col) {
    const key = kind + col; let c = spriteCache.get(key); if (c) return c;
    c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const gr = kind === "orb" ? g.createRadialGradient(22, 22, 0, 32, 32, 32) : g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (kind === "orb") { gr.addColorStop(0, "#fff"); gr.addColorStop(0.5, shade(col, 0.2)); gr.addColorStop(1, shade(col, -0.35)); }
    else if (kind === "core") { gr.addColorStop(0, "#fff"); gr.addColorStop(0.45, shade(col, 0.35)); gr.addColorStop(1, col); }
    else { gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(1, rgba(col, 0)); }
    g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 32, 0, 2 * Math.PI); g.fill();
    spriteCache.set(key, c); return c;
  }
  const blit = (kind, col, x, y, r) => ctx.drawImage(sprite(kind, col), x - r, y - r, 2 * r, 2 * r);
  let labelRects = [];
  // the screen boxes of the solids and figures drawn this frame (iso.hit adds them), so note names keep off them
  let bodies = [];
  const body = box => { bodies.push(box); return box; };   // record a shape drawn this frame: [x, y, w, h] on screen
  // where a label w wide starting at x is drawn: shifted inside the pane, the way haloText shifts it
  const paneX = (x, w) => W > 40 ? Math.max(4, Math.min(W - 4 - Math.min(w, W - 8), x)) : x;
  // Reserve a label's box, as it will be drawn
  const freeSpot = (x, y, w, h) => {
    if (opts.compact && labelRects.length > (W < 520 ? 8 : 16)) return false;
    x = paneX(x, w);
    if (labelRects.some(r => x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1])) return false;
    labelRects.push([x, y, w, h]); return true;
  };
  function draw(now) {
    const r = drawView(now);
    if (mapView() && W) polishLayer(now);
    return r;
  }
  function drawView(now) {
    if (neural()) return drawNeural(now);
    if (isCosmos()) return drawCosmos(now);
    if (st.view === "subway") return drawSubway(now);
    if (st.view === "topo") return drawTopo(now);
    if (st.view === "city") return drawCity(now);
    if (st.view === "garden") return drawGarden(now);
    if (st.view === "palace") return drawPalace(now);
    const more = { weather: drawWeather, ships: drawShips, rings: drawRings, sky: drawSky, realm: drawRealm, foodweb: drawFoodweb, alchemy: drawAlchemy, lineage: drawLineage, ripples: drawRipples, clock: drawClock, radar: drawRadar }[st.view];
    if (more) return more(now);
    if (SCENES[st.view]) return SCENES[st.view].draw(now);
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = css("--vg-bg"); ctx.fillRect(0, 0, W, H);   // clear first: the theme background can be see-through
    project();
    const litSet = lit(), fd = st.focusDist;
    const fg = css("--vg-fg"), muted = css("--vg-muted"), bg = css("--vg-bg"), accent = css("--vg-accent");
    const font = css("--vg-font") || "system-ui, sans-serif";
    // edges, batched by style
    const groups = new Map();
    for (const l of visLinks) {
      const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue;
      const dimmed = litSet && !(litSet.has(l.s.id) && litSet.has(l.t.id));
      // in 3D, ordinary links fade with distance (three bands keep the batching cheap)
      const band = st.three && !dimmed && l.kind === "link" ? Math.min(2, Math.max(0, Math.floor(((a.depth + b.depth) / 2 + 300) / 300))) : "";
      const key = dimmed ? "dim" : l.kind + band;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a, b);
    }
    const stroke = { dim: css("--vg-edge-dim"), link: css("--vg-edge"), gap: css("--vg-gap"), similar: css("--vg-sim"), person: css("--vg-person"), wanted: css("--vg-muted"), moc: css("--vg-muted") };
    const bandAlpha = [1, 0.55, 0.25];
    for (const [key, pts] of groups) {
      ctx.beginPath();
      const kind = key.replace(/\d$/, ""), band = key.match(/\d$/);
      ctx.globalAlpha = band ? bandAlpha[+band[0]] : VGRules.SUGGESTION_KINDS.has(kind) && !litSet ? 0.45 : kind === "person" ? 0.22 : kind === "moc" ? 0.12 : kind === "wanted" ? 0.4 : 1;
      ctx.strokeStyle = stroke[kind]; ctx.lineWidth = kind === "link" ? (band && band[0] === "0" ? 1.1 : 0.8) : kind === "dim" || kind === "person" ? 0.6 : 1.2;
      ctx.setLineDash(VGRules.SUGGESTION_KINDS.has(kind) ? [4, 4] : kind === "wanted" || kind === "moc" ? [2, 3] : []);
      for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); }
      ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (st.path) drawPath(accent);
    // nodes, far to near
    const order = active.filter(n => P.has(n.id)).sort((a, b) => P.get(b.id).depth - P.get(a.id).depth);
    const spheres = st.three && !(MOBILE && active.length > 350), badges = [];   // drawn after the labels, which steer round them
    for (const n of order) {
      // zoom grows nodes sub-linearly (like 2D); in 3D, perspective (s/k) scales near/far on top
      const p = P.get(n.id), rel = st.three ? Math.pow(p.s / cam.k, 1.3) * 1.2 : 1;
      const r = Math.max(1.6, worldRadius(n) * Math.pow(cam.k, 0.8) * rel);
      let a = litSet && !litSet.has(n.id) ? 0.08 : 1;
      if (fd) a *= UI.focusAlpha[Math.min(fd.get(n.id) || 0, 4)];
      if (st.three) a *= Math.min(1, Math.max(0.5, p.s / cam.k));
      ctx.globalAlpha = a;
      const col = fillOf(n);
      if (n.ghost) {   // not written yet: hollow, dashed
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.setLineDash([2, 2]); ctx.lineWidth = 1.5; ctx.strokeStyle = n.created ? accent : muted; ctx.stroke(); ctx.setLineDash([]);
      } else if (n.moc) {   // maps of content: hexagons
        hexagon(p.x, p.y, r); ctx.fillStyle = rgba(col, 0.18); ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = col; ctx.stroke();
      } else if (n.person) {   // people: diamonds
        ctx.beginPath(); ctx.moveTo(p.x, p.y - r * 1.2); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r * 1.2); ctx.lineTo(p.x - r, p.y); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        if (spheres && r > 2.5 && a > 0.3) {   // faded nodes stay flat: big blurry spheres read as noise
          const g = ctx.createRadialGradient(p.x - r * 0.38, p.y - r * 0.42, r * 0.08, p.x, p.y, r * 1.02);
          g.addColorStop(0, shade(col, 0.6)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.5));
          ctx.fillStyle = g; ctx.fill();
          if (r > 4) {
            ctx.globalAlpha = a * 0.55; ctx.fillStyle = "#fff";
            ctx.beginPath(); ctx.ellipse(p.x - r * 0.36, p.y - r * 0.42, r * 0.22, r * 0.14, -0.6, 0, 2 * Math.PI); ctx.fill();
            ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
          }
        } else { ctx.fillStyle = col; ctx.fill(); }
      }
      if (st.selected === n.id || (st.multi && st.multi.has(n.id))) {   // selection halo
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.lineWidth = 2.5; ctx.strokeStyle = accent; ctx.stroke();
        ctx.globalAlpha = a * 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 2 * Math.PI); ctx.lineWidth = 4; ctx.stroke();
      } else if (overlayHit(n) && a > 0.5) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.lineWidth = 2; ctx.strokeStyle = fg; ctx.stroke(); }
      if (st.layers.tasks && n.tasks > 0 && a > 0.3 && (!MOBILE || cam.k > 1.6 || n.tasks >= 10 || st.selected === n.id)) badges.push([p.x + r * 0.8, p.y - r * 0.8, n.tasks]);
      p.r = r; p.a = a;
    }
    ctx.globalAlpha = 1;
    labelRects = badges.map(([x, y, c]) => { const w = badgeW(c, font); return [x - w / 2, y - 6, w, 12]; });
    // cluster names at their centroid
    if (cam.k < 2.4 && !fd) {
      const sum = clusterCentroids(litSet);
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `600 14px ${font}`;
      for (const [c, g] of Object.entries(sum).sort((a, b) => b[1].c - a[1].c)) {
        if (g.c < 5) continue;
        const name = clusterById[c].name, w = ctx.measureText(name).width;
        const x = Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, g.x / g.c)); let y = Math.min(H - 12, Math.max(56, g.y / g.c));
        const dy = [0, -18, 18].find(d => freeSpot(x - w / 2, y + d - 9, w, 18)); if (dy == null) continue;   // reserves the spot (or one a line up or down); node labels steer around it
        y += dy;
        ctx.globalAlpha = litSet && !g.lit ? 0.15 : 0.9;
        ctx.lineWidth = 4; ctx.strokeStyle = bg; ctx.strokeText(name, x, y);
        ctx.fillStyle = colorOf(+c); ctx.fillText(name, x, y);
      }
      ctx.globalAlpha = 1;
    }
    drawLabels(order, litSet, fd, font, fg, bg, false);
    badges.forEach(([x, y, c]) => drawBadge(x, y, c, font));
    if (st.leaves) {
      ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `bold 10px ${font}`; ctx.fillStyle = muted;
      for (const n of order) if (leafCount[n.id] >= 3) { const p = P.get(n.id); if (p.a > 0.3) ctx.fillText(`+${leafCount[n.id]}`, p.x + p.r + 3, p.y); }
    }
  }
  function hexagon(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; i ? ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)) : ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
    ctx.closePath();
  }
  function clusterCentroids(litSet) {
    const sum = {};
    for (const n of active) {
      if (n.cluster < 0) continue; const p = P.get(n.id); if (!p) continue;
      const g = sum[n.cluster] || (sum[n.cluster] = { x: 0, y: 0, c: 0, lit: false });
      g.x += p.x; g.y += p.y; g.c++; if (litSet && litSet.has(n.id)) g.lit = true;
    }
    return sum;
  }
  function drawPath(accent) {
    ctx.beginPath(); ctx.strokeStyle = accent; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    for (let i = 1; i < st.path.ids.length; i++) {
      const a = P.get(st.path.ids[i - 1]), b = P.get(st.path.ids[i]);
      if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    }
    ctx.stroke(); ctx.lineCap = "butt";
  }
  const badgeText = count => count > 99 ? "99+" : String(count);
  const badgeW = (count, font) => { ctx.font = `bold 9px ${font}`; return Math.max(12, ctx.measureText(badgeText(count)).width + 6); };
  function drawBadge(x, y, count, font) {
    const t = badgeText(count), w = badgeW(count, font);
    ctx.globalAlpha = 1; ctx.fillStyle = css("--vg-task"); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 6, w, 12, 6) : ctx.rect(x - w / 2, y - 6, w, 12); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y + 0.5);
  }
  function drawLabels(order, litSet, fd, font, fg, bg, hud) {
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    const base = hud ? `500 10px ${css("--vg-mono")}` : `11px ${font}`;
    ctx.font = base;
    const want = [];
    if (st.selected) want.push(st.selected);
    if (st.hover) want.push(st.hover);
    if (litSet && litSet.size <= 60) want.push(...litSet);
    labelled.slice(0, hud && !fd ? (cam.k < 1.4 ? 5 : 10) : cam.k < 1 && !fd ? 6 : UI.size.labelTop).forEach(id => want.push(id));
    if (st.layers.mocs) active.filter(n => n.moc).forEach(n => want.push(n.id));
    if (st.layers.wanted && !hud) active.filter(n => n.ghost && n.from.length >= 3).forEach(n => want.push(n.id));
    if (cam.k > 2.4 || fd) for (let i = order.length - 1; i >= 0; i--) want.push(order[i].id);
    const done = new Set(isCosmos() ? cos.bodies.flatMap(b => b.type === "star" ? [b.target] : b.type === "binary" ? (b.target || []) : []) : []);   // bodies carry their own labels
    let tried = 0, drawn = 0;
    for (const id of want) {
      if (done.has(id)) continue; done.add(id);
      const p = P.get(id); if (!p || p.a < (fd ? 0.15 : 0.3)) continue;
      if (p.x < -60 || p.x > W + 60 || p.y < -20 || p.y > H + 10) continue;   // off screen: don't even measure
      if (++tried > 450 || drawn > (MOBILE ? 45 : 110)) break;              // enough labels; the rest would collide anyway
      let text = byId[id].name.length > 42 ? byId[id].name.slice(0, 40) + "…" : byId[id].name;
      if (hud) text = text.toUpperCase();
      const wk = base + "|" + text; let w = textW.get(wk); if (w === undefined) { w = ctx.measureText(text).width; textW.set(wk, w); }
      const y = p.y + (p.r || 3) + 3, x = Math.min(W - w / 2 - 4, Math.max(w / 2 + 4, p.x));
      if (!freeSpot(x - w / 2, y, w, 13) && id !== st.selected && id !== st.hover) continue;
      ctx.font = id === st.selected ? (hud ? `700 11px ${css("--vg-mono")}` : `600 12px ${font}`) : base;
      if (!hud) { ctx.lineWidth = 3; ctx.strokeStyle = bg; ctx.strokeText(text, x, y); }
      else { ctx.globalAlpha = 0.55; ctx.fillStyle = "#01040b"; ctx.fillRect(x - w / 2 - 3, y - 1, w + 6, 13); ctx.globalAlpha = 1; }
      ctx.fillStyle = hud ? (id === st.selected ? "#e0f2fe" : "rgba(186,230,253,.82)") : fg;
      ctx.fillText(text, x, y);
      ctx.font = base; drawn++;
    }
  }
  const textW = new Map();

  // ---------------------------------------------------------------- neural renderer
  const pulses = [];
  let wave = null, lobeSpots = [], lastPulse = 0;
  function startWave(id) {   // rings 1-3 out from the note, over drawn notes only
    if (!(neural() || mapView()) || reducedMotion() || !byId[id]) return;
    const dist = new Map([[id, 0]]); let frontier = [id];
    for (let d = 1; d <= 3 && frontier.length; d++) {
      const next = [];
      for (const x of frontier) for (const y of nb[x] || []) if (!dist.has(y) && P.has(y)) { dist.set(y, d); next.push(y); }
      frontier = next;
    }
    wave = { id, dist, t0: performance.now() };
  }
  // ---- the polish every view shares (first made for Neural): signal pulses along the links of recently active notes,
  // the wave that runs out from a selected note, and the rotating selection reticle. They draw over whatever a view
  // drew, from where it put each note (P), so a map view or scene gets them with no code of its own (polishLayer).
  // A scene can turn one off: scene(key, { polish: { pulses: false, wave: false, reticle: false } }).
  const along = (a, b, c, u) => {   // a point u (0-1) along a link, straight or bent through c
    const cx = c ? c.x : (a.x + b.x) / 2, cy = c ? c.y : (a.y + b.y) / 2;
    return [(1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x, (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y];
  };
  const pickActive = () => {   // a link, the hottest most often (rebuildActivity weighs them)
    const r = Math.random() * pulseTotal; let lo = 0, hi = pulseCum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pulseCum[m] < r) lo = m + 1; else hi = m; }
    return pulseLinks[lo];
  };
  // pulses fire along links of notes you've edited or mentioned lately, travelling out from the more active end;
  // over a note or selection they run through its neighbourhood. inLinks/inSet: the links drawn; ctlOf(l): a bend point or null
  function drawPulses(now, inLinks, inSet, litSet, ctlOf, colOf) {
    const pool = litSet ? inLinks.filter(l => litSet.has(l.s.id) && litSet.has(l.t.id)) : null;
    const maxPulses = MOBILE ? 24 : 70, cap = pool || pulseTotal ? maxPulses : 8;   // a quiet vault barely flickers
    if (reducedMotion() || !(pool ? pool.length : inLinks.length)) return;
    for (let tries = 0; pulses.length < cap && Math.random() < 0.6 && tries < 40; tries++) {
      const l = pool ? pool[(Math.random() * pool.length) | 0] : pulseTotal ? pickActive() : inLinks[(Math.random() * inLinks.length) | 0];
      if (!inSet.has(l)) continue;   // a hot link this view doesn't draw
      const w = pool ? 1 : Math.max(activity(l.s), activity(l.t));
      pulses.push({ l, t: 0, sp: 0.004 + Math.random() * 0.01, w: Math.max(0.25, w), rev: activity(l.t) > activity(l.s) });
    }
    const tNow = now || performance.now(), pstep = Math.min(4, Math.max(0.5, (tNow - (lastPulse || tNow)) / 16.7)) || 1;   // same speed at any frame rate
    lastPulse = tNow;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const q = pulses[i]; q.t += q.sp * pstep;
      let a = P.get(q.l.s.id), b = P.get(q.l.t.id); const c = ctlOf(q.l);
      if (q.t >= 1 || !a || !b || !inSet.has(q.l)) { pulses.splice(i, 1); continue; }
      if (q.rev) [a, b] = [b, a];
      const [x, y] = along(a, b, c, q.t), rr = 3 + 3 * q.w;
      const col = colOf(q.l.s.cluster >= 0 ? q.l.s : q.l.t), g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, "rgba(255,255,255,.95)"); g.addColorStop(0.4, rgba(col, 0.7)); g.addColorStop(1, rgba(col, 0));
      ctx.globalAlpha = Math.sin(Math.PI * q.t) * (0.35 + 0.65 * q.w); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // spreading activation: selecting a note sends a wave out through its links, one ring at a time (startWave)
  function drawWaveLinks(now, inLinks, ctlOf, colOf) {
    const waveT = wave ? (now || performance.now()) - wave.t0 : 0;
    if (wave && (waveT > UI.time.wave * 4 + 700 || !P.has(wave.id))) wave = null;
    if (!wave) return;
    for (const l of inLinks) {
      if (l.kind !== "link") continue;
      const ds = wave.dist.get(l.s.id), dt = wave.dist.get(l.t.id);
      if (ds == null || dt == null || ds === dt) continue;
      const [from, to, d0] = ds < dt ? [l.s, l.t, ds] : [l.t, l.s, dt];
      const u = (waveT - d0 * UI.time.wave) / UI.time.wave; if (u < 0 || u > 1.5) continue;
      const a = P.get(from.id), b = P.get(to.id); if (!a || !b) continue;
      const [x, y] = along(a, b, ctlOf(l), Math.min(1, u)), fade = u > 1 ? 1 - (u - 1) / 0.5 : 1;
      ctx.globalAlpha = fade * (1 - d0 * 0.25); blit("glow", colOf(to), x, y, 9);
    }
    ctx.globalAlpha = 1;
  }
  // the wave reaching a note: a flash that fades with distance (r = the note's drawn radius)
  function waveFlash(n, p, r, colOf, now) {
    const wd = wave && wave.dist.get(n.id); if (wd == null) return;
    const k = ((now || performance.now()) - wave.t0 - wd * UI.time.wave) / 260;
    if (k > -0.3 && k < 2.5) { ctx.globalAlpha = Math.exp(-k * k * 1.5) * (1 - wd * 0.2); blit("glow", wd ? colOf(n) : "#ffffff", p.x, p.y, r * (wd ? 5 : 7)); ctx.globalAlpha = 1; }
  }
  // the selected note: rotating brackets, a slower dashed ring and two sight lines
  function drawReticle(now, col) {
    const sel = st.selected && P.get(st.selected); if (!sel) return;
    const t = (now || performance.now()) / 1000, rr = Math.min(48, Math.max(14, (sel.r || 6) * 2.6));
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    for (let i = 0; i < 4; i++) { const a0 = (reducedMotion() ? 0 : t * 0.9) + i * Math.PI / 2; ctx.beginPath(); ctx.arc(sel.x, sel.y, rr, a0, a0 + 0.7); ctx.stroke(); }
    ctx.globalAlpha = 0.35; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.arc(sel.x, sel.y, rr + 7, -t * 0.5, -t * 0.5 + Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(sel.x - rr - 16, sel.y); ctx.lineTo(sel.x - rr - 4, sel.y); ctx.moveTo(sel.x + rr + 4, sel.y); ctx.lineTo(sel.x + rr + 16, sel.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // all three over a map view or scene, along straight links between the notes it drew, in topic colours
  function polishLayer(now) {
    const off = (SCENES[st.view] && SCENES[st.view].polish) || {}, colOf = n => colorOf(n.cluster), straight = () => null;
    const inLinks = visLinks.filter(l => l.kind === "link" && P.has(l.s.id) && P.has(l.t.id)), inSet = new Set(inLinks);
    ctx.save(); ctx.globalCompositeOperation = "source-over";
    if (off.pulses !== false) drawPulses(now, inLinks, inSet, lit(), straight, colOf);
    if (off.wave !== false) { drawWaveLinks(now, inLinks, straight, colOf);
      if (wave) for (const id of wave.dist.keys()) { const p = P.get(id); if (p && byId[id]) waveFlash(byId[id], p, Math.min(10, p.r || 6), colOf, now); } }
    if (off.reticle !== false) drawReticle(now, UI.colour.selected);
    ctx.restore();
  }
  function drawNeural(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // deep-space backdrop with a vignette
    const bgG = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    if (st.vision === "nv") { bgG.addColorStop(0, "#03140a"); bgG.addColorStop(1, "#000502"); }
    else if (st.vision === "thermal") { bgG.addColorStop(0, "#0b0820"); bgG.addColorStop(1, "#020108"); }
    else { bgG.addColorStop(0, "#081a33"); bgG.addColorStop(1, "#01040b"); }
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);
    project();
    const R = rot(), litSet = lit(), fd = st.focusDist, font = css("--vg-font"), hudCol = st.vision === "nv" ? "#4ade80" : "#38bdf8";
    // wireframe "globe": faint meridians and parallels of the cortex shell
    ctx.globalAlpha = 0.07; ctx.strokeStyle = hudCol; ctx.lineWidth = 1;
    const shellPt = (lat, lon) => proj(Math.cos(lat) * Math.cos(lon) * BRAIN_R * 1.18, Math.sin(lat) * BRAIN_R * 0.86, Math.cos(lat) * Math.sin(lon) * BRAIN_R * 0.98, R);
    for (let m = 0; m < 12; m++) {
      ctx.beginPath(); let first = true;
      for (let k = 0; k <= 24; k++) { const p = shellPt(-Math.PI / 2 + Math.PI * k / 24, m * Math.PI / 6); if (!p) { first = true; continue; } first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); first = false; }
      ctx.stroke();
    }
    for (let l = 1; l < 6; l++) {
      ctx.beginPath(); let first = true;
      for (let k = 0; k <= 36; k++) { const p = shellPt(-Math.PI / 2 + Math.PI * l / 6, 2 * Math.PI * k / 36); if (!p) { first = true; continue; } first ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); first = false; }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "lighter";
    // lobe glow: a lobe you've been working in glows; one that's gone quiet stays dark
    if (!fd) for (const c in lobeStats) {
      const d = lobeDir[c], g = lobeStats[c]; if (!d || g.notes < 3) continue;
      const L = Math.hypot(d[0], d[1], d[2]) || 1, p = proj(d[0] / L * BRAIN_R * 1.18, d[1] / L * BRAIN_R * 0.86, d[2] / L * BRAIN_R * 0.98, R);
      if (!p) continue;
      const rad = BRAIN_R * (0.18 + 0.22 * Math.sqrt(g.notes / 110)) * p.s, back = Math.max(0.25, Math.min(1, 0.7 - p.depth / 500));
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad), col = st.vision === "std" ? neonOf(+c) : hudCol;
      halo.addColorStop(0, rgba(col, 0.05 + 0.3 * g.act)); halo.addColorStop(1, rgba(col, 0));
      ctx.globalAlpha = back * (litSet ? 0.4 : 1); ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, 2 * Math.PI); ctx.fill();
    }
    // connections: arcs bent toward the core, batched by colour
    const groups = new Map();
    const ctl = l => proj((l.s.x + l.t.x) * 0.28, (l.s.y + l.t.y) * 0.28, (l.s.z + l.t.z) * 0.28, R);
    for (const l of visLinks) {
      const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue;
      const on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      const col = l.kind === "link" ? fillOf(l.s.cluster >= 0 ? l.s : l.t) : l.kind === "gap" ? "#fb7185" : l.kind === "similar" ? "#c084fc" : "#94a3b8";
      const key = col + (on ? "|1" : "|0") + (l.kind === "link" ? "" : "|d");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push([a, b, ctl(l)]);
    }
    for (const [key, segs] of groups) {
      const [col, on, dash] = key.split("|");
      ctx.beginPath(); ctx.strokeStyle = col; ctx.lineWidth = on === "1" ? 1 : 0.6;
      ctx.globalAlpha = litSet ? (on === "1" ? 0.55 : 0.025) : 0.13;
      ctx.setLineDash(dash ? [3, 5] : []);
      for (const [a, b, c] of segs) { ctx.moveTo(a.x, a.y); c ? ctx.quadraticCurveTo(c.x, c.y, b.x, b.y) : ctx.lineTo(b.x, b.y); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
    drawPulses(now, visLinks, visSet, litSet, ctl, fillOf);
    drawWaveLinks(now, visLinks, ctl, fillOf);
    // nodes: glowing cores with halos
    const order = active.filter(n => P.has(n.id)).sort((a, b) => P.get(b.id).depth - P.get(a.id).depth);
    for (const n of order) {
      const p = P.get(n.id), rel = Math.pow(p.s / cam.k, 1.3);
      const r = Math.max(1.4, worldRadius(n) * 0.7 * Math.pow(cam.k, 0.8) * rel);
      let a = litSet && !litSet.has(n.id) ? 0.1 : 1;
      if (fd) a *= UI.focusAlpha[Math.min(fd.get(n.id) || 0, 4)];
      a *= Math.min(1, Math.max(0.35, p.s / cam.k));
      const col = fillOf(n);
      if (a > 0.2 && !n.ghost) {
        ctx.globalAlpha = a * 0.8 * 0.55; blit("glow", col, p.x, p.y, r * 3.2);
      }
      ctx.globalAlpha = a;
      if (n.ghost) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.setLineDash([2, 2]); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
      else if (!n.person && !n.moc) blit("core", col, p.x, p.y, r);   // the common case: a pre-rendered orb
      else {
        const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        core.addColorStop(0, "#ffffff"); core.addColorStop(0.45, shade(col, 0.35)); core.addColorStop(1, col);
        ctx.fillStyle = core; ctx.beginPath();
        if (n.person) { ctx.moveTo(p.x, p.y - r * 1.2); ctx.lineTo(p.x + r, p.y); ctx.lineTo(p.x, p.y + r * 1.2); ctx.lineTo(p.x - r, p.y); ctx.closePath(); }
        else if (n.moc) { hexagon(p.x, p.y, r * 1.3); ctx.fillStyle = rgba(col, 0.15); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.35, 0, 2 * Math.PI); ctx.fillStyle = core; }
        else ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
        ctx.fill();
      }
      waveFlash(n, p, r, fillOf, now);
      p.r = r; p.a = a;
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    drawReticle(now, hudCol);
    if (st.path) drawPath(hudCol);
    labelRects = []; lobeSpots = [];
    // lobe labels in HUD type
    if (!fd) {
      // each lobe is labelled just outside the shell, at its own centre (not the members' centroid,
      // which the core's bridge notes would drag inward); lobes on the far side fade out
      const sum = clusterCentroids(litSet);
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `600 10.5px ${css("--vg-mono")}`;
      const lobes = Object.entries(sum).filter(([c, g]) => g.c >= 5 && lobeDir[c]).map(([c, g]) => {
        const d = lobeDir[c], L = Math.hypot(d[0], d[1], d[2]) || 1;
        return [c, g, proj(d[0] / L * BRAIN_R * 1.18 * 1.14, d[1] / L * BRAIN_R * 0.86 * 1.14, d[2] / L * BRAIN_R * 0.98 * 1.14, R)];
      }).filter(x => x[2]).sort((a, b) => a[2].depth - b[2].depth);
      // under each name, the lobe's health: notes, how many were touched this week, how many have gone stale.
      // A quiet lobe's label dims. Hover a label for the full picture, click it to focus the topic.
      const small = `500 9px ${css("--vg-mono")}`, big = ctx.font;
      for (const [c, g, p] of lobes) {
        const hs = lobeStats[c], name = `⟨ ${clusterById[c].name.toUpperCase()} ⟩`;
        const sub = topicReadout(c).toUpperCase();
        ctx.font = small; const ws = sub ? ctx.measureText(sub).width : 0; ctx.font = big;
        const w = Math.max(ctx.measureText(name).width, ws), h = sub ? 30 : 18;
        const x = Math.min(W - w / 2 - 6, Math.max(w / 2 + 6, p.x)), y = Math.min(H - h + 6, Math.max(56, p.y));
        if (!freeSpot(x - w / 2 - 4, y - 9, w + 8, h)) continue;
        const back = Math.max(0.2, Math.min(1, 0.6 - p.depth / 400)), quiet = hs ? 0.45 + 0.55 * Math.min(1, hs.act * 2.5) : 1;
        const col = st.vision === "std" ? neonOf(+c) : hudCol;
        ctx.globalAlpha = (litSet && !g.lit ? 0.18 : 0.9) * back * quiet; ctx.fillStyle = col; ctx.fillText(name, x, y);
        if (sub) { ctx.font = small; ctx.globalAlpha *= 0.75; ctx.fillText(sub, x, y + 13); ctx.font = big; }
        if (back > 0.3) lobeSpots.push([x - w / 2 - 4, y - 9, w + 8, h, +c]);
      }
      ctx.globalAlpha = 1;
    }
    drawLabels(order, litSet, fd, font, "#e0f2fe", "#000", true);
  }

