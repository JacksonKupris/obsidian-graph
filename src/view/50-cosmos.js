  // ---------------------------------------------------------------- cosmos: a sandbox of celestial bodies
  // Place bodies in space and they reorganise the graph around a question: a STAR (a note or MOC) pulls
  // linked notes into orbit by link distance; a PLANET (a search) captures matching notes as moons;
  // BINARY stars (two MOCs) orbit each other with shared notes at the middle; a BLACK HOLE (a filter such
  // as "stale") swallows matching notes into a review queue; a REPULSOR pushes a topic out of the way.
  // Automatic: comets (notes in recent dailies), wormholes (link suggestions), an asteroid belt (notes
  // to write) and a nebula (unlinked notes). Placing bodies only changes the view; anything that writes
  // to a note asks, as everywhere else. XP and achievements come from real vault changes.
  const BODY = {
    star: { label: "Star", glyph: "☀", hint: "A note or MOC — linked notes orbit it by link distance", mass: 1 },
    planet: { label: "Planet", glyph: "◍", hint: "A search — tag:, folder:, cluster:, moc: or words — matching notes become moons", mass: 0.5 },
    binary: { label: "Binary", glyph: "⚭", hint: "Two MOCs orbiting each other — notes linked to both sit in the middle", mass: 1.2 },
    blackhole: { label: "Black hole", glyph: "●", hint: "A filter — stale, orphans, stubs… — matching notes fall into a review queue", mass: 2.2 },
    repulsor: { label: "Repulsor", glyph: "◎", hint: "Pushes a topic away to clear space", mass: -1 },
  };
  const BH_FILTERS = { stale: "Stale (not edited in " + Q.stale_days + "+ days)", orphans: "Orphans (nothing links here)", stubs: "Stubs (under " + Q.stub_words + " words)",
    deadends: "Dead ends (link nowhere)", tasks: "Open tasks", notinmap: "Not in their topic's map" };
  const NEBULA = [-640, 460], BELT_R = 720;
  // The nebula (unlinked notes) is a gas cloud on a slow circular orbit about the core; its notes circle inside it
  const NEB_R = Math.hypot(...NEBULA), NEB_A0 = Math.atan2(NEBULA[1], NEBULA[0]), GM_NEB = 6;
  const nebulaPos = () => { const a = NEB_A0 + physT * Math.sqrt(GM_CORE / Math.pow(NEB_R, 3)); return [Math.cos(a) * NEB_R, Math.sin(a) * NEB_R]; };
  let cos = { bodies: [], auto: { comets: true, wormholes: true, belt: true, nebula: true, grid: true, motion: true, trails: true }, done: [], ach: {}, xp: 0 };
  let capture = new Map(), repelled = new Map(), bodyCaptured = new Map();
  const mocMembers = {}; links.filter(l => l.kind === "moc").forEach(l => (mocMembers[l.s.id] = mocMembers[l.s.id] || new Set()).add(l.t.id));
  const graphNb = id => new Set([...(nb[id] || []), ...(mocMembers[id] || [])]);
  // A star can sit on any note, even one the graph leaves out (a navigation map, a hub list): what it lists orbits it
  const stemOf = id => String(id || "").split("/").pop().replace(/\.md$/i, "");
  const anchorNb = id => byId[id] ? graphNb(id) : new Set([...(((DATA.mocs || []).find(m => m.id === id) || {}).members || []),
    ...(opts.outlinksOf ? opts.outlinksOf(id) : [])].filter(x => byId[x]));
  const bodyName = b => b.name || (b.type === "star" && b.target ? (byId[b.target] ? byId[b.target].name : ((DATA.mocs || []).find(m => m.id === b.target) || {}).title || stemOf(b.target)) : b.type === "binary" && Array.isArray(b.target) ? b.target.map(x => byId[x] ? byId[x].name : "?").join(" & ")
    : b.type === "blackhole" ? (BH_FILTERS[b.target] || b.target || "Black hole").split(" (")[0] : b.target || BODY[b.type].label);
  function matchQuery(q) {
    q = String(q || "").trim(); if (!q) return () => false;
    const m = q.match(/^(\w+):\s*(.+)$/), v = (m ? m[2] : q).toLowerCase();
    if (m && m[1] === "tag") return n => (n.tags || []).some(x => x === v || x.startsWith(v + "/"));
    if (m && m[1] === "folder") return n => (n.folder || "").toLowerCase().startsWith(v);
    if (m && m[1] === "cluster") return n => String(n.cluster) === v || clusterName(n.cluster).toLowerCase().includes(v);
    if (m && m[1] === "moc") { const mm = mocs.find(x => x.title.toLowerCase().includes(v)); return n => onMap(mm, n.id); }
    return n => n.name.toLowerCase().includes(v) || (n.tags || []).some(x => x.includes(v));
  }
  const bhTest = f => f === "notinmap" ? (n => inMoc(n.id) === false) : OVERLAYS[f] ? OVERLAYS[f].test : matchQuery(f);
  function cosmosCapture() {
    capture = new Map(); repelled = new Map(); bodyCaptured = new Map();
    const order = { blackhole: 0, star: 1, binary: 2, planet: 3 };
    const vis = active.filter(n => !special(n) || n.moc);
    [...cos.bodies].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9)).forEach(b => {
      const got = [];
      const take = (n, info) => { if (!capture.has(n.id) && !(b.type === "star" && n.id === b.target)) { capture.set(n.id, { b, ...info }); got.push(n.id); } };
      if (b.type === "star" && b.target) {
        const dist = new Map([[b.target, 0]]), queue = [b.target];
        while (queue.length) { const v = queue.shift(), d = dist.get(v); if (d >= 3) continue; (v === b.target ? anchorNb(v) : graphNb(v)).forEach(m => { if (!dist.has(m)) { dist.set(m, d + 1); queue.push(m); } }); }
        // one link out and the star doesn't link back (it links to the map, the map doesn't list it): retrograde
        const out = byId[b.target] ? new Set([...links.filter(l => l.kind === "link" && l.s.id === b.target).map(l => l.t.id), ...(mocMembers[b.target] || [])]) : anchorNb(b.target);
        vis.forEach(n => { const d = dist.get(n.id); if (d) take(n, { r: 30 + d * 55, spin: 0.55 / Math.sqrt(d), ring: d, retro: d === 1 && !out.has(n.id) }); });
      } else if (b.type === "planet") {
        const ms = vis.filter(matchQuery(b.target)); ms.forEach((n, i) => take(n, { r: 34 + Math.sqrt(ms.length) * 5 + (i % 3) * 8, spin: 0.7 }));
      } else if (b.type === "binary" && Array.isArray(b.target)) {
        const [A, B] = b.target, na = graphNb(A), nB = graphNb(B);
        vis.forEach(n => { if (n.id === A || n.id === B) return; const ia = na.has(n.id), ib = nB.has(n.id);
          if (ia && ib) take(n, { r: 6 + (hash(n.id) % 18), spin: 0.2, lagrange: true }); else if (ia) take(n, { r: 42, spin: 0.6, anchor: 0 }); else if (ib) take(n, { r: 42, spin: 0.6, anchor: 1 }); });
      } else if (b.type === "blackhole") {
        const test = bhTest(b.target), kept = new Set(cos.kept || []); vis.filter(n => !n.moc && !kept.has(n.id) && test(n)).forEach((n, i) => take(n, { r: 12 + (i % 6) * 5, spin: 1.4, hole: true }));
      } else if (b.type === "repulsor") {
        vis.filter(matchQuery(b.target)).forEach(n => repelled.set(n.id, b));
      }
      bodyCaptured.set(b.id, got);
    });
    const anchors = new Set(cos.bodies.flatMap(b => b.type === "star" ? [b.target] : b.type === "binary" ? (b.target || []) : []));
    for (const n of nodes) {
      const c = capture.get(n.id);
      if (!c) {   // field notes: circular orbits about the galactic centre (inner ones faster: differential rotation)
        if (n.isolated && cos.auto.nebula && active.includes(n)) {
          if (!n.orb || n.orb.role !== "nebula") { const h = hash(n.id), r = 18 + h % 130, a = (h >>> 8) % 628 / 100, v = Math.sqrt(GM_NEB / r) * (h % 5 ? 1 : -1);
            n.orb = { b: "nebula", role: "nebula", rx: Math.cos(a) * r, ry: Math.sin(a) * r, vx: -Math.sin(a) * v, vy: Math.cos(a) * v }; }
          continue;
        }
        if (n.isolated || n.ghost || anchors.has(n.id) || !active.includes(n)) { n.orb = null; continue; }
        if (!n.orb || n.orb.role !== "galaxy") { const r = Math.max(80, Math.hypot(n.x, n.y)), a = Math.atan2(n.y, n.x), v = Math.sqrt(GM_GAL / r);
          n.orb = { b: "galaxy", role: "galaxy", rx: Math.cos(a) * r, ry: Math.sin(a) * r, vx: -Math.sin(a) * v, vy: Math.cos(a) * v }; }
        continue;
      }
      const role = c.lagrange ? "trojan" : c.hole ? "hole" : "orbit";
      if (!n.orb || n.orb.b !== c.b.id || n.orb.role !== role || n.orb.anchor !== c.anchor || n.orb.retro !== !!c.retro) initOrbit(n, c);
    }
  }
  // ---- orbital mechanics (real Newtonian gravity, in vault units)
  // Each captured note is a test particle in its captor's gravity field: a = -GM r / |r|^3 (softened),
  // integrated with symplectic Euler, so energy is conserved and orbits are true Kepler ellipses.
  // Captured notes start on circular orbits, v = sqrt(GM/r); notes from recent dailies start at
  // perihelion of an ellipse (e = 0.6), like comets. Binary stars orbit their barycentre at the rate
  // Kepler's third law gives; notes linked to both sit at the stable L4/L5 Lagrange points. Black holes
  // swallow through a viscous accretion disc down to the innermost stable circular orbit (3 r_s).
  // Each body's influence is its own (patched conics): a note feels only the body that captured it.
  const GM_UNIT = 30;   // a 100-unit orbit around a 1x star takes ~19 s at 60 fps
  const BODY_GM = { star: 1, planet: 0.3, binary: 0.8, blackhole: 3, repulsor: 0 };
  const gmOf = b => GM_UNIT * (BODY_GM[b.type] || 0) * (b.mass || 1);
  const SOFT2 = 36;     // gravitational softening (6 units): no singularity at r -> 0
  const GM_GAL = GM_UNIT * 6;   // the galaxy's central mass: field notes take about a minute per lap at r = 400
  const BIN_SEP = 156;  // binary separation a; each star sits a/2 from the barycentre
  const rsOf = b => 4 + 4 * (b.mass || 1);   // Schwarzschild radius, at display scale
  let physT = 0;        // simulation clock (frames), advanced by the time warp
  function binaryAngle(b) {   // Kepler III: omega = sqrt(G(M1+M2)/a^3), both stars of mass GM
    return physT * Math.sqrt(2 * gmOf(b) / Math.pow(BIN_SEP, 3)) + hash(b.id) % 6;
  }
  function anchorPos(b, i) {
    const a = binaryAngle(b) + i * Math.PI;
    return [b.x + Math.cos(a) * BIN_SEP / 2, b.y + Math.sin(a) * BIN_SEP / 2];
  }
  function centreOf(c) { return c.anchor != null ? anchorPos(c.b, c.anchor) : [c.b.x, c.b.y]; }
  // put a note on a fresh orbit around its captor: keep its bearing, set radius and the right speed
  function initOrbit(n, c) {
    const [cx, cy] = centreOf(c), gm = gmOf(c.b);
    let dx = n.x - cx, dy = n.y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    // Shape carries meaning: a comet (named in recent dailies) plunges in on e = 0.6; a stale note drifts onto a
    // long ellipse (e up to 0.55 as it goes untouched), which precesses into a rosette; a current one stays round.
    const comet = n.recent > 0 && !c.hole && !c.lagrange;
    const e = comet ? 0.6 : c.hole || c.lagrange ? 0 : Math.min(0.55, Math.max(0, ((n.age || 0) - 30) / (Q.stale_days * 2)));
    const r = c.r * (1 - e), dir = c.retro ? -1 : 1;   // start at perihelion; c.r is the orbit's semi-major axis
    const v = Math.sqrt(gm * (1 + e) / r) * dir;
    n.orb = { b: c.b.id, role: c.lagrange ? "trojan" : c.hole ? "hole" : "orbit", anchor: c.anchor, rx: dx * r, ry: dy * r, vx: -dy * v, vy: dx * v, isco: 0, retro: !!c.retro };
    if (c.hole) n.orb.isco = 3 * rsOf(c.b) + (hash(n.id) % 6) * 3;
  }
  function stepOrbits(dt) {
    for (const n of active) {
      const o = n.orb; if (!o || n.pin) continue;
      if (o.role === "galaxy") {
        const r2 = o.rx * o.rx + o.ry * o.ry, inv = 1 / Math.pow(r2 + SOFT2, 1.5);
        o.vx -= GM_GAL * o.rx * inv * dt; o.vy -= GM_GAL * o.ry * inv * dt;
        if (wells.length) {   // moving bodies raise wakes in the disc as they pass; its gas drag smooths them out again
          for (const [bx, by, gm] of wells) { const ex = bx - o.rx, ey = by - o.ry, d2 = ex * ex + ey * ey; if (d2 > 250000) continue;
            const f = gm * FIELD_COUPLE / Math.pow(d2 + 1600, 1.5) * dt; o.vx += ex * f; o.vy += ey * f; }
          const r = Math.sqrt(r2) || 1, vc = Math.sqrt(GM_GAL / Math.max(r, 40));
          o.vx += (-o.ry / r * vc - o.vx) * GAS_DRAG * dt; o.vy += (o.rx / r * vc - o.vy) * GAS_DRAG * dt;
        }
        o.rx += o.vx * dt; o.ry += o.vy * dt;
        n.x = o.rx; n.y = o.ry; n.vx = n.vy = 0; continue;
      }
      if (o.role === "nebula") {   // swirling in the cloud (a fifth of it the other way round: turbulence)
        const r2 = o.rx * o.rx + o.ry * o.ry, inv = 1 / Math.pow(r2 + 400, 1.5), [cx, cy] = nebulaPos();
        o.vx -= GM_NEB * o.rx * inv * dt; o.vy -= GM_NEB * o.ry * inv * dt; o.rx += o.vx * dt; o.ry += o.vy * dt;
        n.x = cx + o.rx; n.y = cy + o.ry; n.vx = n.vy = 0; continue;
      }
      const c = capture.get(n.id); if (!c) { n.orb = null; continue; }
      if (o.role === "trojan") {   // L4/L5: equilateral with both stars, 60 deg ahead of / behind star 0, co-rotating
        const lead = hash(n.id) % 2 ? 1 : -1, lib = 0.12 * Math.sin(physT / 240 + hash(n.id) % 9);   // small libration about the point
        const ang = binaryAngle(c.b) + lead * Math.PI / 3 + lib, R = BIN_SEP * 0.866 + (hash(n.id) % 14) - 7;
        n.x = c.b.x + Math.cos(ang) * R; n.y = c.b.y + Math.sin(ang) * R; n.vx = n.vy = 0; continue;
      }
      const gm = gmOf(c.b);
      const r2 = o.rx * o.rx + o.ry * o.ry, L = o.rx * o.vy - o.ry * o.vx;
      // a 1/r^3 term, as in general relativity (exaggerated so you can see it): ellipses precess into rosettes
      const inv = (1 + PREC * L * L / (r2 + SOFT2)) / Math.pow(r2 + SOFT2, 1.5);
      o.vx -= gm * o.rx * inv * dt; o.vy -= gm * o.ry * inv * dt;
      if (o.role === "hole") {   // viscous accretion: lose energy until the innermost stable orbit, then stay on it
        const r = Math.sqrt(r2);
        if (r > o.isco) { const k = 1 - 0.006 * dt; o.vx *= k; o.vy *= k; }
        else { const v = Math.sqrt(gm / o.isco), ux = o.rx / (r || 1), uy = o.ry / (r || 1); o.rx = ux * o.isco; o.ry = uy * o.isco; o.vx = -uy * v; o.vy = ux * v; }
      }
      repelled.forEach(b => {   // radiation pressure (1/r^2, outward) perturbs orbits too
        const [cx, cy] = centreOf(c), dx = cx + o.rx - b.x, dy = cy + o.ry - b.y, d2 = dx * dx + dy * dy + SOFT2;
        if (d2 < 360 * 360) { const f = 900 * (b.mass || 1) / d2 * dt / Math.sqrt(d2); o.vx += dx * f * 0.02; o.vy += dy * f * 0.02; }
      });
      o.rx += o.vx * dt; o.ry += o.vy * dt;
      const [cx, cy] = centreOf(c); n.x = cx + o.rx; n.y = cy + o.ry; n.vx = n.vy = 0;
    }
  }
  // ---- the bodies move too: a galactic core holds them, they tug on each other, planets orbit a star
  // Stars, binaries, black holes and repulsors orbit the core (GM_CORE). A planet orbits the star or binary whose
  // notes it shares most, in that body's frame, as moons do. Bodies pull on each other at BODY_COUPLE of their
  // strength, as Plummer spheres the size of a system (a planet feels it as a tide): enough for resonances, precession and the odd slingshot, not
  // enough to wreck a system. arrangeOrbits() lays out rings of up to three co-orbital bodies 120 degrees apart.
  // Neighbouring rings' periods differ by the golden ratio (radius ratio phi^(2/3), Kepler III): the least resonant
  // spacing (KAM), since a 2:1 chain pumped eccentricities until stars were flung out. Dynamical friction with the
  // disc slowly re-circularises stars and planets after a disturbance; the black hole keeps its diving ellipse and
  // repulsors their wide retrograde one.
  const GM_CORE = 260, BODY_COUPLE = 0.06, BODY_GM_CAP = 45, BODY_SOFT2 = 150 * 150, RING0 = 360, RING_RATIO = Math.pow((1 + Math.sqrt(5)) / 2, 2 / 3), DYN_FRICTION = 0.0003;
  const FIELD_COUPLE = 0.35, GAS_DRAG = 0.0025, PREC = 3 / 27;
  let wells = [];   // [x, y, GM] of each body, refreshed every step; field notes feel them
  const bodyById = id => cos.bodies.find(b => b.id === id);
  const parentOf = b => b.parent ? bodyById(b.parent) || null : null;
  const holdGm = p => p ? Math.max(gmOf(p), 12) : GM_CORE;
  function planetParent(b) {   // the star or binary sharing most of this planet's notes
    const test = matchQuery(b.target), ms = nodes.filter(n => !special(n) && test(n)).map(n => n.id);
    let best = null, bn = 0;
    cos.bodies.filter(x => x.type === "star" || x.type === "binary").forEach(x => {
      const own = new Set([...(bodyCaptured.get(x.id) || []), ...[].concat(x.target || []).flatMap(t => [...anchorNb(t)])]);
      const k = ms.filter(id => own.has(id)).length; if (k > bn) { bn = k; best = x; }
    });
    return best;
  }
  // put a body on an orbit about its parent (or the core): semi-major axis a, eccentricity e, starting at
  // perihelion at angle th, prograde (dir 1) or retrograde (-1)
  function setOrbit(b, parent, a, e, th, dir) {
    const r = a * (1 - e), v = Math.sqrt(holdGm(parent) * (1 + e) / r) * dir;
    b.parent = parent ? parent.id : null; b.rx = Math.cos(th) * r; b.ry = Math.sin(th) * r; b.vx = -Math.sin(th) * v; b.vy = Math.cos(th) * v;
    placeFromOrbit(b);
  }
  function placeFromOrbit(b) { const p = parentOf(b); b.x = (p ? p.x : 0) + b.rx; b.y = (p ? p.y : 0) + b.ry; }
  function circularHere(b, parent) {   // keep where it is, give it the speed of a circular orbit there
    const px = parent ? parent.x : 0, py = parent ? parent.y : 0, dx = b.x - px, dy = b.y - py, r = Math.max(60, Math.hypot(dx, dy));
    setOrbit(b, parent, r, 0, Math.atan2(dy, dx), b.type === "repulsor" ? -1 : 1);
  }
  function arrangeOrbits(announce) {
    const ring = cos.bodies.filter(b => b.type === "star" || b.type === "binary").sort((a, b) => gmOf(b) - gmOf(a) || (a.id < b.id ? -1 : 1));
    ring.forEach((b, i) => { const k = Math.floor(i / 3); setOrbit(b, null, RING0 * Math.pow(RING_RATIO, k), 0.04, (i % 3) * 2 * Math.PI / 3 + k * Math.PI / 3, 1); });
    const outer = RING0 * Math.pow(RING_RATIO, Math.max(0, Math.ceil(ring.length / 3) - 1));
    cos.bodies.filter(b => b.type === "blackhole").forEach((b, i) => setOrbit(b, null, (RING0 + outer) / 2 + 90 + 70 * i, 0.5, 2.3 + i * 2.4, 1));
    cos.bodies.filter(b => b.type === "repulsor").forEach((b, i) => setOrbit(b, null, outer * 1.4 + 60 * i, 0.15, 4 + i * 2, -1));
    const moons = {};
    cos.bodies.filter(b => b.type === "planet").forEach((b, i) => {
      const p = planetParent(b), j = moons[p ? p.id : ""] = (moons[p ? p.id : ""] || 0) + 1;
      if (p) setOrbit(b, p, 205 + 45 * (j - 1), 0.08, i * 2.4, 1); else setOrbit(b, null, outer * 1.18 + 50 * j, 0.1, i * 2.4, 1);
    });
    cos.arranged = 2; trails.clear(); noteTrails.clear();
    cosmosCapture(); persistSoon(); kick();
    if (announce) toast("Bodies arranged: co-orbital rings 120° apart at golden-ratio spacing, the black hole on a diving ellipse");
  }
  function stepBodies(dt) {
    const held = drag && drag.body;
    // core-orbiting bodies first (they carry the planets), then planets in their parent's frame
    const order = [...cos.bodies.filter(b => !b.parent), ...cos.bodies.filter(b => b.parent)];
    const pos = new Map(cos.bodies.map(b => [b.id, [b.x, b.y]]));
    for (const b of order) {
      if (b.rx == null) circularHere(b, parentOf(b));
      const p = parentOf(b);
      if (b === held) { b.rx = b.x - (p ? p.x : 0); b.ry = b.y - (p ? p.y : 0); b.vx = b.vy = 0; continue; }
      const gm = holdGm(p), r2 = b.rx * b.rx + b.ry * b.ry, inv = 1 / Math.pow(r2 + SOFT2, 1.5);
      let ax = -gm * b.rx * inv, ay = -gm * b.ry * inv;
      for (const o of cos.bodies) {
        if (o === b || o === p || o.parent === b.id) continue;
        const g = Math.min(gmOf(o), BODY_GM_CAP) * BODY_COUPLE; if (!g) continue;   // capped: a black hole nudges, it doesn't eject
        const [ox, oy] = pos.get(o.id), ex = ox - b.x, ey = oy - b.y, f = g / Math.pow(ex * ex + ey * ey + BODY_SOFT2, 1.5);
        ax += ex * f; ay += ey * f;
        if (p) { const qx = ox - p.x, qy = oy - p.y, h = g / Math.pow(qx * qx + qy * qy + BODY_SOFT2, 1.5); ax -= qx * h; ay -= qy * h; }   // a tide: the parent feels it too
      }
      if (b.type !== "blackhole" && b.type !== "repulsor") {   // dynamical friction: toward a circular orbit at this radius
        const r0 = Math.hypot(b.rx, b.ry) || 1, h = b.rx * b.vy - b.ry * b.vx >= 0 ? 1 : -1, vc = Math.sqrt(gm / r0) * h;
        ax += (-b.ry / r0 * vc - b.vx) * DYN_FRICTION; ay += (b.rx / r0 * vc - b.vy) * DYN_FRICTION;
      }
      b.vx += ax * dt; b.vy += ay * dt; b.rx += b.vx * dt; b.ry += b.vy * dt;
      const r = Math.hypot(b.rx, b.ry);
      if (p ? r > 520 : r > 2600) setOrbit(b, p, p ? 230 : Math.min(r, 1400), 0, Math.atan2(b.ry, b.rx), 1);   // flung out: it settles back in
      placeFromOrbit(b);
    }
    wells = cos.bodies.filter(b => gmOf(b) > 0).map(b => [b.x, b.y, gmOf(b)]);
  }
  // let go of a dragged body: it keeps the throw, or settles on a circular orbit where it was dropped. A planet
  // dropped near a star or binary is captured by it.
  function releaseBody(b, fvx, fvy) {
    if (!cos.auto.motion) return;
    const dist = x => Math.hypot(x.x - b.x, x.y - b.y);
    const parent = b.type === "planet" ? cos.bodies.filter(x => (x.type === "star" || x.type === "binary") && dist(x) < 360).sort((x, y) => dist(x) - dist(y))[0] || null : null;
    circularHere(b, parent);
    if (Math.hypot(fvx, fvy) > 0.4) { b.vx += fvx * 0.35; b.vy += fvy * 0.35; toast(`${bodyName(b)} thrown onto a new orbit`); }
    trails.delete(b.id); persistSoon();
  }
  function orbitText(b) {   // osculating elements, from the current state
    const p = parentOf(b), gm = holdGm(p), r = Math.hypot(b.rx, b.ry), v2 = b.vx * b.vx + b.vy * b.vy, E = v2 / 2 - gm / r;
    if (!(E < 0)) return `escaping ${p ? bodyName(p) : "the core"}`;
    const a = -gm / (2 * E), h = b.rx * b.vy - b.ry * b.vx, e = Math.sqrt(Math.max(0, 1 + 2 * E * h * h / (gm * gm)));
    return `orbits ${p ? bodyName(p) : "the galactic core"}${h < 0 ? " (retrograde)" : ""} · a ${Math.round(a)} · e ${e.toFixed(2)} · ${(2 * Math.PI * Math.sqrt(a * a * a / gm) / 60).toFixed(0)} s per lap`;
  }
  // trails: recent positions of the bodies, and of the selected body's notes
  const trails = new Map(), noteTrails = new Map(), TRAIL = 220, NOTE_TRAIL = 90;
  let trailTick = 0;
  function recordTrails() {
    if (!cos.auto.trails || ++trailTick % 3) return;
    const push = (m, id, x, y, max) => { let t = m.get(id); if (!t) m.set(id, t = []); t.push(x, y); if (t.length > max * 2) t.splice(0, 2); };
    cos.bodies.forEach(b => push(trails, b.id, b.x, b.y, TRAIL));
    const ids = st.body ? bodyCaptured.get(st.body) || [] : [];
    if (noteTrails.size && ![...noteTrails.keys()].every(id => ids.includes(id))) noteTrails.clear();
    ids.slice(0, 80).forEach(id => { const n = byId[id]; if (n) push(noteTrails, id, n.x, n.y, NOTE_TRAIL); });
  }
  function drawTrail(t, col, w) {   // older segments fainter
    const k = 6, pts = t.length / 2, seg = Math.ceil(pts / k);
    for (let c = 0; c < k; c++) {
      const i0 = c * seg, i1 = Math.min(pts - 1, (c + 1) * seg); if (i1 <= i0) continue;
      ctx.globalAlpha = 0.05 + 0.32 * (c + 1) / k; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (let i = i0; i <= i1; i++) { const [x, y] = toScreen(t[2 * i], t[2 * i + 1]); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function cosmosForces() {
    if (st.paused) return;
    const warp = st.warp || 1, sub = warp > 1 ? 4 : 2, dt = warp / sub;
    if (cos.auto.motion && cos.arranged !== 2 && cos.bodies.length) arrangeOrbits(false);   // first run with moving bodies
    const fx = st.follow && bodyById(st.follow), before = fx ? [fx.x, fx.y] : null;
    for (let s = 0; s < sub; s++) { physT += dt; if (cos.auto.motion) stepBodies(dt); else wells = []; stepOrbits(dt); }
    if (fx && !drag) { cam.tx -= (fx.x - before[0]) * cam.k; cam.ty -= (fx.y - before[1]) * cam.k; }   // the camera rides along with the selected body
    recordTrails();
    cos.bodies.forEach(b => {
      if (b.type === "star" && byId[b.target]) { const n = byId[b.target]; n.x = b.x; n.y = b.y; n.vx = n.vy = 0; }
    });
    cos.bodies.forEach(b => {
      if (b.type === "binary" && Array.isArray(b.target)) b.target.forEach((id, i) => { const n = byId[id]; if (n) { [n.x, n.y] = anchorPos(b, i); n.vx = n.vy = 0; } });
    });
    for (const n of active) {
      if (n.pin || n.orb) continue;
      if (n.isolated && cos.auto.nebula) {   // nebula: gas held loosely together, drifting
        const dx = n.x - NEBULA[0], dy = n.y - NEBULA[1], d = Math.hypot(dx, dy) || 1, r = 20 + hash(n.id) % 110, f = (d - r) * 0.02;
        n.vx -= dx / d * f; n.vy -= dy / d * f; n.vx += -dy / d * 0.05 * warp; n.vy += dx / d * 0.05 * warp;
      } else if (n.ghost && cos.auto.belt) {   // asteroid belt: Kepler's v = sqrt(GM/r), inner rocks overtake outer ones
        const r = BELT_R + (hash(n.id) % 60) - 30, w = Math.sqrt(GM_UNIT * 40 / Math.pow(r, 3)) * warp, a = Math.atan2(n.y, n.x) + w;
        const tx = Math.cos(a) * r, ty = Math.sin(a) * r; n.vx += (tx - n.x) * 0.2; n.vy += (ty - n.y) * 0.2;
      }
    }
    repelled.forEach((b, id) => { const n = byId[id]; if (!n || n.pin || n.orb) return; const dx = n.x - b.x, dy = n.y - b.y, d2 = dx * dx + dy * dy + SOFT2;
      if (d2 < 360 * 360) { const f = 2600 * (b.mass || 1) / d2 * warp; const d = Math.sqrt(d2); n.vx += dx / d * f; n.vy += dy / d * f; } });   // radiation pressure
  }
  function periodSec(b, r) { const gm = gmOf(b); return gm ? 2 * Math.PI * Math.sqrt(r * r * r / gm) / 60 : 0; }   // Kepler III
  function setPaused(on, auto) {
    st.paused = on; st.autoPaused = on && !!auto;
    const pill = $(".vg-pausepill"); if (pill) pill.hidden = !on || !isCosmos();
    $$(".vg-pausebtn").forEach(x => x.setAttribute("aria-pressed", on)); dirty = true; kick();
  }
  const toWorld = (sx, sy) => [(sx - W / 2 - cam.tx) / cam.k + cam.cx, (sy - H / 2 - cam.ty) / cam.k + cam.cy];
  const toScreen = (x, y) => [W / 2 + cam.tx + (x - cam.cx) * cam.k, H / 2 + cam.ty + (y - cam.cy) * cam.k];
  const bodySize = b => ({ star: 20, planet: 13, binary: 11, blackhole: 15, repulsor: 15 }[b.type]) * Math.max(0.6, Math.pow(cam.k, 0.5)) * (0.75 + 0.25 * Math.sqrt(b.mass || 1));
  function bodyHit(sx, sy) {
    for (const b of [...cos.bodies].reverse()) { const [x, y] = toScreen(b.x, b.y); if (Math.hypot(x - sx, y - sy) < bodySize(b) + 10) return b; }
    return null;
  }
  function wormholeHit(sx, sy) {
    if (!cos.auto.wormholes || !st.gaps) return null;
    for (const l of visLinks) { if (l.kind !== "gap" && l.kind !== "similar") continue;
      for (const n of [l.s, l.t]) { const p = P.get(n.id); if (p && Math.hypot(p.x - sx, p.y - sy) < 11 && Math.hypot(p.x - sx, p.y - sy) > 3) return l; } }
    return null;
  }
  const healthCache = new Map();
  function health(b) {   // cached for a second: it walks every captured note
    const c = healthCache.get(b.id), now = performance.now();
    if (c && now - c[0] < 1000) return c[1];
    const v = healthNow(b); healthCache.set(b.id, [now, v]); return v;
  }
  function healthNow(b) {   // share of a system's notes that are mapped, linked and current
    const ids = bodyCaptured.get(b.id) || []; if (!ids.length) return null;
    const s = ids.reduce((acc, id) => { const n = byId[id], m = inMoc(id); return acc + ((m === null ? 0.5 : m ? 1 : 0) + (nb[id].size >= 2 ? 1 : 0) + (!staleFor(n, Q.stale_days) ? 1 : 0)) / 3; }, 0);
    return Math.round(100 * s / ids.length);
  }
  const STARFIELD = Array.from({ length: 260 }, (_, i) => { const h = hash("star" + i); return [(h % 10000) / 10000, ((h >>> 14) % 10000) / 10000, 0.3 + ((h >>> 7) % 70) / 100, (h >>> 3) % 3]; });
  function drawCosmos(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#0a1024"); bg.addColorStop(1, "#010208"); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    for (const [u, v, a, s] of STARFIELD) {   // distant stars drift slowly with the camera (parallax)
      const x = ((u * W + cam.tx * 0.06 * (s + 1)) % W + W) % W, y = ((v * H + cam.ty * 0.06 * (s + 1)) % H + H) % H;
      ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(now / 900 + u * 40)); ctx.fillStyle = "#e0ecff"; ctx.fillRect(x, y, s ? 1.4 : 1, s ? 1.4 : 1);
    }
    ctx.globalAlpha = 1;
    project();
    const litSet = lit(), font = css("--vg-font");
    // spacetime grid, warped toward mass
    if (cos.auto.grid && cos.bodies.length) {
      // spacing adapts to zoom (about 55 px on screen, never finer than 70 world units); bodies' masses read once
      const step = Math.max(70, Math.ceil(55 / cam.k / 35) * 35), [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
      const ms = cos.bodies.map(b => [b.x, b.y, BODY[b.type].mass * (b.mass || 1) * 5200]);
      const warp = (x, y) => {
        let dx = 0, dy = 0;
        for (const [bx, by, m] of ms) { const ex = bx - x, ey = by - y, d = Math.sqrt(ex * ex + ey * ey) || 1, pull = Math.min(d * 0.7, m / (d + 90)); dx += ex / d * pull; dy += ey / d * pull; }
        return toScreen(x + dx, y + dy);
      };
      ctx.strokeStyle = theme().grid; ctx.globalAlpha = 0.09; ctx.lineWidth = 1;
      const sx = Math.floor(x0 / step) * step, sy = Math.floor(y0 / step) * step;
      for (let gx = sx; gx <= x1 + step; gx += step) { ctx.beginPath(); for (let gy = sy; gy <= y1 + step; gy += step / 3) { const [px, py] = warp(gx, gy); gy === sy ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
      for (let gy = sy; gy <= y1 + step; gy += step) { ctx.beginPath(); for (let gx = sx; gx <= x1 + step; gx += step / 3) { const [px, py] = warp(gx, gy); gx === sx ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    // nebula and belt guides
    if (cos.auto.nebula) { const [nx, ny] = toScreen(...nebulaPos()), r = 170 * cam.k, g = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
      g.addColorStop(0, "rgba(168,85,247,.22)"); g.addColorStop(0.5, "rgba(56,189,248,.08)"); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(nx, ny, r, 0, 2 * Math.PI); ctx.fill();
      if (cam.k > 0.25) { ctx.fillStyle = "rgba(216,180,254,.55)"; ctx.font = `600 10px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.fillText("NEBULA · UNLINKED NOTES", nx, ny - r * 0.75); } }
    if (cos.auto.belt && ghosts.length && st.view) { const [ox, oy] = toScreen(0, 0); ctx.strokeStyle = "rgba(148,163,184,.12)"; ctx.setLineDash([2, 6]); ctx.lineWidth = 18 * cam.k;
      ctx.beginPath(); ctx.arc(ox, oy, BELT_R * cam.k, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
    // the galactic core the bodies orbit, and their trails
    if (cos.auto.motion && cos.bodies.length) {
      const [ox, oy] = toScreen(0, 0), r = Math.max(18, 46 * cam.k), g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, "rgba(255,244,214,.55)"); g.addColorStop(0.35, "rgba(251,191,36,.16)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, r, 0, 2 * Math.PI); ctx.fill();
    }
    if (cos.auto.trails) {
      ctx.globalCompositeOperation = "lighter";
      const TC = { star: "rgba(253,224,71,1)", planet: "rgba(165,180,252,1)", binary: "rgba(191,219,254,1)", blackhole: "rgba(251,146,60,1)", repulsor: "rgba(125,211,252,1)" };
      cos.bodies.forEach(b => { const t = trails.get(b.id); if (t && t.length > 4) drawTrail(t, TC[b.type], 1.6); });
      noteTrails.forEach((t, id) => { if (t.length > 4 && byId[id]) drawTrail(t, neonOf(byId[id].cluster), 0.9); });
      ctx.globalCompositeOperation = "source-over";
    }
    // orbit guides
    cos.bodies.forEach(b => {
      const [x, y] = toScreen(b.x, b.y); ctx.strokeStyle = "rgba(186,230,253,.12)"; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
      if (b.type === "star") for (let d = 1; d <= 3; d++) { ctx.beginPath(); ctx.arc(x, y, (30 + d * 55) * cam.k, 0, 2 * Math.PI); ctx.stroke(); }
      if (b.type === "binary") { ctx.beginPath(); ctx.arc(x, y, 78 * cam.k, 0, 2 * Math.PI); ctx.stroke(); }
      ctx.setLineDash([]);
    });
    // links, faint
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath(); ctx.strokeStyle = "rgba(148,197,255,.07)"; ctx.lineWidth = 0.8;
    for (const l of visLinks) { if (l.kind !== "link" && l.kind !== "moc") continue; const a = P.get(l.s.id), b = P.get(l.t.id); if (a && b) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } }
    ctx.stroke();
    // wormholes: link suggestions as unstable portals at both ends
    if (cos.auto.wormholes && st.gaps) {
      for (const l of visLinks) { if (l.kind !== "gap" && l.kind !== "similar") continue;
        const a = P.get(l.s.id), b = P.get(l.t.id); if (!a || !b) continue;
        const on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
        ctx.globalAlpha = on ? 0.35 : 0.05; ctx.strokeStyle = l.kind === "gap" ? "#f472b6" : "#c084fc"; ctx.setLineDash([2, 7]); ctx.lineDashOffset = -now / 60;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2 + (b.y - a.y) * 0.2, (a.y + b.y) / 2 - (b.x - a.x) * 0.2, b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = on ? 0.9 : 0.1;
        if (on || cam.k > 1.2) for (const p of [a, b]) for (let i = 0; i < 2; i++) { const r0 = 5 + i * 2.5, s = now / 400 * (i % 2 ? -1 : 1) + i; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, r0, s, s + Math.PI * 1.2); ctx.stroke(); }
      }
      ctx.lineDashOffset = 0;
    }
    ctx.globalAlpha = 1;
    // comets: notes from recent dailies trail a tail pointing away from what they orbit
    const order = active.filter(n => P.has(n.id));
    if (cos.auto.comets) for (const n of order) {
      if (!n.recent) continue; const p = P.get(n.id), c = capture.get(n.id);
      const [cx, cy] = c ? toScreen(c.b.x, c.b.y) : toScreen(0, 0); let dx = p.x - cx, dy = p.y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const L = (14 + Math.sqrt(n.recent) * 14) * Math.max(0.6, Math.pow(cam.k, 0.6)), g = ctx.createLinearGradient(p.x, p.y, p.x + dx * L, p.y + dy * L);
      g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(0.3, rgba(neonOf(n.cluster), 0.45)); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + dx * L, p.y + dy * L); ctx.stroke(); ctx.lineCap = "butt";
    }
    // notes: small glowing worlds; notes to write are grey rocks; unlinked notes are nebula dust
    for (const n of order) {
      const p = P.get(n.id); let a = litSet && !litSet.has(n.id) ? 0.12 : 1;
      if (st.focusDist) a *= UI.focusAlpha[Math.min(st.focusDist.get(n.id) || 0, 4)];
      const col = n.moc ? neonOf(n.cluster) : n.person ? css("--vg-person") : neonOf(n.cluster);
      const r = Math.max(1.3, worldRadius(n) * 0.55 * Math.pow(cam.k, 0.8));
      ctx.globalAlpha = a;
      if (n.ghost) { ctx.fillStyle = "#64748b"; ctx.beginPath(); for (let i = 0; i < 6; i++) { const ang = i * Math.PI / 3 + hash(n.id) % 3, rr = r * (0.7 + ((hash(n.id) >>> i) % 5) / 10); i ? ctx.lineTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr) : ctx.moveTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr); } ctx.fill(); }
      else if (n.isolated) { ctx.fillStyle = "rgba(216,180,254,.8)"; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r * 0.6), 0, 2 * Math.PI); ctx.fill(); }
      else {
        if (a > 0.3) { ctx.globalAlpha = a * 0.45; blit("glow", col, p.x, p.y, r * 2.6); ctx.globalAlpha = a; }
        if (n.moc) { ctx.fillStyle = col; ctx.beginPath(); hexagon(p.x, p.y, r * 1.3); ctx.fill(); }
        else blit("orb", col, p.x, p.y, r);
      }
      if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, 2 * Math.PI); ctx.stroke(); }
      p.r = r; p.a = a;
    }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    // bodies
    for (const b of cos.bodies) {
      const [x, y] = toScreen(b.x, b.y), s = bodySize(b), sel = st.body === b.id;
      if (b.type === "star") {
        const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3.2); const sc = theme().star; g.addColorStop(0, `rgba(${sc[0]},1)`); g.addColorStop(0.25, `rgba(${sc[1]},.9)`); g.addColorStop(0.5, `rgba(${sc[2]},.35)`); g.addColorStop(1, `rgba(${sc[2]},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 3.2, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "#fffbea"; ctx.beginPath(); ctx.arc(x, y, s * 0.75, 0, 2 * Math.PI); ctx.fill();
      } else if (b.type === "planet") {
        const g = ctx.createRadialGradient(x - s * 0.35, y - s * 0.35, 0, x, y, s); g.addColorStop(0, "#c7d2fe"); g.addColorStop(0.6, "#6366f1"); g.addColorStop(1, "#1e1b4b");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = "rgba(199,210,254,.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, s * 1.9, s * 0.55, -0.35, 0, 2 * Math.PI); ctx.stroke();
      } else if (b.type === "binary") {
        [0, 1].forEach(i => { const [ax, ay] = toScreen(...anchorPos(b, i)), g = ctx.createRadialGradient(ax, ay, 0, ax, ay, s * 2.4);
          g.addColorStop(0, i ? "rgba(191,219,254,1)" : "rgba(254,240,138,1)"); g.addColorStop(0.35, i ? "rgba(96,165,250,.6)" : "rgba(250,204,21,.6)"); g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ax, ay, s * 2.4, 0, 2 * Math.PI); ctx.fill(); });
        ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
      } else if (b.type === "blackhole") {
        const rot = now / 700;
        for (let i = 0; i < 3; i++) { ctx.strokeStyle = `rgba(251,${146 + i * 30},60,${0.55 - i * 0.15})`; ctx.lineWidth = 3 - i * 0.6;
          ctx.beginPath(); ctx.ellipse(x, y, s * (2 + i * 0.35), s * (0.7 + i * 0.12), 0.35, rot + i, rot + i + Math.PI * 1.6); ctx.stroke(); }
        const g = ctx.createRadialGradient(x, y, s * 0.7, x, y, s * 1.5); g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.7, "rgba(251,191,36,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 1.5, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, 2 * Math.PI); ctx.fill();
      } else if (b.type === "repulsor") {
        for (let i = 0; i < 3; i++) { const ph = ((now / 1600 + i / 3) % 1); ctx.strokeStyle = `rgba(125,211,252,${(1 - ph) * 0.7})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * (0.6 + ph * 3), 0, 2 * Math.PI); ctx.stroke(); }
        ctx.fillStyle = "#e0f2fe"; ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, 2 * Math.PI); ctx.fill();
      }
      const hp = b.type === "blackhole" || b.type === "repulsor" ? null : health(b);
      if (hp != null) {   // system health ring
        ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, s + 9, 0, 2 * Math.PI); ctx.stroke();
        ctx.strokeStyle = hp >= 70 ? "#4ade80" : hp >= 40 ? "#facc15" : "#f87171"; ctx.beginPath(); ctx.arc(x, y, s + 9, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * hp / 100); ctx.stroke();
      }
      if (sel) { ctx.strokeStyle = "#e0f2fe"; ctx.setLineDash([3, 4]); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, s + 15, now / 900, now / 900 + 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]); }
      const count = (bodyCaptured.get(b.id) || []).length + (b.type === "repulsor" ? [...repelled.values()].filter(v => v === b).length : 0);
      ctx.font = `600 10.5px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#e0f2fe";
      const txt = `${bodyName(b).toUpperCase()}`.slice(0, 40); ctx.fillText(txt, x, y + s + 16);
      ctx.fillStyle = "rgba(186,230,253,.65)"; ctx.font = `500 9.5px ${css("--vg-mono")}`;
      ctx.fillText(b.type === "blackhole" ? `${count} TO REVIEW` : b.type === "repulsor" ? `${count} PUSHED` : `${count} IN ORBIT${hp != null ? ` · ${hp}% HEALTHY` : ""}`, x, y + s + 29);
    }
    labelRects = [];
    cos.bodies.forEach(b => { const [x, y] = toScreen(b.x, b.y), s = bodySize(b); labelRects.push([x - 70, y + s + 14, 140, 28]); });
    drawLabels(order.slice().sort((a, b) => P.get(b.id).depth - P.get(a.id).depth), litSet, st.focusDist, font, "#e0f2fe", "#000", true);
    if (st.placing) { ctx.fillStyle = "rgba(224,242,254,.9)"; ctx.font = `600 12px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.fillText(`CLICK IN SPACE TO PLACE A ${BODY[st.placing].label.toUpperCase()}`, W / 2, 64); }
    // supernovas: talked about in your dailies, never linked -- they flare until you link them
    const now2 = now || performance.now();
    for (const [id, cnt] of saidUnlinked) {
      const p = P.get(id); if (!p || p.a < 0.3) continue;
      const pulse = 0.5 + 0.5 * Math.sin(now2 / 300 + hash(id) % 7), R = (8 + Math.min(18, cnt * 1.5)) * Math.max(0.6, Math.pow(cam.k, 0.6)) * (0.8 + pulse * 0.4);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R); g.addColorStop(0, "rgba(255,255,255,.9)"); g.addColorStop(0.3, "rgba(253,186,116,.55)"); g.addColorStop(1, "rgba(253,186,116,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = `rgba(254,215,170,${0.35 + pulse * 0.4})`; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + now2 / 4000; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * R * 0.5, p.y + Math.sin(a) * R * 0.5); ctx.lineTo(p.x + Math.cos(a) * R * 1.5, p.y + Math.sin(a) * R * 1.5); ctx.stroke(); }
      ctx.globalCompositeOperation = "source-over";
    }
    // task moons: each open task is a small moon around its note
    moonSpots = [];
    if (cam.k > 0.45) for (const n of order) {
      if (!n.tasks || special(n)) continue; const p = P.get(n.id); if (!p || p.a < 0.3) continue;
      const k = Math.min(n.tasks, 6);
      for (let i = 0; i < k; i++) {
        const a = now2 / (1400 + i * 260) + i * 2 * Math.PI / k, rr = p.r + 5 + i * 2.2, x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr * 0.55;
        ctx.fillStyle = "rgba(186,230,253,.85)"; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, 2 * Math.PI); ctx.fill();
        moonSpots.push([x, y, n.id]);
      }
    }
    // constellations: your saved views, traced in gold across the background
    constSpots = [];
    savedViews.forEach(v => {
      const set = v.focus && byId[v.focus] ? [v.focus, ...nb[v.focus]] : active.filter(n => !special(n) && !(v.hiddenClusters || []).includes(n.cluster)).map(n => n.id);
      const stars = set.filter(id => P.has(id)).sort((a, b) => byId[b].bc - byId[a].bc).slice(0, 7);
      if (stars.length < 2) return;
      ctx.strokeStyle = "rgba(251,191,36,.28)"; ctx.lineWidth = 1; ctx.setLineDash([1, 4]); ctx.beginPath();
      stars.forEach((id, i) => { const q = P.get(id); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke(); ctx.setLineDash([]);
      stars.forEach(id => { const q = P.get(id); ctx.fillStyle = "rgba(253,230,138,.9)"; ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, 2 * Math.PI); ctx.fill(); });
      const q = P.get(stars[0]), label = `✦ ${v.name.toUpperCase()}`;
      ctx.font = `600 10px ${css("--vg-mono")}`; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillStyle = "rgba(253,230,138,.85)";
      const w = ctx.measureText(label).width; ctx.fillText(label, q.x + 6, q.y - 6); constSpots.push([q.x + 6, q.y - 18, w, 14, v]);
    });
    // ship mode reticle
    if (st.ship) {
      ctx.strokeStyle = "rgba(125,211,252,.8)"; ctx.lineWidth = 1.2; const cx = W / 2, cy = H / 2;
      ctx.beginPath(); ctx.arc(cx, cy, 14, 0, 2 * Math.PI); ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 18, cy); ctx.moveTo(cx + 18, cy); ctx.lineTo(cx + 26, cy);
      ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy - 18); ctx.moveTo(cx, cy + 18); ctx.lineTo(cx, cy + 26); ctx.stroke();
      const sp = Math.hypot(ship.vx, ship.vy);
      if (sp > 1) { ctx.strokeStyle = "rgba(224,242,254,.25)"; for (let i = 0; i < 14; i++) { const h = hash("s" + i), x = (h % 1000) / 1000 * W, y = ((h >>> 10) % 1000) / 1000 * H;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ship.vx * 3, y + ship.vy * 3); ctx.stroke(); } }
      ctx.fillStyle = "rgba(186,230,253,.8)"; ctx.font = `600 10px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(MOBILE ? "SHIP · TAP A BODY OR SPACE TO WARP" : "SHIP · WASD TO FLY · Q/E ZOOM · CLICK TO WARP", cx, 60);
    }
  }
  function placeBody(type, sx, sy) {
    const [x, y] = toWorld(sx, sy), b = { id: "b" + Date.now().toString(36), type, x, y, target: null, name: "" };
    if (type === "blackhole") b.target = "stale";
    if (type === "binary") b.target = mocs.slice(0, 2).map(m => m.id).filter(id => byId[id]);
    cos.bodies.push(b);
    if (cos.auto.motion) { if (type === "planet") releaseBody(b, 0, 0); else circularHere(b, null); }
    st.placing = null; root.classList.remove("is-placing"); $$(".vg-dockbtn").forEach(x => x.setAttribute("aria-pressed", "false"));
    cosmosCapture(); selectBody(b.id); persistSoon(); alpha = Math.max(alpha, 0.4); kick();
    if (type === "star" || type === "planet" || type === "repulsor") toast(type === "star" ? "Pick the note or MOC this star is" : "Type a search for this " + BODY[type].label.toLowerCase());
  }
  function selectBody(id) {
    select(null); st.body = id; const b = cos.bodies.find(x => x.id === id); if (!b) { st.body = null; return; }
    st.follow = cos.auto.motion ? id : null;
    const box = $(".vg-inspector"); box.hidden = false; root.classList.add("has-inspector");
    const got = (bodyCaptured.get(b.id) || []).filter(i => byId[i]), hp = health(b);
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
    const noteOpts = cur => mocs.filter(m => byId[m.id]).map(m => opt(m.id, "Map · " + m.title, cur)).join("") + ranked.slice(0, 40).map(i => opt(i, byId[i].name, cur)).join("");
    const cfg = b.type === "star" ? `<div class="vg-field"><span class="vg-flabel">Centre</span><button class="vg-btn" data-b="pick">${icon("search", 14)} ${b.target && byId[b.target] ? esc(byId[b.target].name) : "Choose a note or MOC…"}</button></div>`
      : b.type === "binary" ? `<div class="vg-field"><span class="vg-flabel">Stars</span><select class="vg-select" data-b="ba">${noteOpts((b.target || [])[0])}</select><select class="vg-select" data-b="bb">${noteOpts((b.target || [])[1])}</select></div>`
      : b.type === "blackhole" ? `<div class="vg-field"><span class="vg-flabel">Swallows</span><select class="vg-select" data-b="filter">${Object.entries(BH_FILTERS).map(([k, l]) => opt(k, l, b.target)).join("")}</select></div>`
      : `<div class="vg-field"><span class="vg-flabel">Search</span><input class="vg-input" data-b="query" value="${esc(b.target || "")}" placeholder="tag:technology/aws · folder:02-Projects · cluster:5 · moc:Odoo · words" list="vg-q-suggest">
         <datalist id="vg-q-suggest">${[...new Set(nodes.flatMap(n => n.tags || []))].sort().slice(0, 200).map(x => `<option value="tag:${esc(x)}">`).join("")}${mocs.map(m => `<option value="moc:${esc(m.title)}">`).join("")}</datalist></div>`;
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:#fbbf24">${BODY[b.type].glyph} ${BODY[b.type].label}</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${esc(bodyName(b))}</h2><div class="vg-muted vg-ins-path">${esc(BODY[b.type].hint)}</div>
      <div class="vg-field"><span class="vg-flabel">Name</span><input class="vg-input" data-b="name" value="${esc(b.name || "")}" placeholder="${esc(bodyName(b))}"></div>
      ${cfg}
      ${cos.auto.motion && b.rx != null ? `<div class="vg-physline">${esc(orbitText(b))}</div>` : ""}
      ${gmOf(b) ? `<div class="vg-physline">GM ${Math.round(gmOf(b))} · ${b.type === "blackhole" ? `r<sub>s</sub> ${rsOf(b)} · ISCO ${3 * rsOf(b)}` : b.type === "binary" ? `binary period ${Math.round(2 * Math.PI / Math.sqrt(2 * gmOf(b) / Math.pow(BIN_SEP, 3)) / 60)} s` : `orbit 1 link out: ${periodSec(b, 85).toFixed(1)} s · 3 links: ${periodSec(b, 195).toFixed(1)} s`} <span class="vg-muted">(Kepler: T = 2π√(r³/GM))</span></div>` : ""}
      <div class="vg-field"><label class="vg-flabel">Gravity <b class="vg-mass-val">${(b.mass || 1).toFixed(1)}×</b></label><input type="range" class="vg-range" data-b="mass" min="0.3" max="3" step="0.1" value="${b.mass || 1}" aria-label="Gravity"></div>
      ${hp != null ? `<div class="vg-kvs"><div class="vg-kv"><b>${got.length}</b><span>in orbit</span></div><div class="vg-kv"><b>${hp}%</b><span>healthy</span></div><div class="vg-kv"><b>${got.filter(i => inMoc(i) === false).length}</b><span>not in a map</span></div></div>` : ""}
      <div class="vg-ins-actions vg-wrap"><button class="vg-btn" data-b="light">${icon("target", 14)} Light up</button><button class="vg-btn vg-btn-ghost" data-b="del">Remove body</button></div>
      <div class="vg-ins-sec"><div class="vg-ins-h">${b.type === "blackhole" ? "Review queue" : "Captured"} <span class="vg-count">${got.length}</span></div>
        ${got.sort((x, y) => byId[y].bc - byId[x].bc).slice(0, 40).map(i => b.type === "blackhole"
          ? `<div class="vg-bh-row">${noteRow(i, `${byId[i].age} days since edit · ${esc(clusterName(byId[i].cluster))}`)}<span class="vg-bh-acts">
             ${opts.stampReviewed ? `<button class="vg-btn vg-btn-sm" data-bhr="${esc(i)}" title="Stamp reviewed: today in its frontmatter">Reviewed</button>` : ""}
             ${opts.moveNote ? `<button class="vg-btn vg-btn-sm" data-bha="${esc(i)}" title="Move to ${FOLDERS.archive} (links keep working)">Archive</button>` : ""}
             <button class="vg-btn vg-btn-sm vg-btn-ghost" data-bhk="${esc(i)}" title="Keep it out of this black hole">Keep</button></span></div>`
          : noteRow(i, esc(clusterName(byId[i].cluster)))).join("") || `<div class="vg-empty">Nothing captured yet — configure it above.</div>`}</div>`;
    const q = s => box.querySelector(`[data-b="${s}"]`), changed = () => { cosmosCapture(); persistSoon(); alpha = Math.max(alpha, 0.4); kick(); selectBody(b.id); };
    box.querySelector(".vg-ins-close").onclick = () => { st.body = null; box.hidden = true; root.classList.remove("has-inspector"); };
    q("name").onchange = e => { b.name = e.target.value.trim(); changed(); };
    q("mass").oninput = e => { b.mass = +e.target.value; box.querySelector(".vg-mass-val").textContent = b.mass.toFixed(1) + "×"; alpha = Math.max(alpha, 0.4); kick(); persistSoon(); };
    if (q("pick")) q("pick").onclick = () => openPalette({ pickFor: b.id });
    if (q("ba")) q("ba").onchange = e => { b.target = [e.target.value, (b.target || [])[1]]; changed(); };
    if (q("bb")) q("bb").onchange = e => { b.target = [(b.target || [])[0], e.target.value]; changed(); };
    if (q("filter")) q("filter").onchange = e => { b.target = e.target.value; changed(); };
    if (q("query")) q("query").onchange = e => { b.target = e.target.value.trim(); changed(); };
    q("light").onclick = () => setHighlight(new Set(got), bodyName(b));
    box.querySelectorAll("[data-bhr]").forEach(x => x.onclick = async e => { e.stopPropagation(); const id = x.dataset.bhr;
      if (await VGActions.run("current", byId[id], actionCtx(), e)) changed(); });
    box.querySelectorAll("[data-bha]").forEach(x => x.onclick = async e => { e.stopPropagation(); const id = x.dataset.bha;
      if (await VGActions.run("archive", byId[id], actionCtx(), e)) { cos.kept = [...(cos.kept || []), id]; changed(); } });
    box.querySelectorAll("[data-bhk]").forEach(x => x.onclick = e => { e.stopPropagation(); cos.kept = [...new Set([...(cos.kept || []), x.dataset.bhk])]; logDiscovery(`Kept ${byId[x.dataset.bhk].name}`); changed(); });
    q("del").onclick = () => { cos.bodies = cos.bodies.filter(x => x !== b); st.body = null; box.hidden = true; root.classList.remove("has-inspector"); cosmosCapture(); persistSoon(); kick(); };
    wire(box); wireSheet(box);
  }
  function seedCosmos() {   // first visit: each map of content becomes a star, plus a black hole for stale notes
    const ms = mocs.filter(m => byId[m.id]).slice(0, 6);
    ms.forEach((m, i) => { const a = i / Math.max(1, ms.length) * 2 * Math.PI; cos.bodies.push({ id: "b" + i + Date.now().toString(36), type: "star", x: Math.cos(a) * 340, y: Math.sin(a) * 260, target: m.id, name: "" }); });
    cos.bodies.push({ id: "bh" + Date.now().toString(36), type: "blackhole", x: -40, y: -470, target: "stale", name: "" });
  }

  // ---- game layer: XP, ranks, streak and achievements over the Today list, all measured from the vault itself
  const RANKS = [[0, "Cadet"], [50, "Navigator"], [150, "Cartographer"], [300, "Astronomer"], [600, "Architect"]];
  const rankOfXp = xp => RANKS.filter(r => xp >= r[0]).pop()[1];
  const ACH = [
    { id: "first", name: "First contact", hint: "Do one of the day's three", test: () => (cos.done || []).length >= 1 || !!(cos.daily && cos.daily.quests.some(q => q.done)) },
    { id: "wormholes", name: "Wormhole engineer", hint: "Link 5 suggested pairs", test: () => (cos.log || []).filter(e => /^Linked/.test(e.text)).length >= 5 },
    { id: "cartographer", name: "Cartographer", hint: "Every topic of 6+ notes has a map", test: () => DATA.clusters.filter(c => c.size >= 6).every(c => mocOf[c.id]) },
    { id: "complete", name: "Complete atlas", hint: "A map lists every note in its topic", test: () => mocs.some(m => m.clusters.every(c => !(m.missing[c] || []).length)) },
    { id: "nebula", name: "Nebula tamer", hint: "Fewer than 150 unlinked notes", test: () => nodes.filter(n => n.isolated && !special(n)).length < 150 },
    { id: "gardener", name: "Gardener", hint: "Act on 5 suggestions between two analyses", test: () => ((DATA.changes || {}).acted || []).length >= 5 },
    { id: "constellations", name: "Constellations", hint: "Save 3 views", test: () => savedViews.length >= 3 },
  ];

  // ---- game: XP for real actions, streaks, daily quests, weekly challenge, vault health, themes
  // XP only ever comes from things that changed the vault (or your review queue) -- never from clicking around.
  const XP_FOR = [[/^Linked/, 10], [/^Added/, 5], [/^Checked off/, 3], [/^Cancelled/, 1], [/^Completed/, 5], [/^Reviewed/, 3], [/^Moved/, 3], [/^Archived/, 2], [/^Logged an update/, 4],
    [/^(Hub note|Bridge note|Map note)/, 15], [/^Applied/, 10], [/^Dismissed/, 1], [/^Kept/, 1]];
  const THEMES = {
    classic: { name: "Classic", xp: 0, star: ["255,247,214", "253,224,71", "251,146,60"], grid: "#5b8cff" },
    aurora: { name: "Aurora", xp: 50, star: ["220,255,240", "74,222,128", "168,85,247"], grid: "#34d399" },
    solar: { name: "Solar flare", xp: 150, star: ["255,240,230", "251,113,133", "249,115,22"], grid: "#fb7185" },
    gold: { name: "Gold", xp: 300, star: ["255,251,235", "250,204,21", "202,138,4"], grid: "#facc15" },
    prism: { name: "Prism", xp: 600, star: ["240,249,255", "56,189,248", "232,121,249"], grid: "#a78bfa" },
  };
  const theme = () => THEMES[cos.theme] && cos.xp >= THEMES[cos.theme].xp ? THEMES[cos.theme] : THEMES.classic;
  function awardXp(n, why) {
    if (!n) return;
    const before = rankOfXp(cos.xp); cos.xp += n;
    const after = rankOfXp(cos.xp);
    if (after !== before) { celebrate(`Rank up: ${after}`); toast(`Rank up — you're now ${after}!`, "ok"); const th = Object.values(THEMES).find(x => x.xp === RANKS.find(r => r[1] === after)[0]); if (th) toast(`Unlocked the ${th.name} Cosmos theme`, "ok"); }
    persistSoon();
  }
  function streak() {
    const days = new Set((cos.log || []).filter(e => !/^Warped/.test(e.text)).map(e => e.date));
    let d = new Date(), n = 0;
    if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);   // today not done yet: the streak still stands
    while (days.has(localDay(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function vaultHealth() {
    const notes = nodes.filter(n => !special(n)), iso = notes.filter(n => n.isolated).length;
    const big = DATA.clusters.filter(c => c.size >= 6), size = big.reduce((s, c) => s + c.size, 0);
    const covered = big.reduce((s, c) => { const m = mocOf[c.id]; return s + (m ? c.size - (m.missing[c.id] || []).length : 0); }, 0);
    const fresh = notes.filter(n => !staleFor(n, Q.stale_days)).length / Math.max(1, notes.length);
    return Math.round(100 * (0.4 * (1 - iso / Math.max(1, notes.length)) + 0.35 * (size ? covered / size : 0) + 0.25 * fresh));
  }
  const questDone = q => VGRules.questDone(q, liveGraph);
  function ensureDaily() {
    if (cos.daily && cos.daily.date === today()) return;
    cos.daily = { date: today(), bonus: false, quests: VGRules.todayPick(todayItems()) };
  }
  // the next item not already picked, to fill a pick that was hidden or skipped
  const nextPick = () => { const have = new Set(cos.daily.quests.map(q => q.key)); return VGRules.todayPick(todayItems().filter(it => !have.has(it.key)), 1)[0]; };
  // "Not for me" (from the sidebar or another device): the item goes, and stays gone; a pick is replaced with the next
  // item so the day still has three
  function hideGameItem(key) {
    cos.hidden = [...new Set([...(cos.hidden || []), key])].slice(-500);
    if (cos.daily && cos.daily.quests && cos.daily.quests.some(q => q.key === key)) {
      cos.daily.quests = cos.daily.quests.filter(q => q.key !== key);
      const next = nextPick(); if (next) cos.daily.quests.push(next);
    }
    updateGame(false); persistSoon();
  }
  const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localDay(d); };
  const weeklyCount = () => (cos.log || []).filter(e => e.date >= weekStart() && /^Linked/.test(e.text)).length;
  function updateDaily(announce) {
    ensureDaily();
    cos.daily.quests.forEach(q => { if (!q.done && questDone(q)) { q.done = true; awardXp(8, "quest"); if (announce) toast(`Daily quest done: ${q.title} · +8 XP`, "ok"); } });
    if (!cos.daily.bonus && cos.daily.quests.length && cos.daily.quests.every(q => q.done)) { cos.daily.bonus = true; awardXp(25, "daily bonus"); if (announce) { celebrate("All daily quests"); toast("All three daily quests done · +25 XP", "ok"); } }
    const wk = weekStart();
    if (!cos.weekly || cos.weekly.week !== wk) cos.weekly = { week: wk, claimed: false };
    if (!cos.weekly.claimed && weeklyCount() >= 10) { cos.weekly.claimed = true; awardXp(50, "weekly"); if (announce) { celebrate("Weekly challenge"); toast("Weekly challenge: 10 links this week · +50 XP", "ok"); } }
  }
  // celebration bursts (screen space; drawn over any view)
  const bursts = [];
  function celebrate(label) {
    if (reducedMotion() || !W) return;
    const cols = ["#fbbf24", "#38bdf8", "#4ade80", "#f472b6", "#a78bfa"];
    bursts.push({ x: W / 2, y: H / 2, t0: performance.now(), label, parts: Array.from({ length: 70 }, (_, i) => { const a = Math.random() * 2 * Math.PI, v = 2 + Math.random() * 6; return [Math.cos(a) * v, Math.sin(a) * v - 2, cols[i % cols.length]]; }) });
    kick();
  }
  function drawBursts(now) {
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i], t = (now - b.t0) / 1000; if (t > 1.8) { bursts.splice(i, 1); continue; }
      for (const [vx, vy, c] of b.parts) { const x = b.x + vx * t * 60, y = b.y + vy * t * 60 + 90 * t * t; ctx.globalAlpha = Math.max(0, 1 - t / 1.8); ctx.fillStyle = c; ctx.fillRect(x, y, 3, 3); }
      ctx.globalAlpha = Math.max(0, 1 - t / 1.8); ctx.fillStyle = "#fde68a"; ctx.font = `700 18px ${css("--vg-mono")}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(b.label.toUpperCase(), b.x, b.y - 40 - t * 20);
    }
    ctx.globalAlpha = 1;
    return bursts.length > 0;
  }

  // A pick built on a suggestion that no longer exists (relinked elsewhere, dismissed, or the analysis no longer
  // finds the pair related) is dropped, not left as a dead end.
  const stillSuggested = (a, b) => links.some(l => (l.kind === "gap" || l.kind === "similar") && ((l.s.id === a && l.t.id === b) || (l.s.id === b && l.t.id === a)));
  const stillValid = m => VGRules.missionValid(m, liveGraph);
  function updateGame(announce) {
    if (cos.daily && cos.daily.quests) cos.daily.quests = cos.daily.quests.filter(q => q.done || stillValid(q));
    updateDaily(announce);
    ACH.forEach(a => { if (!cos.ach[a.id] && a.test()) { cos.ach[a.id] = today(); if (announce) { toast(`Achievement unlocked: ${a.name}`, "ok"); celebrate(a.name); } } });
    renderTodayList(); persistSoon();
  }
  // The Today panel is the same in every view: the cosmos shows it by default, the toolbar star (G) shows or hides
  // it anywhere, and that choice sticks for this pane
  let missionsPref = null;
  function setMissionsShown(on, byHand) {
    if (byHand) missionsPref = on;
    if (on) closeDrawer();
    root.classList.toggle("show-missions", !!on);
    const b = $(".vg-gamebtn"); if (b) b.setAttribute("aria-pressed", String(!!on));
    if (on) renderMissions();
  }
  $(".vg-gamebtn").onclick = () => setMissionsShown(!root.classList.contains("show-missions"), true);
  let missionsInit = false;
  function renderMissions() {
    const box = $(".vg-missions"); if (!box) return;
    if (!missionsInit) { missionsInit = true; if (narrow()) box.classList.add("is-collapsed"); }
    ensureDaily();
    const next = RANKS.find(r => r[0] > cos.xp), prev = RANKS.filter(r => r[0] <= cos.xp).pop(), pct = next ? Math.round(100 * (cos.xp - prev[0]) / (next[0] - prev[0])) : 100;
    const sk = streak(), wk = weeklyCount();
    box.innerHTML = `<button class="vg-ms-head" aria-expanded="${!box.classList.contains("is-collapsed")}"><b>TODAY</b><span>${sk ? `🔥${sk} · ` : ""}${rankOfXp(cos.xp).toUpperCase()} · ${cos.xp} XP</span></button>
      <div class="vg-ms-rank"><i style="width:${pct}%"></i></div>
      <div class="vg-ms-body">
        <div class="vg-ms-stats"><span><b>${vaultHealth()}</b> vault health</span><span><b>${sk}</b>-day streak</span><span>${next ? `<b>${next[0] - cos.xp}</b> XP to ${next[1]}` : "<b>MAX</b> rank"}</span></div>
        <div class="vg-ms-sec">TODAY ${cos.daily.bonus ? "· ✓ +25 BONUS" : "· +8 EACH OF THE THREE, +25 FOR ALL"}</div>
        <div class="vg-ms-today">${todayHtml(4)}</div>
        <div class="vg-ms-sec">WEEKLY · LINK 10 NOTES ${cos.weekly && cos.weekly.claimed ? "· ✓ +50" : "· +50"}</div>
        <div class="vg-ms-bar"><i style="width:${Math.min(100, wk * 10)}%"></i></div><div class="vg-ms-how">${Math.min(wk, 10)} / 10 this week</div>
        <details class="vg-ms-log"><summary>DISCOVERY LOG · ${(cos.log || []).length}</summary>${(cos.log || []).slice(0, 25).map(e => `<div><span>${esc(e.date.slice(5))}</span> ${esc(e.text)}</div>`).join("") || "<div>Nothing yet — act on a suggestion.</div>"}</details>
        <div class="vg-ms-sec is-theme">COSMOS THEME</div><div class="vg-ms-themes">${Object.entries(THEMES).map(([k, th]) => `<button class="vg-ms-theme ${theme() === th ? "is-on" : ""}" data-theme="${k}" ${cos.xp < th.xp ? "disabled" : ""} title="${cos.xp < th.xp ? `Unlocks at ${RANKS.find(r => r[0] === th.xp)[1]} (${th.xp} XP)` : th.name}" style="--a:rgb(${th.star[1]});--b:rgb(${th.star[2]})"><i></i>${esc(th.name)}${cos.xp < th.xp ? " 🔒" : ""}</button>`).join("")}</div>
        <div class="vg-ms-ach">${ACH.map(a => `<span class="vg-ach ${cos.ach[a.id] ? "is-on" : ""}" title="${esc(a.name)} — ${esc(a.hint)}${cos.ach[a.id] ? " (unlocked " + cos.ach[a.id] + ")" : ""}">${esc(a.name)}</span>`).join("")}</div></div>`;
    box.querySelector(".vg-ms-head").onclick = () => { box.classList.toggle("is-collapsed"); renderMissions(); };
    wireToday(box); wireMore(box);
    box.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => { cos.theme = b.dataset.theme; persistSoon(); renderMissions(); dirty = true; kick(); });
  }
  $$(".vg-dockbtn").forEach(b => b.onclick = () => {
    const on = st.placing !== b.dataset.body; st.placing = on ? b.dataset.body : null;
    $$(".vg-dockbtn").forEach(x => x.setAttribute("aria-pressed", x === b && on)); root.classList.toggle("is-placing", on);
    if (on) toast(`${BODY[b.dataset.body].hint}. Click in space to place it.`); dirty = true; kick();
  });
  $$(".vg-arrangebtn").forEach(b => b.onclick = () => arrangeOrbits(true));
  $$(".vg-autobtn").forEach(b => b.onclick = () => { const k = b.dataset.auto; cos.auto[k] = !cos.auto[k]; b.setAttribute("aria-pressed", cos.auto[k]); if (isCosmos()) cosmosCapture(); persistSoon(); alpha = Math.max(alpha, 0.2); kick(); });
  // ---- deeper cosmos: moons, supernovas, constellations, time travel, expeditions, ship
  let moonSpots = [], constSpots = [];
  const ship = { vx: 0, vy: 0, keys: new Set() };
  function shipStep() {
    const acc = 0.9 / Math.max(0.3, Math.sqrt(cam.k)), k = ship.keys;
    if (k.has("w") || k.has("arrowup")) ship.vy += acc; if (k.has("s") || k.has("arrowdown")) ship.vy -= acc;
    if (k.has("a") || k.has("arrowleft")) ship.vx += acc; if (k.has("d") || k.has("arrowright")) ship.vx -= acc;
    if (k.has("q")) cam.k = Math.max(0.05, cam.k * 0.985); if (k.has("e")) cam.k = Math.min(8, cam.k * 1.015);
    ship.vx *= 0.92; ship.vy *= 0.92; cam.tx += ship.vx; cam.ty += ship.vy; cam.userMoved = true;
    return Math.abs(ship.vx) + Math.abs(ship.vy) > 0.05 || k.size > 0;
  }
  function warpTo(sx, sy) {
    const b = bodyHit(sx, sy), [wx, wy] = b ? [b.x, b.y] : toWorld(sx, sy);
    animateTo({ tx: -(wx - cam.cx) * cam.k, ty: -(wy - cam.cy) * cam.k, k: b ? Math.max(cam.k, 1.2) : cam.k }, 900);
    if (b) logDiscovery(`Warped to ${bodyName(b)}`);
  }
  function setShip(on) {
    st.ship = on; ship.vx = ship.vy = 0; ship.keys.clear();
    $$(".vg-shipbtn").forEach(x => x.setAttribute("aria-pressed", on)); root.classList.toggle("is-ship", on);
    if (on) toast(MOBILE ? "Ship mode — tap a body or open space to warp there" : "Ship mode — WASD to fly, Q/E to zoom, click to warp"); dirty = true; kick();
  }
  root.addEventListener("keyup", e => ship.keys.delete(e.key.toLowerCase()));
  // time travel: show the vault as it was -- notes appear on the day they were born
  const bornDays = nodes.filter(n => n.born && !special(n)).map(n => n.born).sort();
  const timeMonths = (() => { if (!bornDays.length) return []; const out = []; let d = new Date(bornDays[0].slice(0, 7) + "-01T12:00"); const end = new Date();
    while (d <= end) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } return out; })();
  let timePlay = 0;
  function setTime(idx) {
    if (idx == null || idx >= timeMonths.length - 1) { st.timeAt = null; } else { const m = timeMonths[idx]; const end = new Date(m + "-01T12:00"); end.setMonth(end.getMonth() + 1); end.setDate(0); st.timeAt = end.toISOString().slice(0, 10); }
    rebuild(true); if (isCosmos()) cosmosCapture();
    const lab = $(".vg-time-label"); if (lab) lab.textContent = st.timeAt ? `${st.timeAt.slice(0, 7)} · ${active.filter(n => !special(n)).length} notes` : "Now";
    renderToday();   // the strip describes the map as of that month
  }
  function toggleReplay() { if (replay) stopReplay(); else startReplay(); }
  function startReplay() {
    if (isCosmos()) { toast("Replay works in 2D, 3D and neural", "warn"); return; }
    const pool = nodes.filter(n => baseVisible(n));
    const dated = pool.filter(n => n.born).sort((a, b) => a.born < b.born ? -1 : a.born > b.born ? 1 : b.bc - a.bc);
    if (dated.length < 5) { toast("Not enough creation dates to replay", "warn"); return; }
    const order = [...dated, ...pool.filter(n => !n.born)].map(n => n.id);   // undated notes (maps, people…) arrive last
    if (st.focusDist) exitFocus();
    select(null); clearHighlight(); clearMulti();
    if (neural()) brainLayout(false);   // lay out the whole brain once; notes then light up in place
    else if (!isCosmos()) alpha = 0;     // hold the map still: notes appear where they live
    fit(neural() ? n => !special(n) : null, 400);
    replay = { order, shown: new Set(), k: 0, t0: performance.now() + 450, dur: Math.max(6000, Math.min(20000, order.length * 25)), built: 0 };
    $(".vg-replay").hidden = false; $(".vg-replaybtn").setAttribute("aria-pressed", "true"); syncToolsBtn(); $(".vg-replaybtn").innerHTML = icon("stop");
    rebuild(false); kick();
  }
  function stepReplay(now) {
    const R = replay, p = Math.max(0, Math.min(1, (now - R.t0) / R.dur)), k = Math.ceil(p * R.order.length);
    for (; R.k < k; R.k++) { R.shown.add(R.order[R.k]); popAt.set(R.order[R.k], now); }
    if (now - R.built > 70 || p >= 1) {   // re-filter the drawn set a few times a second, not every frame
      R.built = now; rebuild(false);
      const last = byId[R.order[Math.max(0, R.k - 1)]], day = last && last.born;
      $(".vg-replay-date").textContent = day ? new Date(day + "T12:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
      $(".vg-replay-count").textContent = `${R.k} / ${R.order.length} notes`;
      $(".vg-replay-bar i").style.width = (p * 100).toFixed(1) + "%";
    }
    if (p >= 1) setTimeout(() => { if (replay === R) stopReplay(); }, 900);
  }
  function stopReplay() {
    if (!replay) return;
    replay = null; popAt.clear();
    $(".vg-replay").hidden = true; $(".vg-replaybtn").setAttribute("aria-pressed", "false"); syncToolsBtn(); $(".vg-replaybtn").innerHTML = icon("play");
    rebuild(false); dirty = true; kick();
  }
  $(".vg-replaybtn").onclick = () => toggleReplay();
  $(".vg-replay-stop").onclick = () => stopReplay();
  function toggleTimebar(on) {
    const bar = $(".vg-timebar"); bar.hidden = !on; $$(".vg-timebtn").forEach(x => x.setAttribute("aria-pressed", on)); syncToolsBtn();
    if (!on) { clearInterval(timePlay); timePlay = 0; setTime(null); return; }
    const r = bar.querySelector("input"); r.max = Math.max(0, timeMonths.length - 1); r.value = r.max; setTime(null);
  }
  $(".vg-timebar input").oninput = e => setTime(+e.target.value);
  $(".vg-time-play").onclick = () => {
    const r = $(".vg-timebar input");
    if (timePlay) { clearInterval(timePlay); timePlay = 0; $(".vg-time-play").textContent = "▶"; return; }
    if (+r.value >= +r.max) r.value = 0;
    $(".vg-time-play").textContent = "❚❚";
    timePlay = setInterval(() => { r.value = +r.value + 1; setTime(+r.value); if (+r.value >= +r.max) { clearInterval(timePlay); timePlay = 0; $(".vg-time-play").textContent = "▶"; } }, 700);
  };
  $$(".vg-timebtn").forEach(b => b.onclick = () => toggleTimebar($(".vg-timebar").hidden));
  $$(".vg-shipbtn").forEach(b => b.onclick = () => setShip(!st.ship));
  $$(".vg-pausebtn").forEach(b => b.onclick = () => setPaused(!st.paused));
  $(".vg-pausepill").onclick = () => setPaused(false);
  const WARPS = [0.25, 0.5, 1, 2, 4];
  $$(".vg-warpbtn").forEach(b => b.onclick = () => { st.warp = WARPS[(WARPS.indexOf(st.warp || 1) + 1) % WARPS.length]; $$(".vg-warpval").forEach(x => x.textContent = st.warp + "×"); });
