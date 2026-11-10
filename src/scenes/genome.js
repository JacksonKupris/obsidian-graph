  // Genome fold: a year of journals folded the way Hi-C folds a chromosome (VGScience.genomeFold). The journals in date order
  // are one strand and each day is a bead on it. Two days are in contact when they name the same notes, and days in contact
  // sit close, so the strand folds back on itself wherever the same work came round again. A stretch the strand stays inside
  // is a domain (one colour); an arc joins two days far apart that share more than the days around them do (a loop). A note
  // sits at the middle of the days that named it. The shape is real 3D (space: true): drag turns it.
  // It only reads the vault: nothing here touches a note.
  ICON.genome = '<path d="M7 3c0 6 10 6 10 9s-10 3-10 9M17 3c0 6-10 6-10 9s10 3 10 9M9.5 7.5h5M9.5 16.5h5"/>';
  const GN = { SIZE: 520, MIN_DAYS: 4, INK: "#070b14", LOOP: "250,204,21", TEXT: "#e5e7eb" };
  const gnDay = d => { const [, m, day] = d.split("-"); return `${MONTHS[+m - 1].slice(0, 3)} ${+day}`; };
  const gnApart = VGShared.daysBetween;
  function genomeLayout() {
    const s = DATA.strand || { days: [], paths: [], ids: [], rows: [] }, f = VGScience.genomeFold(s.rows), pos = new Map(), daysOf = new Map();
    const beads = f.X.map(p => [p[0] * GN.SIZE, p[1] * GN.SIZE, (p[2] || 0) * GN.SIZE]), domain = new Array(f.n).fill(0);
    f.domains.forEach(([a, b], d) => { for (let i = a; i <= b; i++) domain[i] = d; });
    if (f.n >= GN.MIN_DAYS) f.days.forEach((ds, j) => {
      const n = byId[s.ids[j]]; if (!n || !ds.length) return;
      // the middle of its days, a little to one side so a note named on one day isn't under that day's bead
      const c = [0, 0, 0], h = hash(n.id), a = (h % 628) / 100, b = ((h >>> 10) % 314) / 100 - 1.57, off = GN.SIZE * 0.03;
      ds.forEach(i => { for (let x = 0; x < 3; x++) c[x] += beads[i][x] / ds.length; });
      pos.set(n.id, [c[0] + off * Math.cos(a) * Math.cos(b), c[1] + off * Math.sin(a) * Math.cos(b), c[2] + off * Math.sin(b)]); daysOf.set(n.id, ds);
    });
    return { pos, beads, bounds: beads, domain, daysOf, fold: f, strand: s };   // bounds: fit frames the whole strand, not only the notes
  }
  // the notes two days both name
  const gnShared = (G, a, b) => { const B = new Set(G.strand.rows[b]); return [...new Set(G.strand.rows[a])].filter(j => B.has(j)).map(j => G.strand.ids[j]).filter(id => byId[id]); };
  function gnShowLoop(G, l) { const s = G.strand; setHighlight(new Set(gnShared(G, l.a, l.b)), `Named on both ${gnDay(s.days[l.a])} and ${gnDay(s.days[l.b])}`); }
  // a day is its journal: the shared note detail when the journal is in the graph, the note itself otherwise
  function gnOpenDay(G, i) { const p = G.strand.paths[i]; if (byId[p]) select(p); else if (opts.openNote) opts.openNote(p, false); }
  function drawGenome() {
    const { R, litSet, font, k } = mapFrame(), G = mapCache.genome;
    backdrop(GN.INK, "#0d1424", GN.INK);
    if (!G) return;
    const s = G.strand, f = G.fold, n = f.n;
    if (n < GN.MIN_DAYS) {   // nothing to fold yet: say what it needs, and offer the view that works without it
      const x = W / 2, y = H / 2, label = "Open the graph", bf = `600 13px ${font}`;
      haloText("Genome fold needs 4 days of journals that name notes.", x, y - 34, GN.TEXT, GN.INK, `600 14px ${font}`, "center");
      haloText(`${plural(n, "day")} so far.`, x, y - 12, "#94a3b8", GN.INK, `13px ${font}`, "center");
      ctx.font = bf; const w = ctx.measureText(label).width + 28;
      ctx.fillStyle = "#1e293b"; ctx.strokeStyle = "#475569"; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(x - w / 2, y + 10, w, 30, 6); ctx.fill(); ctx.stroke();
      haloText(label, x, y + 25, GN.TEXT, "#1e293b", bf, "center", 1); spot(x - w / 2, y + 10, w, 30, () => setView("2d"), label);
      setSceneStat(`${plural(n, "day")} of journals`); return;
    }
    const pts = G.beads.map(b => proj(b[0], b[1], b[2], R)), seen = pts.filter(Boolean);
    let near = Infinity, far = -Infinity; seen.forEach(p => { near = Math.min(near, p.depth); far = Math.max(far, p.depth); });
    const fade = p => (far > near ? 1 - 0.62 * (p.depth - near) / (far - near) : 1);   // further away is fainter; flat, nothing is
    const focus = st.hover || st.selected, mine = focus && G.daysOf.has(focus) ? new Set(G.daysOf.get(focus)) : null;
    const hue = i => colorOf(G.domain[i] % PALETTE.length);
    // the strand, far joins first. A join across a border is dashed: the strand goes on, the domain doesn't
    const joins = []; for (let i = 0; i + 1 < n; i++) if (pts[i] && pts[i + 1]) joins.push(i);
    joins.sort((a, b) => pts[b].depth + pts[b + 1].depth - pts[a].depth - pts[a + 1].depth);
    ctx.lineCap = "round";
    for (const i of joins) {
      const a = pts[i], b = pts[i + 1], border = G.domain[i] !== G.domain[i + 1], on = !mine || mine.has(i) || mine.has(i + 1);
      ctx.globalAlpha = fade(a) * (on ? 0.95 : 0.22); ctx.strokeStyle = border ? "#94a3b8" : hue(i); ctx.lineWidth = Math.max(1, Math.min(5, 1.1 * (a.s + b.s)));
      ctx.setLineDash(border ? [3, 4] : []); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // loops: an arc bowed away from the middle of the fold, and a dot at its top to click
    f.loops.forEach(l => {
      const a = pts[l.a], b = pts[l.b], A = G.beads[l.a], B = G.beads[l.b], top = proj((A[0] + B[0]) * 0.68, (A[1] + B[1]) * 0.68, (A[2] + B[2]) * 0.68, R); if (!a || !b || !top) return;
      const on = !mine || mine.has(l.a) || mine.has(l.b), mx = 0.25 * a.x + 0.5 * top.x + 0.25 * b.x, my = 0.25 * a.y + 0.5 * top.y + 0.25 * b.y, r = Math.max(2.5, Math.min(5, 1.5 + l.count * 0.35));
      ctx.globalAlpha = on ? 0.6 : 0.12; ctx.strokeStyle = `rgb(${GN.LOOP})`; ctx.lineWidth = Math.min(3, 0.8 + l.count * 0.2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(top.x, top.y, b.x, b.y); ctx.stroke();
      ctx.globalAlpha = on ? 0.95 : 0.2; ctx.fillStyle = `rgb(${GN.LOOP})`; ctx.beginPath(); ctx.arc(mx, my, r, 0, 2 * Math.PI); ctx.fill();
      spot(mx - 8, my - 8, 16, 16, () => gnShowLoop(G, l), `${gnDay(s.days[l.a])} and ${gnDay(s.days[l.b])}: ${plural(l.count, "note")} named on both, ${gnApart(s.days[l.a], s.days[l.b])} days apart`);
    });
    // a note in hand shows which days named it
    const at = focus && byId[focus] && G.pos.has(focus) ? proj(byId[focus].x, byId[focus].y, byId[focus].z, R) : null;
    if (at && mine) { ctx.globalAlpha = 0.5; ctx.strokeStyle = GN.TEXT; ctx.lineWidth = 0.8; mine.forEach(i => { const p = pts[i]; if (!p) return; ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }); }
    // the days, far first; the newest wears a ring
    pts.map((p, i) => [p, i]).filter(x => x[0]).sort((a, b) => b[0].depth - a[0].depth).forEach(([p, i]) => {
      const on = !mine || mine.has(i), r = Math.max(1.6, Math.min(6, 2.2 * p.s)) * (mine && on ? 1.5 : 1), h = Math.max(r, 5);
      ctx.globalAlpha = fade(p) * (on ? 1 : 0.3); ctx.fillStyle = hue(i); ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      if (mine && on) { ctx.strokeStyle = GN.TEXT; ctx.lineWidth = 1; ctx.stroke(); }
      if (i === n - 1) { ctx.globalAlpha = 1; ctx.strokeStyle = GN.TEXT; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, 2 * Math.PI); ctx.stroke(); }
      spot(p.x - h, p.y - h, 2 * h, 2 * h, () => gnOpenDay(G, i), `${s.days[i]} · ${plural(s.rows[i].length, "note")} named`);
    });
    // the notes
    const shown = nodes.filter(m => G.pos.has(m.id) && mapShown(m)).map(m => [m, proj(m.x, m.y, m.z, R)]).filter(x => x[1]).sort((a, b) => b[1].depth - a[1].depth);
    for (const [m, p] of shown) {
      const lit0 = !litSet || litSet.has(m.id), r = Math.max(2.4, (2.6 + 6 * Math.sqrt(importance(m))) * Math.min(1.7, p.s)) * (opts.compact ? 0.6 : 1);
      ctx.globalAlpha = fade(p) * (lit0 ? 1 : 0.22); ctx.fillStyle = fillOf(m); ctx.strokeStyle = GN.INK; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (m.id === st.selected) { ctx.globalAlpha = 1; ctx.strokeStyle = GN.TEXT; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, 2 * Math.PI); ctx.stroke(); }
      labelRects.push([p.x - r, p.y - r, 2 * r, 2 * r]);
      P.set(m.id, { x: p.x, y: p.y, s: p.s, depth: p.depth, r: Math.max(6, r + 2), a: lit0 ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    // names: each domain's dates at its middle day, then the notes in hand, then the biggest that fit
    const df = `600 11px ${font}`; ctx.font = df;
    f.domains.forEach(([a, b]) => { const p = pts[(a + b) >> 1]; if (!p || b - a < 3) return;
      const t = `${gnDay(s.days[a])} – ${gnDay(s.days[b])}`, w = ctx.measureText(t).width;
      if (freeSpot(p.x - w / 2, p.y - 20, w, 14)) haloText(t, p.x, p.y - 13, hue(a), GN.INK, df, "center"); });
    const nf = `11px ${font}`; ctx.font = nf; let named = 0;
    shown.slice().sort((a, b) => (b[0].id === focus) - (a[0].id === focus) || importance(b[0]) - importance(a[0])).forEach(([m, p]) => {
      const mineToo = m.id === focus || (litSet && litSet.has(m.id) && focus); if (!mineToo && (named >= (k > 1.5 ? 40 : 14) || opts.compact)) return;
      const t = clip(m.name, 26), w = ctx.measureText(t).width, r = P.get(m.id).r;
      if (freeSpot(p.x + r + 2, p.y - 7, w, 14)) { ctx.globalAlpha = mineToo || !litSet ? 0.95 : 0.3; haloText(t, p.x + r + 3, p.y, GN.TEXT, GN.INK, nf, "left"); ctx.globalAlpha = 1; named++; } });
    setSceneStat(`${plural(n, "day")} · ${plural(f.domains.length, "domain")} · ${plural(f.loops.length, "loop")} · fit ${VGScience.stressGrade(f.stress)} (stress ${f.stress.toFixed(2)})`);
  }
  scene("genome", {
    name: "Genome fold", icon: "genome", menu: "see", space: true, hint: "A year of journals as one strand, folded so days that name the same notes touch",
    toast: "Genome fold — each bead is a day of your journal, in order along the strand. Days that name the same notes fold together; a colour is a stretch that keeps to itself, a yellow arc joins far-apart days that share notes. Drag to turn it",
    layout: () => genomeLayout(), draw: () => drawGenome(), fit: n => !!(mapCache.genome && mapCache.genome.pos.has(n.id)),
    legend: item => item(`<i class="vg-lg-line" style="border-color:${colorOf(0)};opacity:1"></i>`, "strand: a bead a day, a colour a domain") + item(`<i class="vg-lg-line" style="border-color:rgb(${GN.LOOP});opacity:1"></i>`, "loop: far-apart days naming the same notes") + item("●", "note, at the middle of its days") + item("◯", "newest day"),
    today() { const G = mapCache.genome, l = G && G.fold.loops[0]; if (!l) return null; const s = G.strand;
      return { text: `Strongest loop: ${gnDay(s.days[l.a])} and ${gnDay(s.days[l.b])} name the same ${plural(l.count, "note")}, ${gnApart(s.days[l.a], s.days[l.b])} days apart`, label: "Show them", run: () => gnShowLoop(G, l) }; },
    api: { fold: () => mapCache.genome, at: i => { const b = mapCache.genome.beads[i]; return proj(b[0], b[1], b[2], rot()); }, yaw: () => cam.yaw, still: () => { cam.spin = null; }, openDay: i => gnOpenDay(mapCache.genome, i), showLoop: i => gnShowLoop(mapCache.genome, mapCache.genome.fold.loops[i]) },   // for tests/test_genome.js
  });
