  // ---------------------------------------------------------------- map views: subway, terrain, city
  // Each lays the notes out once on a flat plane (no physics) and draws its own picture. Drawn notes go into P
  // with a screen spot and radius, so hover, click, search, the inspector, lenses and replay keep working.
  // ---------------------------------------------------------------- scene registry
  // A scene registers everything about itself in one call, in its own file (_scripts/vault_graph_scenes/*.js, put here by
  // the build): scene(key, { name, icon, blurb, toast, layout(geo) -> { pos: Map(id -> [x, y]), ... }, draw(now), fps,
  // iso ("iso" | "tilt": drawn with isoKit, framed to match), press(phase, x, y) -> true (takes a drag off the notes, e.g. painting),
  // pointer(phase, event, x, y) -> true, wheel(event), escape() -> true, game: true (a game owns the canvas: raw pointers, keeps
  // running under reduced motion, no time-lapse),
  // fit(n) -> bool (what "fit" frames), lit(id) -> Set|null (what selecting a note lights), legend(item) -> html,
  // today() -> { text, label, run } | null }. The tables below (names, picker tiles, layouts, drawing, animation,
  // legend, today strip, toast) read it, so a new scene touches no other code.
  const SCENES = {};
  function scene(key, def) { SCENES[key] = def; }
  /*@scenes*/
  // scenes written in notes (the plugin collects every ```vault-graph-scene block into DATA.scenes); a block with
  // errors still draws from the words it got right, and its note shows the errors
  (DATA.scenes || []).forEach(b => { const { spec } = VGRules.sceneSpec(b.raw), key = VGRules.sceneKey(b.path, b.i);
    if (!SCENES[key]) scene(key, specScene(key, spec, b.path)); });
  const MAPS = { subway: "Subway", weather: "Weather", foodweb: "Food web", clock: "Heat clock", radar: "Radar",
    ...Object.fromEntries(Object.entries(SCENES).map(([k, d]) => [k, d.name])) };
  const mapView = () => !!MAPS[st.view];
  let geoCache = null, mapCache = {}, impMax = null;
  // how much the vault leans on a note, 0-1 (links in, daily mentions, influence)
  // One measure everywhere (City, Subway, Terrain, the Important-but-stale lens): links in, daily mentions,
  // influence, and recent mentions
  const importance = n => {
    if (!impMax) { const ns = nodes.filter(m => !special(m) && !m.ghost), mx = f => Math.max(1e-9, ...ns.map(f));
      impMax = { i: mx(m => Math.log1p(m.inlinks || 0)), m: mx(m => Math.log1p(m.mentions || 0)), b: mx(m => m.bc || 0),
        r: mx(m => Math.log1p(m.recent || 0)) }; }
    return 0.4 * Math.log1p(n.inlinks || 0) / impMax.i + 0.3 * Math.log1p(n.mentions || 0) / impMax.m + 0.2 * (n.bc || 0) / impMax.b
      + 0.1 * Math.log1p(n.recent || 0) / impMax.r;
  };
  // Where notes sit on the familiar 2D map (saved layout, or the 2D view just left); topics round a circle otherwise
  function geography() {
    const L = layouts["2d"], pos = new Map();
    if (!layoutSeed()) nodes.forEach(n => { const p = L[n.id] || (geoCache && geoCache.get(n.id)); if (p) pos.set(n.id, [p[0], p[1]]); });
    if (pos.size < nodes.length * 0.5) {
      pos.clear();
      const cs = topicOrder(), ang = {};
      cs.forEach((c, i) => { ang[c.id] = i / cs.length * 2 * Math.PI; });
      nodes.forEach(n => { const h = seededHash(n.id), a = ang[n.cluster] ?? (h % 628) / 100, r = n.cluster >= 0 ? 420 : 760;
        pos.set(n.id, [Math.cos(a) * r + (h % 160) - 80, Math.sin(a) * r + ((h >>> 9) % 160) - 80]); });
    }
    nodes.forEach(n => { if (!pos.has(n.id)) { const m = [...nb[n.id]].find(id => pos.has(id)); pos.set(n.id, m ? pos.get(m).map(v => v + (hash(n.id) % 31) - 15) : [0, 0]); } });
    // spread to a common size (outliers ignored), centred on 0
    const core = nodes.filter(n => !special(n) && !n.ghost).map(n => pos.get(n.id));
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * f)))];
    const xs = core.map(p => p[0]).sort((a, b) => a - b), ys = core.map(p => p[1]).sort((a, b) => a - b);
    const cx = q(xs, 0.5), cy = q(ys, 0.5), s = Math.min(1300 / Math.max(1, q(xs, 0.95) - q(xs, 0.05)), 850 / Math.max(1, q(ys, 0.95) - q(ys, 0.05)));
    const out = new Map(); pos.forEach((p, id) => out.set(id, [(p[0] - cx) * s, (p[1] - cy) * s]));
    return out;
  }

  // Subway: each topic is a line through its most relied-on notes; notes from other topics that its notes
  // link to most become transfer stations. Positions keep the 2D geography, snapped to a grid; track runs
  // at 0/45/90 degrees like a transit map.
  function subwayLayout(geo0) {
    const GRID = 46, SPREAD = 1.7, stations = new Map(), taken = new Map(), lines = [];
    const geo = new Map(); geo0.forEach((p, id) => geo.set(id, [p[0] * SPREAD, p[1] * SPREAD]));   // room for straight lines
    const placeNear = (id, x, y) => {
      if (stations.has(id)) return stations.get(id);
      const gx0 = Math.round(x / GRID), gy0 = Math.round(y / GRID);
      let gx = gx0, gy = gy0;
      outer: for (let r = 0; r < 16; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || taken.has(`${gx0 + dx},${gy0 + dy}`)) continue;
        gx = gx0 + dx; gy = gy0 + dy; break outer;
      }
      const s = { id, x: gx * GRID, y: gy * GRID, lines: [] }; taken.set(`${gx},${gy}`, id); stations.set(id, s); return s;
    };
    DATA.clusters.filter(c => c.size >= 4).sort((a, b) => b.size - a.size).slice(0, 18).forEach(c => {
      const own = topicNotes(c.id).sort(byImportance).slice(0, 9).map(n => n.id);
      const into = {};
      links.forEach(l => { if (l.kind !== "link") return;
        [[l.s, l.t], [l.t, l.s]].forEach(([a, b]) => { if (a.cluster === c.id && b.cluster !== c.id && b.cluster >= 0 && !special(b)) into[b.id] = (into[b.id] || 0) + 1; }); });
      const transfers = Object.entries(into).sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, k]) => k >= 2).map(([id]) => id);
      if (own.length + transfers.length < 2) return;
      // the line runs straight through its topic's centre, along its main direction snapped to 45 degrees
      const pts = own.map(id => geo.get(id)), mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      let sxx = 0, syy = 0, sxy = 0; pts.forEach(p => { sxx += (p[0] - mx) ** 2; syy += (p[1] - my) ** 2; sxy += (p[0] - mx) * (p[1] - my); });
      const th = Math.round(0.5 * Math.atan2(2 * sxy, sxx - syy) / (Math.PI / 4)) * (Math.PI / 4), ux = Math.cos(th), uy = Math.sin(th);
      const along = id => (geo.get(id)[0] - mx) * ux + (geo.get(id)[1] - my) * uy;
      own.sort((a, b) => along(a) - along(b));
      const step = GRID * (Math.abs(ux) > 0.1 && Math.abs(uy) > 0.1 ? 1 : 1.4);   // diagonal steps are already longer
      own.forEach((id, i) => { const t = (i - (own.length - 1) / 2) * step; placeNear(id, mx + ux * t, my + uy * t); });
      transfers.forEach(id => { const g = geo.get(id); placeNear(id, g[0], g[1]); });   // another line may already own it
      const stops = [...own, ...transfers].sort((a, b) => { const sa = stations.get(a), sb = stations.get(b); return (sa.x - mx) * ux + (sa.y - my) * uy - ((sb.x - mx) * ux + (sb.y - my) * uy); });
      const li = lines.length; lines.push({ c: c.id, color: colorOf(c.id), stops });
      stops.forEach(id => { const st0 = stations.get(id); if (!st0.lines.includes(li)) st0.lines.push(li); });
    });
    const pos = new Map(geo); stations.forEach(s => pos.set(s.id, [s.x, s.y]));
    return { lines, stations, pos };
  }
  const legs = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.min(Math.abs(dx), Math.abs(dy));
    return [[a[0] + Math.sign(dx) * d, a[1] + Math.sign(dy) * d], b]; };   // diagonal first, then straight

  // City: each topic is a district and each note a building. Height = how much the vault relies on it,
  // footprint = how long it is, lit windows = recent edits and mentions, grey and dark = stale, a crane = new.
  // Notes you link to but haven't written are empty lots in the Planned district.
  const U = 22;   // one lot, in world units
  const iso = (gx, gy) => [(gx - gy) * U * 0.866, (gx + gy) * U * 0.5];
  function applyMapLayout(animate) {
    impMax = null;
    const geo = geography(), v = st.view;
    const M = mapCache[v] = SCENES[v] ? SCENES[v].layout(geo) : v === "subway" ? subwayLayout(geo)
      : { weather: weatherLayout, foodweb: foodwebLayout, clock: clockLayout, radar: radarLayout }[v](geo);
    if (animate) morphTo(n => { const p = M.pos.get(n.id); return p ? [p[0], p[1], 0] : null; }, 950);
    else nodes.forEach(n => { const p = M.pos.get(n.id); if (p) { n.x = p[0]; n.y = p[1]; n.z = 0; } });
  }
  const mapFitPred = () => SCENES[st.view] ? (SCENES[st.view].fit || (n => !special(n) && !n.ghost)) : st.view === "subway" ? (n => mapCache.subway && mapCache.subway.stations.has(n.id))
    : st.view === "radar" ? (n => !special(n) && n.tasks > 0) : (n => !special(n) && !n.ghost);

  function mapFrame() {
    const dpr = screenDpr();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);   // the theme background can be see-through (Hearth cards): without this, frames smear
    P.clear(); labelRects = []; bodies = []; spots = [];
    return { dpr, R: rot(), litSet: lit(), font: css("--vg-font") || "system-ui, sans-serif", k: cam.k };
  }
  // Clickable areas a scene draws that aren't notes (a floor, a lever, a palette chip): spot(x, y, w, h, fn) each
  // frame; a click on empty canvas inside one runs fn
  let spots = [];
  const spot = (x, y, w, h, fn, title) => spots.push([x, y, w, h, fn, title]);
  let pressing = false;   // a scene's press() has the pointer
  // ---- isometric kit: 3D for any scene. A scene keeps its flat world layout (x, y as its layout placed the notes)
  // and draws through this instead of scr(): the plane is turned 45° and tilted around the pane's centre, z is height
  // in world units. Hit spots come from iso.hit, so clicks, hover and the inspector work the same as in flat scenes.
  //   const iso = isoKit(R, k, "iso" | "tilt");  iso.p(x, y, z) -> screen point   iso.rect(x, y, w, h) -> 4 corners (back, right, front, left)
  //   iso.poly(pts, fill, stroke, lw)  iso.wall(a, b, h, fill, stroke)  iso.slab(x, y, w, h, thick, top, sideL, sideR, edge)
  //   iso.block(p, size, height, colour, edge) -> faces   iso.prism(front, d, colour, o) (any solid; see prism)
  //   iso.hit(p, halfWidth, height)   iso.depthSort(items, item -> point)
  // The angles 3D scenes share: "iso" turns the plane 45° and tilts it (floors, towns); "tilt" only leans it back, so
  // rows and columns stay square to you (tables, boards). Each is a 2x2 matrix from flat screen offsets to the angled ones.
  const ISO_VIEWS = { iso: [0.62, -0.62, 0.36, 0.36], tilt: [0.92, 0, 0, 0.58], flat: [1, 0, 0, 1] };   // flat: top-down, blocks show as squares
  // the angle the current view draws at, by name, or null for a view that doesn't draw through the kit: a scene sets
  // iso: "iso" | "tilt" (true = "iso"); the person's choice for the view (st.angles,
  // the angle button or 3) wins over both
  const isoAngle = () => { const d = SCENES[st.view], own = d && d.iso ? (d.iso === true ? "iso" : d.iso) : null;
    return own && (st.angles[st.view] || own); };
  const isoScene = () => { const a = isoAngle(); return a && ISO_VIEWS[a]; };
  // 2D or 3D: one control in every view, the same place and the same key (3). The graph swaps its two layouts, a scene
  // drawn through the kit changes angle, Neural turns or lies flat, and every other view leans back in real perspective.
  // A game has no switch: it's already first-person.
  const isGame = () => !!(SCENES[st.view] && SCENES[st.view].game);
  const weather3D = () => st.view === "weather" && st.angles.weather === "tilt3d" && !opts.compact && !opts.embed && GL.ok();   // real ground when there's WebGL; a leaning picture otherwise
  const layWeather = () => { const on = weather3D(); if (on === st.three && !on) return; st.three = on; cam.spin = null; animateTo(on ? { yaw: 0, pitch: -0.95 } : { yaw: 0, pitch: 0, d: 0 }, 700); cv.style.cursor = on ? "grab" : "default"; if (on) afterMorph(() => fit(mapFitPred(), 700), 750); };
  const leansBack = () => !isGame() && !(SCENES[st.view] && SCENES[st.view].own3d) && !isoAngle() && !neural() && !weather3D() && st.view !== "2d" && st.view !== "3d" && st.angles[st.view] === "tilt3d";
  function dimOf() {
    const v = st.view, angle = isoAngle();
    if (v === "2d" || v === "3d") return v;
    if (angle) return angle === "flat" ? "2d" : "3d";
    if (neural()) return st.three ? "3d" : "2d";
    return !isGame() && st.angles[v] === "tilt3d" ? "3d" : "2d";
  }
  function setDim(d) {
    const v = st.view; if (isGame() || d === dimOf()) return;
    if (v === "2d" || v === "3d") return setView(d);
    if (isoAngle()) { const own = SCENES[v].iso; st.angles[v] = d === "2d" ? "flat" : own === true ? "iso" : own; fit(null); }
    else if (neural()) { st.angles.neural = d === "2d" ? "flat" : "3d"; layNeural(); brainLayout(true); }
    else { st.angles[v] = d === "3d" ? "tilt3d" : "flat"; if (v === "weather") layWeather(); }
    syncDim(); persistSoon(); dirty = true; kick();
  }
  function layNeural() { st.three = st.angles.neural !== "flat"; if (!st.three) { cam.spin = null; animateTo({ yaw: 0, pitch: 0 }, 500); } cv.style.cursor = st.three ? "grab" : "default"; }
  function syncDim() {
    const d = dimOf(), seg = $(".vg-dimseg"), status = $(".vg-status"); if (seg) seg.hidden = isGame();
    if (status) status.style.display = isGame() ? "none" : "";   // a count of notes means nothing in a game, and it sits on the game's own text
    $$("[data-dim]").forEach(b => b.setAttribute("aria-pressed", b.dataset.dim === d));
    cv.classList.toggle("is-tilt3d", leansBack()); syncViewHelp();
  }
  // shadeOf(colour, t): colour darkened by t (0..1); a colour that isn't #rrggbb shades a neutral blue-grey
  const shadeOf = (c, t) => hexMix(/^#[0-9a-f]{6}$/i.test(c) ? c : "#a5b4cf", "#000000", t);
  // prism(front, d, colour, o): a flat shape (screen points in order round it) pushed back along d (a screen offset)
  // into a solid. Draws the side faces that look toward you, shaded by the one light (UI.light: up = colour, turned
  // left / right / a top leaning right = darker), then the front face, and returns the back outline. Every solid is
  // one of these (a note's block, a floor slab, the palace's body and roof), so faces always meet and are lit alike.
  // Opaque faces get a hairline in their own colour, so no anti-aliasing seam shows between them.
  //   o.faces { up, left, right, slope }: colours instead of the shaded ones   o.front: the front face's colour
  //   o.edge, o.lw: the front face's outline   o.sides: outline the side faces too
  function prism(front, d, colour, o = {}) {
    const n = front.length, back = front.map(q => ({ x: q.x + d.x, y: q.y + d.y }));
    let area = 0; front.forEach((q, i) => { const r = front[(i + 1) % n]; area += q.x * r.y - r.x * q.y; });
    const turn = area > 0 ? 1 : -1;   // which way round the outline goes, so each edge's outer side is known
    const face = (pts, fill, edge, lw) => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      const line = edge || (/^#[0-9a-f]{6}$/i.test(fill || "") ? fill : null);
      if (line) { ctx.strokeStyle = line; ctx.lineWidth = edge ? lw || 1 : 0.75; ctx.lineJoin = "round"; ctx.stroke(); } };
    front.forEach((a, i) => { const b = front[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey); if (len < 0.01) return;
      const nx = turn * ey / len, ny = -turn * ex / len;   // the edge's outward normal
      if (nx * d.x + ny * d.y <= 0.001) return;           // a face turned away, behind the front
      const kind = ny < -0.5 ? (nx > 0.15 ? "slope" : "up") : nx < 0.15 ? "left" : "right", f = o.faces || {};   // a face square to you counts as left
      face([a, b, back[(i + 1) % n], back[i]], f[kind] || (kind === "up" ? colour : shadeOf(colour, UI.light[kind])), o.sides ? o.edge : null, o.lw); });
    face(front, o.front || colour, o.edge, o.lw);
    return back;
  }
  function isoKit(R, k, view) {
    const m = ISO_VIEWS[(isoAngle() && st.angles[st.view]) || view || "iso"], ax = (Math.abs(m[0]) + Math.abs(m[1])) / 2, ay = (Math.abs(m[2]) + Math.abs(m[3])) / 2 || m[3];
    const p = (x, y, z = 0) => { const a = scr(x, y, R), u = a.x - W / 2, v = a.y - H / 2; return { x: W / 2 + m[0] * u + m[1] * v, y: H / 2 + m[2] * u + m[3] * v - z * k, s: a.s }; };
    const lift = (q, h) => ({ x: q.x, y: q.y - h });
    const poly = (pts, fill, stroke, lw) => { ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); } };
    const rect = (x, y, w, h) => [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)];
    const wall = (a, b, h, fill, stroke) => poly([a, b, lift(b, h), lift(a, h)], fill, stroke);
    const shade = shadeOf;
    // a slab: its top, and the front sides showing its thickness (px)
    const slab = (x, y, w, h, thick, top, sideL, sideR, edge) => { const c = rect(x, y, w, h);
      prism(c, { x: 0, y: thick }, top, { faces: { left: sideL, right: sideR }, edge }); return c; };
    // a box standing on screen point q: size = its footprint's side (px, before the angle), height (px). Draws the
    // sides that face you, then the top; returns the top's corners (T/Rp/B/Lp = highest/right/lowest/left), its centre c
    // and half extents hw/hh
    const block = (q, size, height, colour, edge) => {
      const h = size / 2, foot = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, v]) => ({ x: q.x + m[0] * u + m[1] * v, y: q.y + m[2] * u + m[3] * v }));
      const top = foot.map(f => lift(f, height));
      prism(top, { x: 0, y: height }, colour, { edge, lw: 0.7 });
      const ys = top.map(t => t.y), xs = top.map(t => t.x), by = (f, v) => top[f.indexOf(v)];
      const T = by(ys, Math.min(...ys)), B = by(ys, Math.max(...ys)), Lp = by(xs, Math.min(...xs)), Rp = by(xs, Math.max(...xs));
      return { top, T, Rp, B, Lp, c: { x: q.x, y: q.y - height }, hw: (Math.max(...xs) - Math.min(...xs)) / 2, hh: (Math.max(...ys) - Math.min(...ys)) / 2 };
    };
    // a solid or figure standing on q, hw wide each side and height tall: its hit spot, and its screen box (box: x, y,
    // w, h, footprint included), which also goes in bodies so note names are placed off it
    const hit = (q, hw, height) => { const foot = hw * ay / ax, box = body([q.x - hw, q.y - height - foot, 2 * hw, height + 2 * foot]);
      return { x: q.x, y: q.y - height / 2, r: Math.max(6, hw + 2, height / 2 + 2), box }; };
    const depthSort = (items, at) => items.sort((a, b) => at(a).y - at(b).y);   // farther (higher on screen) first
    return { p, lift, poly, rect, wall, slab, block, prism, hit, depthSort, shade, ax, ay };
  }

  // ---- parts every scene shares: one figure and one set of motions. A scene picks them by name, so a zombie, the
  // palace's visitor and any figure still to come are one drawing with different poses.
  // walker(q, size, colour, { pose, head, sway, phase, lantern }) draws a stick figure standing on screen point q and
  // returns { head, h }. pose: walk | reach (arms out) | guard (fists up) | raise (arms up). phase moves the legs.
  const POSES = { walk: [[0.5, 0.35], [-0.5, 0.35]], reach: [[1.4, -0.03], [1.3, 0.03]], guard: [[0.7, -0.22], [0.45, -0.12]], raise: [[0.5, -0.45], [-0.5, -0.45]] };
  function walker(q, s, col, o = {}) {
    const h = s * 3.2, step = reducedMotion() ? 0 : Math.sin(o.phase || 0) * s * 0.35, sway = o.sway || 0;
    const hip = { x: q.x + sway * 0.3, y: q.y - h * 0.45 }, neck = { x: q.x + sway, y: q.y - h * 0.85 }, sh = { x: q.x + sway, y: q.y - h * 0.75 }, head = { x: q.x + sway, y: q.y - h };
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, s * 0.55); ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(q.x - s * 0.5 + step, q.y); ctx.lineTo(hip.x, hip.y); ctx.lineTo(q.x + s * 0.5 - step, q.y);
    ctx.moveTo(hip.x, hip.y); ctx.lineTo(neck.x, neck.y);
    (POSES[o.pose] || POSES.walk).forEach(([ax, ay]) => { ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x + ax * s, sh.y + ay * h); });
    ctx.stroke();
    if (o.lantern) { const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, h * 2.2); g.addColorStop(0, "rgba(253,224,71,.4)"); g.addColorStop(1, "rgba(253,224,71,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(head.x, head.y, h * 2.2, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillStyle = o.head || UI.colour.skin; ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(1.4, s * 0.55), 0, 2 * Math.PI); ctx.fill();
    return { head, h };
  }
  // MOTION.<name>(id, now, ...) -> [dx, dy] in layout units, different per note (seeded by its id), [0, 0] with reduced motion
  const still = [0, 0];
  const MOTION = {
    roam: (id, now, r = 30) => { if (reducedMotion()) return still; const t = now / 4000 + (hash(id) % 100); return [Math.cos(t) * r, Math.sin(t * 0.8) * r]; },
    patrol: (id, now, r = 6) => { if (reducedMotion()) return still; const t = now / 2200 + (hash(id) % 100); return [Math.sin(t) * r, Math.cos(t * 0.7) * r * 0.66]; },
    // toward a point and back, as if pushing at it
    lurch: (id, now, at, to, reach = 0.12) => { if (reducedMotion()) return still; const t = now / 1600 + (hash(id) % 100) / 16, pull = 0.5 + 0.5 * Math.sin(t);
      return [(to[0] - at[0]) * reach * pull + Math.sin(t * 3) * 3, (to[1] - at[1]) * reach * pull]; },
    // pushed away from a point for ms after `since`, easing back
    knock: (since, now, at, from, dist = 28, ms = 700) => { const d0 = now - since; if (since == null || d0 < 0 || d0 >= ms || reducedMotion()) return still;
      const f = dist * (1 - d0 / ms), d = Math.hypot(at[0] - from[0], at[1] - from[1]) || 1; return [(at[0] - from[0]) / d * f, (at[1] - from[1]) / d * f]; },
    // a run at a target and back, once every `period` ms for `share` of it
    sortie: (id, now, at, to, period = 9000, share = 0.25) => { if (reducedMotion() || !to) return still; const run = (now / period + (hash(id) % 97) / 97) % 1;
      if (run >= share) return still; const f = Math.sin(run / share * Math.PI) * 0.48; return [(to[0] - at[0]) * f, (to[1] - at[1]) * f]; },
    // a slow small sway, as if floating
    drift: (id, now, r = 10) => { if (reducedMotion()) return still; const t = now / 6000 + (hash(id) % 100); return [Math.sin(t) * r, Math.sin(t * 1.3) * r * 0.5]; },
    // round a centre point at the distance it stands
    orbit: (id, now, at, around, period = 40000) => { if (reducedMotion()) return still; const a = (now / period) * 2 * Math.PI * (hash(id) % 2 ? 1 : -1), c = Math.cos(a), s = Math.sin(a),
      u = at[0] - around[0], v = at[1] - around[1]; return [around[0] + u * c - v * s - at[0], around[1] + u * s + v * c - at[1]]; },
    // up (or down) a short way, over and over, each note at its own point in the loop
    rise: (id, now, r = 40) => { if (reducedMotion()) return still; return [0, -((now / 3000 + (hash(id) % 100) / 100) % 1) * r]; },
    fall: (id, now, r = 40) => { if (reducedMotion()) return still; return [0, ((now / 3000 + (hash(id) % 100) / 100) % 1) * r]; },
  };
  // A grid for n things, as square as it gets: stretch > 1 makes it wider than tall. { cols, rows }, never 0 columns
  const gridDims = (n, stretch = 1) => { const cols = Math.max(1, Math.ceil(Math.sqrt(n * stretch))); return { cols, rows: Math.ceil(n / cols) }; };
  // A timed event: true about perSecond times a second, for a frame dt ms long (a shot, a falling leaf)
  const chance = (perSecond, dt) => Math.random() < perSecond * dt / 1000;
  // windowSprite(x0, y0, w, h, o) draws a window, top-left at x0/y0. o.state: "lit" (warm light; o.busy > 0.5 sends a
  // figure across now and then), "boarded" (nobody's been in a while) or "plain". o.seed varies the flicker per
  // window, o.night darkens the glass, o.frame is the outline colour, o.tasks adds a red sill, o.selected a highlight.
  function windowSprite(x0, y0, ww, wh, o) {
    if (o.state === "lit") {
      const fl = reducedMotion() ? 1 : 0.85 + 0.15 * Math.sin(o.now / 170 + o.seed % 13);
      ctx.fillStyle = `rgba(253,${200 + Math.round(30 * fl)},110,${0.75 + 0.25 * fl})`; ctx.fillRect(x0, y0, ww, wh);
      if (ww > 6 && o.busy > 0.5 && !reducedMotion()) { const t = ((o.now / 2600 + (o.seed % 100) / 100) % 1.6) - 0.3; if (t >= 0 && t <= 1) {
        const fx = x0 + t * ww, fh = wh * 0.6; ctx.fillStyle = "rgba(40,30,25,.75)"; ctx.beginPath(); ctx.arc(fx, y0 + wh - fh, Math.max(1, fh * 0.16), 0, 2 * Math.PI); ctx.fill(); ctx.fillRect(fx - fh * 0.12, y0 + wh - fh * 0.82, fh * 0.24, fh * 0.82); } }
    } else if (o.state === "boarded") {
      ctx.fillStyle = o.night ? "#121418" : "#3b3d44"; ctx.fillRect(x0, y0, ww, wh);
      if (ww > 5) { ctx.strokeStyle = "#8b6b43"; ctx.lineWidth = Math.max(1, ww * 0.12); ctx.beginPath(); ctx.moveTo(x0, y0 + wh * 0.25); ctx.lineTo(x0 + ww, y0 + wh * 0.55); ctx.moveTo(x0, y0 + wh * 0.7); ctx.lineTo(x0 + ww, y0 + wh * 0.4); ctx.stroke(); }
    } else { ctx.fillStyle = o.night ? "#2c3e5c" : "#9cc3dc"; ctx.fillRect(x0, y0, ww, wh); }
    ctx.strokeStyle = o.frame; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, ww, wh);
    if (o.tasks) { ctx.fillStyle = UI.colour.tasks; ctx.fillRect(x0 - 1, y0 + wh, ww + 2, Math.max(1.5, 2.5 * Math.sqrt(o.k || 1))); }
    if (o.selected) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.strokeRect(x0 - 3, y0 - 3, ww + 6, wh + 6); }
  }
  // ---- group layouts: where each group (a topic's settlement, column, district) stands, and its notes inside it.
  // placeGroups(n, place, cell) -> { at: [[cx, cy]...], span } in layout units; cell = room per group. place: grid
  // (square-ish), ring (round a centre), rows (a wide band), free (scattered, seeded so it's the same each time)
  function placeGroups(n, place, cell) {
    let at;
    if (place === "ring" && n > 1) { const r = Math.max(cell, n * cell / (2 * Math.PI)); at = [...Array(n)].map((_, i) => [Math.cos(i / n * 2 * Math.PI - Math.PI / 2) * r, Math.sin(i / n * 2 * Math.PI - Math.PI / 2) * r]); }
    else if (place === "free") { const s = Math.sqrt(n) * cell; at = [...Array(n)].map((_, i) => { const [u, v] = scatter("group:" + i); return [(u - 0.5) * s, (v - 0.5) * s]; }); }
    else { const { cols, rows } = gridDims(n, place === "rows" ? 4 : 1);
      at = [...Array(n)].map((_, i) => [(i % cols - (cols - 1) / 2) * cell, (Math.floor(i / cols) - (rows - 1) / 2) * cell]); }
    return { at, span: Math.max(cell / 2, ...at.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) + cell / 2)) };
  }
  // notes in rows and columns inside a square yard (centre cx/cy, half its side), with a margin
  const packIn = (ms, cx, cy, half, pos, margin = 20) => { const g = gridDims(ms.length).cols, step = (2 * half - 2 * margin) / g;
    ms.forEach((n, j) => pos.set(n.id, [cx - half + margin + (j % g + 0.5) * step, cy - half + margin + (Math.floor(j / g) + 0.5) * step])); };
  // notes round the outside of a yard, r0 out plus up to `band`, each at its own angle (seeded by its id)
  const ringAround = (ms, cx, cy, r0, pos, band = 70) => ms.forEach(n => { const a = (hash(n.id) % 628) / 100, r = r0 + (hash(n.id + "r") % band); pos.set(n.id, [cx + Math.cos(a) * r, cy + Math.sin(a) * r]); });
  // ---- sprites: what a note can be drawn as, by name. drawSprite(kind, iso, q, s, colour, o) draws one standing on screen
  // point q at size s (px) and returns { h, hw }: its height and half width, for the click area. o: pose, phase, sway
  // (walker), now/seed/state/busy/tasks (window), level (flask), height (block).
  const SPRITES = {
    walker: (iso, q, s, col, o) => { walker(q, s, col, o); return { h: s * 3.2, hw: s * 1.2 }; },
    block: (iso, q, s, col, o) => { const h = s * (o.height || 3), t = iso.block(q, s * 2.2, h, col, "rgba(0,0,0,.35)"); return { h, hw: t.hw }; },
    tower: (iso, q, s, col) => { const t = iso.block(q, s * 1.6, s * 6, "#8b7355", "rgba(0,0,0,.4)"); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(t.c.x, t.c.y, Math.max(2, s * 0.4), 0, 2 * Math.PI); ctx.fill(); return { h: s * 6, hw: t.hw }; },
    window: (iso, q, s, col, o) => { windowSprite(q.x - s, q.y - s * 2.6, s * 2, s * 2.6, { ...o, frame: col }); return { h: s * 2.6, hw: s }; },
    gem: (iso, q, s, col) => { const t = { x: q.x, y: q.y - s * 3 }, r = { x: q.x + s * 1.2, y: q.y - s * 1.9 }, l = { x: q.x - s * 1.2, y: q.y - s * 1.9 };
      iso.poly([t, r, q, l], col, "rgba(0,0,0,.4)"); iso.poly([t, r, { x: q.x, y: q.y - s * 1.9 }], "rgba(255,255,255,.35)"); return { h: s * 3, hw: s * 1.2 }; },
    flask: (iso, q, s, col, o) => { const by = q.y - s * 1.2, lvl = o.level == null ? 0.6 : o.level;
      ctx.fillStyle = "rgba(226,232,240,.25)"; ctx.beginPath(); ctx.arc(q.x, by, s * 1.2, 0, 2 * Math.PI); ctx.fill(); ctx.fillRect(q.x - s * 0.35, by - s * 2.2, s * 0.7, s * 1.3);
      ctx.save(); ctx.beginPath(); ctx.arc(q.x, by, s * 1.2, 0, 2 * Math.PI); ctx.clip(); ctx.fillStyle = col; ctx.fillRect(q.x - s * 1.2, by + s * 1.2 - lvl * s * 2.4, s * 2.4, s * 2.4); ctx.restore();
      ctx.strokeStyle = "rgba(226,232,240,.8)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q.x, by, s * 1.2, 0, 2 * Math.PI); ctx.stroke(); ctx.strokeRect(q.x - s * 0.35, by - s * 2.2, s * 0.7, s * 1.05);
      return { h: s * 3.4, hw: s * 1.2 }; },
    star: (iso, q, s, col) => { const cy = q.y - s * 1.8; ctx.fillStyle = col; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.6 : s * 1.5, a = i / 10 * 2 * Math.PI - Math.PI / 2; i ? ctx.lineTo(q.x + Math.cos(a) * r, cy + Math.sin(a) * r) : ctx.moveTo(q.x + Math.cos(a) * r, cy + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); return { h: s * 3.3, hw: s * 1.5 }; },
    tree: (iso, q, s, col) => { ctx.fillStyle = "#6b4f2c"; ctx.fillRect(q.x - s * 0.25, q.y - s * 1.6, s * 0.5, s * 1.6);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y - s * 2.6, s * 1.3, 0, 2 * Math.PI); ctx.fill(); return { h: s * 3.9, hw: s * 1.3 }; },
  };
  const drawSprite = (kind, iso, q, s, col, o = {}) => (SPRITES[kind] || SPRITES.walker)(iso, q, s, col, o);

  // ---- a scene written in a note: specScene(spec) turns a checked ```vault-graph-scene block (VGRules.sceneSpec) into
  // a scene() definition from the parts above. Groups are topics; each note is drawn by the first entity rule it
  // matches; walls, events and the camera angle come from the block. Unlinked notes stand out between the groups.
  function specScene(key, spec, path) {
    const W_ = VGRules.SCENE_WHEN, CELL = 520, S = { bolts: [], runs: new Map(), hit: new Map(), last: 0 };
    const ruleOf = n => spec.entity.find(r => W_[r.when](n)) || null;
    const outside = r => r && (r.motion === "lurch-in" || r.motion === "orbit");   // these stand round the yard, not in it
    const ruleName = r => r.label || (r.when === "else" ? "other" : r.when);
    const wallOf = (g, M) => spec.wall === "map-coverage" ? g.cover : spec.wall === "activity" ? Math.min(1, topicBusy(g.c) / Math.max(1, g.ids.length * 0.4))
      : spec.wall === "size" ? g.ids.length / M.biggest : 0;
    const count = (g, when) => g.ids.filter(id => byId[id] && W_[when](byId[id])).length;
    const nearest = (from, ids, when) => { let b = null, bd = Infinity; for (const id of ids) { const n = byId[id]; if (!n || id === from.id || !W_[when](n) || !P.has(id)) continue;
      const d = Math.hypot(n.x - from.x, n.y - from.y); if (d < bd) { bd = d; b = n; } } return b; };
    return {
      name: spec.name, icon: "sparkles", iso: spec.angle, fps: 30,
      blurb: spec.blurb || `A scene from ${String(path || "a note").split("/").pop().replace(/\.md$/, "")}`,
      toast: `${spec.name} — ${spec.entity.map(r => `${r.as} = ${ruleName(r)}`).join(", ")}`,
      layout(geo) {
        const pos = new Map(geo), cs = topicsWithNotes(true), { at, span } = placeGroups(cs.length, spec.place, CELL), groups = [];
        cs.forEach((c, i) => { const ms = topicNotes(c.id, true).sort(byImportance), [cx, cy] = at[i], m = mocOf[c.id];
          const half = Math.min(200, 50 + 22 * Math.sqrt(ms.length)), out = ms.filter(n => outside(ruleOf(n)));
          packIn(ms.filter(n => !outside(ruleOf(n))), cx, cy, half, pos); ringAround(out, cx, cy, half + 30, pos);
          if (m && byId[m.id]) pos.set(m.id, [cx - half + 14, cy - half + 14]);
          groups.push({ c: c.id, cx, cy, half, ids: ms.map(n => n.id), cover: m && ms.length ? ms.filter(n => VGRules.onMap(m, n.id)).length / ms.length : 0 }); });
        nodes.filter(n => n.isolated && !special(n) && !n.ghost).forEach(n => { const [u, v] = scatter("out:" + n.id); pos.set(n.id, [(u - 0.5) * 2 * span, (v - 0.5) * 2 * span]); });
        const e = span + 80;
        return { pos, groups, byC: Object.fromEntries(groups.map(g => [g.c, g])), biggest: Math.max(1, ...groups.map(g => g.ids.length)), bounds: [[-e, -e], [e, e], [-e, e], [e, -e]] };
      },
      fit: n => !special(n) && !n.ghost,
      draw(now) {
        const { R, litSet, k } = mapFrame(), M = mapCache[key], iso = isoKit(R, k, spec.angle), dt = tickOf(S, now), { night } = daylight();
        backdrop(...(spec.sky || (night ? ["#0b1020", "#1c2433"] : ["#93c5fd", "#e0f2fe"])));
        if (!M) return;
        const [b0, b1] = M.bounds, ground = spec.ground || (night ? "#232a22" : "#5b6b4a");
        iso.slab(b0[0], b0[1], b1[0] - b0[0], b1[1] - b0[1], Math.max(4, 14 * k), ground, null, null, "rgba(0,0,0,.25)");
        const on = c => !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === c), wallH = g => Math.max(3, (6 + 46 * wallOf(g, M)) * k);
        M.groups.forEach(g => { const c = iso.rect(g.cx - g.half, g.cy - g.half, 2 * g.half, 2 * g.half); ctx.globalAlpha = on(g.c) ? 1 : 0.35;
          iso.poly(c, hexMix(colorOf(g.c), ground, 0.65), "rgba(0,0,0,.3)");
          if (spec.wall !== "none") { iso.wall(c[0], c[1], wallH(g), iso.shade(colorOf(g.c), 0.45), "rgba(0,0,0,.4)"); iso.wall(c[3], c[0], wallH(g), iso.shade(colorOf(g.c), 0.55), "rgba(0,0,0,.4)"); } });
        ctx.globalAlpha = 1;
        // everyone, back to front
        const items = [];
        for (const n of nodes) { if (special(n) || n.ghost || !mapShown(n)) continue; const r = ruleOf(n); if (!r) continue;
          const g = M.byC[n.cluster], ctr = g ? [g.cx, g.cy] : [0, 0]; let x = n.x, y = n.y; const add = ([dx, dy]) => { x += dx; y += dy; };
          add(r.motion === "none" ? still : r.motion === "lurch-in" ? MOTION.lurch(n.id, now, [x, y], ctr) : r.motion === "orbit" ? MOTION.orbit(n.id, now, [x, y], ctr) : MOTION[r.motion](n.id, now));
          const run = S.runs.get(n.id); let pose = r.as === "walker" && n.tasks > 0 ? "guard" : "walk";
          if (run) { const f = (now - run.t0) / run.ms; if (f >= 1 || !byId[run.to]) S.runs.delete(n.id); else { const to = byId[run.to], reach = Math.sin(f * Math.PI) * run.reach;
            add([(to.x - x) * reach, (to.y - y) * reach]); pose = run.pose; } }
          const hit = S.hit.get(n.id); if (hit) add(MOTION.knock(hit.t, now, [x, y], hit.from));
          items.push([n, r, iso.p(x, y), pose]); }
        iso.depthSort(items, it => it[2]);
        for (const [n, r, q, pose] of items) {
          const lit0 = !litSet || litSet.has(n.id), s = Math.max(2, (2.5 + 3 * importance(n)) * Math.sqrt(k)), col = r.colour || colorOf(n.cluster);
          ctx.globalAlpha = lit0 ? 1 : 0.25;
          const d = drawSprite(r.as, iso, q, s, col, { pose, phase: now / 180 + hash(n.id), now, seed: hash(n.id), state: staleFor(n, Q.stale_days) ? "boarded" : activity(n) > 0.3 ? "lit" : "plain",
            busy: activity(n), tasks: n.tasks > 0, night, k, level: 0.2 + 0.8 * activity(n), height: 2 + 6 * importance(n) });
          if (n.tasks > 0 && r.as !== "window") { ctx.fillStyle = UI.colour.tasks; ctx.beginPath(); ctx.arc(q.x + d.hw, q.y - d.h, Math.max(1.5, s * 0.35), 0, 2 * Math.PI); ctx.fill(); }
          if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(q.x, q.y, d.hw * 1.6, d.hw * 0.8, 0, 0, 2 * Math.PI); ctx.stroke(); }
          P.set(n.id, { ...iso.hit(q, d.hw, d.h), s: q.s, depth: -importance(n), a: lit0 ? 1 : 0.3 });
        }
        ctx.globalAlpha = 1;
        // each group's map stands at its corner
        M.groups.forEach(g => { const m = mocOf[g.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return; const q = iso.p(byId[m.id].x, byId[m.id].y), s = Math.max(4, 8 * Math.sqrt(k));
          const d = drawSprite("tower", iso, q, s, "#fbbf24"); P.set(m.id, { ...iso.hit(q, d.hw, d.h), s: q.s, depth: -2, a: 1 }); });
        if (spec.wall !== "none") M.groups.forEach(g => { const c = iso.rect(g.cx - g.half, g.cy - g.half, 2 * g.half, 2 * g.half), h = wallH(g) * 0.55; ctx.globalAlpha = on(g.c) ? 0.8 : 0.3;
          iso.wall(c[1], c[2], h, iso.shade(colorOf(g.c), 0.4), "rgba(0,0,0,.4)"); iso.wall(c[2], c[3], h, iso.shade(colorOf(g.c), 0.5), "rgba(0,0,0,.4)"); });
        ctx.globalAlpha = 1;
        // events: each fires about as often as its group is busy (or has tasks, or stale notes)
        if (!reducedMotion()) M.groups.forEach(g => spec.events.forEach(ev => {
          const rate = ev.every === "activity" ? topicBusy(g.c) / 9 : ev.every === "tasks" ? count(g, "tasks") / 12 : count(g, "stale") / 20;
          if (!rate || !chance(rate, dt)) return;
          const from = g.ids.map(id => byId[id]).filter(n => n && P.has(n.id) && W_[ev.from](n) && !S.runs.has(n.id)); if (!from.length) return;
          const a = from[Math.floor(Math.random() * from.length)];
          if (ev.verb === "spar") { const b = from.filter(n => n !== a)[Math.floor(Math.random() * (from.length - 1))]; if (!b) return;
            S.runs.set(a.id, { to: b.id, t0: now, ms: 1400, reach: 0.4, pose: "guard" }); S.runs.set(b.id, { to: a.id, t0: now, ms: 1400, reach: 0.4, pose: "guard" });
            const [win, lose] = byImportance(a, b) <= 0 ? [a, b] : [b, a]; S.hit.set(lose.id, { t: now + 700, from: [win.x, win.y] }); return; }   // knocked back as the blows land
          const b = nearest(a, g.ids, ev.target); if (!b) return;
          if (ev.verb === "dispatch") { S.runs.set(a.id, { to: b.id, t0: now, ms: 2600, reach: 0.9, pose: "walk" }); return; }
          S.bolts.push({ a: a.id, b: b.id, t: 0, colour: ev.colour || (ev.verb === "spark" ? "#a5f3fc" : "#fde047") }); S.hit.set(b.id, { t: now, from: [a.x, a.y] }); }));
        S.bolts = S.bolts.filter(bo => (bo.t += dt) < 240);
        S.bolts.forEach(bo => { const a = P.get(bo.a), b = P.get(bo.b); if (!a || !b) return; ctx.strokeStyle = bo.colour; ctx.globalAlpha = 1 - bo.t / 240; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }); ctx.globalAlpha = 1;
        M.groups.forEach(g => { const c = iso.rect(g.cx - g.half, g.cy - g.half, 2 * g.half, 2 * g.half);
          topicLabel(g.c, clip(shortName(g.c), 28).toUpperCase(), (c[0].x + c[1].x) / 2, (c[0].y + c[1].y) / 2 - wallH(g) - 22, Math.max(60, Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) + 40), "#f8fafc", "#0f172a", 10.5, { readout: true }); });
        noteLabels(items.map(it => it[0]).sort(byImportance).map(n => n.id), "#f8fafc", "#0f172a", k > 1.4 ? 60 : 14);
        const tally = new Map(); items.forEach(([, r]) => tally.set(r, (tally.get(r) || 0) + 1));
        setSceneStat(spec.entity.filter(r => tally.get(r)).map(r => `${tally.get(r)} ${ruleName(r)}`).join(" · "));
      },
      legend: item => spec.entity.map(r => item(`<b style='color:${esc(r.colour || "#e2e8f0")}'>●</b>`, `${esc(r.as)} = ${esc(ruleName(r))}`)).join("")
        + (spec.wall !== "none" ? item("▮", `wall = ${esc(spec.wall)}`) : ""),
      today() {
        const M = mapCache[key], r = spec.entity.find(x => x.when !== "else"); if (!M || !r) return null;
        const g = M.groups.slice().sort((a, b) => count(b, r.when) - count(a, r.when))[0]; if (!g || !count(g, r.when)) return null;
        const ids = g.ids.filter(id => W_[r.when](byId[id]));
        return { text: `Most ${ruleName(r)}: ${clusterName(g.c)} · ${plural(ids.length, "note")}`, label: "Show them", run: () => setHighlight(new Set(ids), `${clusterName(g.c)} · ${ruleName(r)}`) };
      },
    };
  }
  const scr = (x, y, R) => proj(x, y, 0, R);
  // Every map label goes through here: it stays inside the pane (shifted in from the edge, or cut with "…" when
  // wider than the pane), so small panes and sidebars don't show names running off the side.
  function haloText(text, x, y, fill, halo, font, align, hw) {
    ctx.font = font; ctx.textAlign = align || "left"; ctx.textBaseline = "middle";
    if (W > 40) {
      let w = ctx.measureText(text).width;
      if (w > W - 8) { text = fitW(text, font, W - 8); w = ctx.measureText(text).width; }
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x, shift = Math.max(4 - left, Math.min(0, W - 4 - (left + w)));
      x += shift;
    }
    ctx.lineWidth = hw || 3; ctx.strokeStyle = halo; ctx.lineJoin = "round"; ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  // The pane's backdrop: a top-to-bottom gradient through the colours given, evenly spaced, or [stop, colour] pairs
  // ... and a soft vignette (Neural's depth): the edges darken toward the corners. A last { vignette: false } skips it.
  function backdrop(...cols) {
    const o = cols.length && cols[cols.length - 1] && typeof cols[cols.length - 1] === "object" && !Array.isArray(cols[cols.length - 1]) ? cols.pop() : {};
    const g = ctx.createLinearGradient(0, 0, 0, H);
    cols.forEach((c, i) => Array.isArray(c) ? g.addColorStop(c[0], c[1]) : g.addColorStop(cols.length > 1 ? i / (cols.length - 1) : 0, c));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (o.vignette === false) return;
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.38)");
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  // A topic's name over its group (a well, column, settlement or bay): fitted to maxW, left out where a label already is
  // A topic's health in a few words (Neural's lobes and the scenes' topic labels): notes, active this week, share stale
  const topicReadout = c => { const g = lobeStats[c]; return g && g.notes ? `${plural(g.notes, "note")} · ${g.fresh} active · ${Math.round(100 * g.stale / g.notes)}% stale` : ""; };
  // o.readout: a second, quieter line with topicReadout under the name (big group labels: settlements, yards)
  function topicLabel(c, text, x, y, maxW, fill, halo, size, o = {}) {
    const px = size || Math.max(8, Math.min(11, 10 * Math.sqrt(cam.k))), font = css("--vg-font") || "system-ui, sans-serif", f = `700 ${px}px ${font}`;
    const t = fitW(text != null ? text : clip(shortName(c), 28), f, Math.max(20, maxW)); if (!t) return;
    ctx.font = f; const w = ctx.measureText(t).width;
    const sf = `500 ${Math.max(7.5, px * 0.8)}px ${font}`, sub = o.readout ? fitW(topicReadout(c), sf, Math.max(20, maxW)) : "";
    ctx.font = sf; const ws = sub ? ctx.measureText(sub).width : 0, bw = Math.max(w, ws), h = sub ? px * 2.3 : 14;
    if (!freeSpot(x - bw / 2, y - 7, bw, h)) return;
    haloText(t, x, y, fill, halo, f, "center");
    if (sub) { ctx.globalAlpha *= 0.8; haloText(sub, x, y + px * 1.25, fill, halo, sf, "center"); ctx.globalAlpha /= 0.8; }
  }
  // The longest start of `text` that fits maxW pixels in `font`, with "…" when cut ("" when not even that fits).
  // Labels in small panes and narrow rooms end cleanly instead of running into their neighbours.
  function fitW(text, font, maxW) {
    ctx.font = font;
    const key = font + "|" + maxW + "|" + text; let out = fitCache.get(key); if (out !== undefined) return out;
    if (ctx.measureText(text).width <= maxW) out = text;
    else { let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= maxW) lo = mid; else hi = mid - 1; }
      out = lo >= 3 ? text.slice(0, lo).trimEnd() + "…" : ""; }
    if (fitCache.size > 4000) fitCache.clear();
    fitCache.set(key, out); return out;
  }
  const fitCache = new Map();

  function drawSubway(now) {
    const { R, litSet: lit0, font, k } = mapFrame(), S = mapCache.subway;
    // only dim when something lit is actually on the map (a note that isn't a station would grey out everything)
    const litSet = lit0 && S && [...S.stations.keys()].some(id => lit0.has(id)) ? lit0 : null;
    const bg = css("--vg-bg"), fg = css("--vg-fg");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!S) return;
    const at = id => { const n = byId[id]; return [n.x, n.y]; }, lw = Math.max(2.5, 7 * Math.sqrt(k));
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    S.lines.forEach(L => {
      const on = !litSet || L.stops.some(id => litSet.has(id)), stops = L.stops.filter(id => visible(byId[id]));
      if (stops.length < 2) return;
      ctx.globalAlpha = on ? 1 : 0.14; ctx.strokeStyle = L.color; ctx.lineWidth = lw; ctx.beginPath();
      stops.forEach((id, i) => { const p = at(id);
        if (!i) { const s0 = scr(p[0], p[1], R); ctx.moveTo(s0.x, s0.y); return; }
        legs(at(stops[i - 1]), p).forEach(([x, y]) => { const s1 = scr(x, y, R); ctx.lineTo(s1.x, s1.y); }); });
      ctx.stroke();
    });
    // trains run each line, back and forth, more of them on busier topics; riders wait at stations named in recent dailies
    // and board when a train stops by
    const stn = id => { const s0 = S.stations.get(id); return [s0.x, s0.y]; };   // final spots, not mid-morph positions
    if (!S.paths) S.paths = S.lines.map(L => { const pts = []; L.stops.forEach((id, i) => { const p = stn(id); if (!i) pts.push(p); else pts.push(...legs(stn(L.stops[i - 1]), p)); });
      const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, len }; });
    const boarded = S.boarded || (S.boarded = new Map()), trainAt = [];
    S.lines.forEach((L, li) => {
      const { pts, len } = S.paths[li], total = len[len.length - 1]; if (!total || (litSet && !L.stops.some(id => litSet.has(id)))) return;
      const busy = L.stops.reduce((a, id) => a + activity(byId[id]), 0), trains = 1 + Math.min(3, Math.round(busy * 1.5));
      for (let j = 0; j < trains; j++) {
        let dist = ((reducedMotion() ? 0.3 : now * 0.045) + j * 2 * total / trains + hash(String(L.c)) % 500) % (2 * total); if (dist > total) dist = 2 * total - dist;   // back and forth
        let i = 1; while (i < len.length - 1 && len[i] < dist) i++;
        const a = pts[i - 1], b = pts[i], f = (dist - len[i - 1]) / Math.max(1e-6, len[i] - len[i - 1]), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        const sp = scr(x, y, R), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), w = Math.max(16, 24 * Math.sqrt(k)), h = Math.max(7, 9 * Math.sqrt(k));
        ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(ang); ctx.fillStyle = L.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-w / 2, -h / 2, w, h, h / 2) : ctx.rect(-w / 2, -h / 2, w, h); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.85)"; for (let q = -1; q <= 1; q++) ctx.fillRect(q * w / 4 - 1, -h / 4, 2, h / 2); ctx.restore();
        trainAt.push([x, y]);
      }
    });
    S.stations.forEach(st0 => { if (trainAt.some(([x, y]) => Math.hypot(x - st0.x, y - st0.y) < 10)) boarded.set(st0.id, now); });
    // stations: white with the line colour, interchanges (several lines, or a bridge note) ringed in black
    const order = [...S.stations.values()].filter(s => visible(byId[s.id])).sort((a, b) => importance(byId[b.id]) - importance(byId[a.id]));
    order.forEach(s => {
      const n = byId[s.id], p = scr(n.x, n.y, R), inter = s.lines.length > 1 || n.bridge, r = Math.max(3.5, (inter ? 7 : 4.6) * Math.sqrt(k));
      const on = !litSet || litSet.has(s.id);
      ctx.globalAlpha = on ? 1 : 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = Math.max(1.6, (inter ? 2.6 : 2.1) * Math.sqrt(k)); ctx.strokeStyle = inter ? "#111" : (S.lines[s.lines[0]] || {}).color || "#888"; ctx.stroke();
      if (st.selected === s.id) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI); ctx.strokeStyle = css("--vg-accent"); ctx.lineWidth = 2; ctx.stroke(); }
      P.set(s.id, { x: p.x, y: p.y, s: p.s, depth: 0, r: r + 3, a: on ? 1 : 0.3 });
      if (n.recent > 0 && on) {   // riders: one per recent mention (up to 6), back gradually after a train takes them
        const since = now - (boarded.get(s.id) || -1e9), want = Math.min(6, n.recent), shown = Math.min(want, Math.floor(since / 700));
        ctx.fillStyle = "#facc15"; for (let q = 0; q < shown; q++) { const a = q / 6 * 2 * Math.PI + 0.3; ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * (r + 5), p.y + Math.sin(a) * (r + 5), 1.6, 0, 2 * Math.PI); ctx.fill(); }
      }
    });
    ctx.globalAlpha = 1;
    // line names at each end, as coloured pills
    S.lines.forEach(L => {
      const stops = L.stops.filter(id => visible(byId[id])); if (stops.length < 2) return;
      const name = clip(shortName(L.c), 22);
      [stops[0]].forEach((id, e) => {
        const n = byId[id], p = scr(n.x, n.y, R); ctx.font = `700 11px ${font}`;
        const w = ctx.measureText(name).width + 14, x = Math.max(4, Math.min(W - w - 4, p.x + (e ? 12 : -12 - w))), y = p.y - 24;
        if (!freeSpot(x, y - 9, w, 18)) return;
        ctx.globalAlpha = !litSet || L.stops.some(i => litSet.has(i)) ? 1 : 0.25;
        ctx.fillStyle = L.color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y - 9, w, 18, 9) : ctx.rect(x, y - 9, w, 18); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(name, x + 7, y + 0.5);
      });
    });
    // station names where there's room, most relied-on first
    order.forEach(s => {
      const n = byId[s.id], p = P.get(s.id); if (!p) return;
      const on = !litSet || litSet.has(s.id), text = clip(n.name, MOBILE ? 22 : 30), f = `${s.lines.length > 1 ? 600 : 500} 11px ${font}`;
      ctx.font = f; const w = ctx.measureText(text).width;
      let x = p.x + p.r + 3, al = "left";
      if (!freeSpot(x, p.y - 7, w, 14)) { x = p.x - p.r - 3; al = "right"; if (!freeSpot(x - w, p.y - 7, w, 14)) return; }
      ctx.globalAlpha = on ? 1 : 0.3; haloText(text, x, p.y, fg, bg, f, al);
    });
    ctx.globalAlpha = 1;
  }

  const hexMix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  // unlinked notes have a place of their own here (the nursery, the storeroom), so they show without "Show unlinked"
  const mapShown = n => visible(n) || (n.isolated && !replay && !st.focusDist && !st.hidden.has(n.id) && !st.hiddenClusters.has(n.cluster));

