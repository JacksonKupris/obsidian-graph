  // ---------------------------------------------------------------- map views: subway, terrain, city
  // Each lays the notes out once on a flat plane (no physics) and draws its own picture. Drawn notes go into P
  // with a screen spot and radius, so hover, click, search, the inspector, lenses and replay keep working.
  // ---------------------------------------------------------------- scene registry
  // A scene registers everything about itself in one call, in its own file (_scripts/vault_graph_scenes/*.js, put here by
  // the build): scene(key, { name, icon, blurb, toast, layout(geo) -> { pos: Map(id -> [x, y]), ... }, draw(now), fps,
  // iso ("iso" | "tilt": drawn with isoKit, framed to match), press(phase, x, y) -> true (takes a drag off the notes, e.g. painting),
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
  const MAPS = { subway: "Subway", topo: "Terrain", city: "City", garden: "Garden", palace: "Palace", weather: "Weather", ships: "Shipping lanes", rings: "Tree rings",
    sky: "Sky chart", realm: "Realm", foodweb: "Food web", alchemy: "Alchemy", lineage: "Lineage", ripples: "Click depth", clock: "Heat clock", radar: "Radar",
    ...Object.fromEntries(Object.entries(SCENES).map(([k, d]) => [k, d.name])) };
  const mapView = () => !!MAPS[st.view];
  let geoCache = null, mapCache = {}, impMax = null;
  // how much the vault leans on a note, 0-1 (links in, daily mentions, influence)
  // One measure everywhere (City, Subway, Terrain, the Important-but-stale lens): links in, daily mentions,
  // influence, and opens when usage data exists (recent mentions otherwise)
  const importance = n => {
    if (!impMax) { const ns = nodes.filter(m => !special(m) && !m.ghost), mx = f => Math.max(1e-9, ...ns.map(f));
      impMax = { i: mx(m => Math.log1p(m.inlinks || 0)), m: mx(m => Math.log1p(m.mentions || 0)), b: mx(m => m.bc || 0),
        o: mx(m => Math.log1p(m.opens90 || 0)), r: mx(m => Math.log1p(m.recent || 0)) }; }
    return 0.4 * Math.log1p(n.inlinks || 0) / impMax.i + 0.3 * Math.log1p(n.mentions || 0) / impMax.m + 0.2 * (n.bc || 0) / impMax.b
      + 0.1 * (DATA.has_usage ? Math.log1p(n.opens90 || 0) / impMax.o : Math.log1p(n.recent || 0) / impMax.r);
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

  // Terrain: an elevation field where each note raises the ground by how much the vault relies on it. Topics
  // become hills, gaps between them valleys and sea. Quiet ground (no recent edits or mentions) sits under fog.
  function topoLayout(geo) {
    const ns = nodes.filter(n => !special(n) && !n.ghost);
    const [x0, y0, x1, y1] = bounds(ns.map(n => geo.get(n.id)), 160);
    const CELL = Math.max(8, Math.sqrt((x1 - x0) * (y1 - y0) / 36000)), gw = Math.ceil((x1 - x0) / CELL) + 1, gh = Math.ceil((y1 - y0) / CELL) + 1;
    const E = new Float32Array(gw * gh), A = new Float32Array(gw * gh), SIG = 58, rad = Math.ceil(3 * SIG / CELL);
    ns.forEach(n => {
      const [x, y] = geo.get(n.id), cx = (x - x0) / CELL, cy = (y - y0) / CELL, w = 0.2 + importance(n), act = activity(n);
      for (let j = Math.max(0, Math.floor(cy - rad)); j <= Math.min(gh - 1, Math.ceil(cy + rad)); j++)
        for (let i = Math.max(0, Math.floor(cx - rad)); i <= Math.min(gw - 1, Math.ceil(cx + rad)); i++) {
          const d2 = ((i - cx) ** 2 + (j - cy) ** 2) * CELL * CELL, g = Math.exp(-d2 / (2 * SIG * SIG));
          E[j * gw + i] += w * g; A[j * gw + i] += act * g;
        }
    });
    let mx = 1e-9; for (let i = 0; i < E.length; i++) mx = Math.max(mx, E[i]);
    for (let i = 0; i < E.length; i++) { E[i] = Math.pow(E[i] / mx, 0.7); A[i] = Math.min(1, A[i] / (0.35 + E[i] * mx * 0.25)); }
    const SEA = 0.07, off = document.createElement("canvas"); off.width = gw; off.height = gh;
    const oc = off.getContext("2d"), img = oc.createImageData(gw, gh);
    const STOPS = [[0, [40, 92, 72]], [0.25, [96, 140, 82]], [0.45, [176, 168, 104]], [0.65, [158, 116, 78]], [0.82, [128, 100, 86]], [1, [240, 238, 232]]];
    const tint = e => { for (let k = 1; k < STOPS.length; k++) if (e <= STOPS[k][0]) { const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k], u = (e - a) / (b - a); return ca.map((v, i) => v + (cb[i] - v) * u); } return STOPS[STOPS.length - 1][1]; };
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i, e = E[k];
      let c;
      if (e < SEA) { const d = e / SEA; c = [22 + 40 * d, 48 + 60 * d, 84 + 70 * d]; }   // sea: deeper further from land
      else {
        c = tint((e - SEA) / (1 - SEA));
        const nw = E[Math.max(0, j - 1) * gw + Math.max(0, i - 1)], se = E[Math.min(gh - 1, j + 1) * gw + Math.min(gw - 1, i + 1)];
        const shadeF = Math.max(0.55, Math.min(1.35, 1 + (nw - se) * 9));   // light from the north-west
        const fog = (1 - A[k]) * 0.42;                                       // quiet ground: fog
        c = c.map(v => (v * shadeF) * (1 - fog) + 214 * fog);
      }
      img.data.set([c[0], c[1], c[2], 255], k * 4);
    }
    oc.putImageData(img, 0, 0);
    // contour lines (marching squares), in world coordinates
    const contours = [];
    for (let lv = SEA, li = 0; lv < 1; lv += 0.055, li++) {
      const seg = [];
      for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
        const a = E[j * gw + i], b = E[j * gw + i + 1], c = E[(j + 1) * gw + i + 1], d = E[(j + 1) * gw + i];
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const T = [i + (lv - a) / (b - a), j], Rr = [i + 1, j + (lv - b) / (c - b)], B = [i + (lv - d) / (c - d), j + 1], Lf = [i, j + (lv - a) / (d - a)];
        const pairs = { 1: [Lf, B], 2: [B, Rr], 3: [Lf, Rr], 4: [T, Rr], 5: [Lf, T, B, Rr], 6: [T, B], 7: [Lf, T], 8: [Lf, T], 9: [T, B], 10: [T, Rr, Lf, B], 11: [T, Rr], 12: [Lf, Rr], 13: [B, Rr], 14: [Lf, B] }[idx];
        for (const p of pairs) seg.push(x0 + p[0] * CELL, y0 + p[1] * CELL);
      }
      contours.push({ major: li % 4 === 0, seg });
    }
    // each topic's summit: its highest note
    const peaks = [];
    DATA.clusters.forEach(c => {
      let best = null, bh = -1;
      ns.filter(n => n.cluster === c.id).forEach(n => { const [x, y] = geo.get(n.id), h = E[Math.round((y - y0) / CELL) * gw + Math.round((x - x0) / CELL)] || 0; if (h > bh) { bh = h; best = [x, y]; } });
      if (best && c.size >= 4) peaks.push({ c: c.id, x: best[0], y: best[1], h: bh });
    });
    return { pos: geo, img: off, x0, y0, w: gw * CELL, h: gh * CELL, contours, peaks, E, gw, CELL, SEA };
  }

  // City: each topic is a district and each note a building. Height = how much the vault relies on it,
  // footprint = how long it is, lit windows = recent edits and mentions, grey and dark = stale, a crane = new.
  // Notes you link to but haven't written are empty lots in the Planned district.
  const U = 22;   // one lot, in world units
  const iso = (gx, gy) => [(gx - gy) * U * 0.866, (gx + gy) * U * 0.5];
  function cityLayout(geo) {
    const groups = {};
    nodes.forEach(n => { if (n.person || n.moc) return; const c = n.ghost ? -2 : n.cluster; (groups[c] = groups[c] || []).push(n); });
    const placed = [], b = new Map(), districts = [];
    Object.entries(groups).sort((a, b) => b[1].length - a[1].length).forEach(([c, ms]) => {
      c = +c; ms.sort(byImportance);
      const { cols, rows } = gridDims(ms.length), w = cols + 1, h = rows + 2;   // the front row is the plaza
      const cen = ms.reduce((s, n) => { const p = geo.get(n.id); return [s[0] + p[0], s[1] + p[1]]; }, [0, 0]).map(v => v / ms.length);
      const tx = Math.round(cen[0] / 40 - w / 2), ty = Math.round(cen[1] / 40 - h / 2);
      const hits = (x, y) => placed.some(r => x < r[0] + r[2] + 1 && x + w + 1 > r[0] && y < r[1] + r[3] + 1 && y + h + 1 > r[1]);
      let bx = tx, by = ty;
      outer: for (let r = 0; r < 60; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || hits(tx + dx, ty + dy)) continue;
        bx = tx + dx; by = ty + dy; break outer;
      }
      placed.push([bx, by, w, h]); districts.push({ c, bx, by, w, h, act: ms.reduce((t, n) => t + activity(n), 0) / ms.length,
        dark: ms.filter(n => !n.ghost && staleFor(n, Q.stale_days)).length, hall: c >= 0 && mocOf[c] && byId[mocOf[c].id] ? mocOf[c].id : null });
      // tallest at the back so they don't hide the rest: fill lots from the back corner forward
      const lots = []; for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) lots.push([q, r]);
      lots.sort((p1, p2) => (p1[0] + p1[1]) - (p2[0] + p2[1]) || p1[0] - p2[0]);
      ms.forEach((n, i) => { const [q, r] = lots[i];
        b.set(n.id, { gx: bx + q + 0.75, gy: by + r + 0.75, h: n.ghost ? 0 : 4 + 165 * Math.pow(importance(n), 1.6), f: 0.34 + 0.26 * Math.sqrt(Math.min(1, (n.words || 0) / 2000)) }); });
    });
    const week = Date.now() - 7 * 864e5;
    const cranes = new Set(nodes.filter(n => n.born && !n.ghost && b.has(n.id) && new Date(n.born + "T12:00") >= week).sort((x, y) => y.born.localeCompare(x.born)).slice(0, 15).map(n => n.id));
    const pos = new Map(geo); b.forEach((v, id) => pos.set(id, iso(v.gx, v.gy)));
    // the outline the camera frames: each building's top with room for its crane and name, and the streets round each district
    const bounds = [...[...b.values()].map(v => { const [x, y] = iso(v.gx, v.gy); return [x, y - v.h - 30]; }),
      ...districts.flatMap(d => [[-0.55, -0.55], [d.w + 0.55, -0.55], [d.w + 0.55, d.h + 0.55], [-0.55, d.h + 0.55]].map(([x, y]) => iso(d.bx + x, d.by + y)))];
    return { b, districts, pos, cranes, bounds };
  }

  function applyMapLayout(animate) {
    impMax = null;
    const geo = geography(), v = st.view;
    const M = mapCache[v] = SCENES[v] ? SCENES[v].layout(geo) : v === "subway" ? subwayLayout(geo) : v === "topo" ? topoLayout(geo) : v === "garden" ? gardenLayout(geo) : v === "palace" ? palaceLayout(geo)
      : ({ weather: weatherLayout, ships: shipsLayout, rings: ringsLayout, sky: skyLayout, realm: realmLayout, foodweb: foodwebLayout, alchemy: alchemyLayout, lineage: lineageLayout, ripples: ripplesLayout, clock: clockLayout, radar: radarLayout }[v] || cityLayout)(geo);
    if (animate) morphTo(n => { const p = M.pos.get(n.id); return p ? [p[0], p[1], 0] : null; }, 950);
    else nodes.forEach(n => { const p = M.pos.get(n.id); if (p) { n.x = p[0]; n.y = p[1]; n.z = 0; } });
  }
  const mapFitPred = () => SCENES[st.view] ? (SCENES[st.view].fit || (n => !special(n) && !n.ghost)) : st.view === "palace" ? (n => !special(n) && !n.ghost && (!mapCache.palace || !mapCache.palace.onFloor || mapCache.palace.onFloor.has(n.id))) : st.view === "subway" ? (n => mapCache.subway && mapCache.subway.stations.has(n.id))
    : st.view === "city" ? (n => mapCache.city && mapCache.city.b.has(n.id) && !n.ghost) : st.view === "palace" ? (n => !special(n)) : st.view === "radar" ? (n => !special(n) && n.tasks > 0)
    : st.view === "realm" ? (n => !special(n) && !n.ghost) : (n => !special(n) && !n.ghost);

  function mapFrame() {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
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
  // iso: "iso" | "tilt" (true = "iso"), the palace's floors are "iso"; the person's choice for the view (st.angles,
  // the angle button or 3) wins over both
  const isoAngle = () => { const d = SCENES[st.view], own = d && d.iso ? (d.iso === true ? "iso" : d.iso)
      : st.view === "palace" && mapCache.palace && !mapCache.palace.facade ? "iso" : null;
    return own && (st.angles[st.view] || own); };
  const isoScene = () => { const a = isoAngle(); return a && ISO_VIEWS[a]; };
  const ANGLES = [["flat", "Flat"], ["tilt", "Tilt"], ["iso", "Iso"]];
  function cycleAngle() {
    const a = isoAngle(); if (!a) return;
    const i = ANGLES.findIndex(([k]) => k === a), [next, name] = ANGLES[(i + 1) % ANGLES.length];
    st.angles[st.view] = next; syncAngleBtn(); persistSoon(); fit(null); dirty = true; kick(); toast(`${name} view`, "ok");
  }
  function syncAngleBtn() {
    const b = $(".vg-anglebtn"); if (!b) return; const a = isoAngle();
    b.hidden = !a; if (a) b.querySelector(".vg-tlabel").textContent = ANGLES.find(([k]) => k === a)[1];
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

  function drawTopo(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), T = mapCache.topo;
    ctx.fillStyle = "#16304f"; ctx.fillRect(0, 0, W, H);
    if (!T) return;
    const o = scr(0, 0, R);   // world origin on screen: world (x, y) -> (o.x + x*k, o.y + y*k)
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * o.x, dpr * o.y);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(T.img, T.x0, T.y0, T.w, T.h);
    ctx.strokeStyle = "rgba(52,36,22,0.32)";
    T.contours.forEach(c => { ctx.lineWidth = (c.major ? 1.1 : 0.5) / k; ctx.beginPath();
      for (let i = 0; i < c.seg.length; i += 4) { ctx.moveTo(c.seg[i], c.seg[i + 1]); ctx.lineTo(c.seg[i + 2], c.seg[i + 3]); } ctx.stroke(); });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // rivers: from each summit, steepest descent over the elevation field down to the sea, flowing
    if (!T.rivers) { const gh = T.E.length / T.gw; T.rivers = T.peaks.filter(pk => pk.h > 0.12).map(pk => {
      let i = Math.round((pk.x - T.x0) / T.CELL), j = Math.round((pk.y - T.y0) / T.CELL); const pts = [];
      for (let step = 0; step < 500; step++) { pts.push([T.x0 + i * T.CELL, T.y0 + j * T.CELL]); const e = T.E[j * T.gw + i]; if (e < T.SEA) break;
        let bi = i, bj = j, be = e; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= T.gw || jj >= gh) continue; const v = T.E[jj * T.gw + ii]; if (v < be) { be = v; bi = ii; bj = jj; } }
        if (bi === i && bj === j) break; i = bi; j = bj; }
      return pts; }).filter(p => p.length > 4); }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    T.rivers.forEach(pts => { ctx.beginPath(); pts.forEach(([x, y], q) => { const s0 = scr(x, y, R); q ? ctx.lineTo(s0.x, s0.y) : ctx.moveTo(s0.x, s0.y); });
      ctx.strokeStyle = "rgba(37,99,235,.55)"; ctx.lineWidth = Math.max(1.4, 2.6 * Math.sqrt(k)); ctx.setLineDash([]); ctx.stroke();
      ctx.strokeStyle = "rgba(191,219,254,.75)"; ctx.lineWidth = Math.max(0.8, 1.2 * Math.sqrt(k)); ctx.setLineDash([3, 9]); ctx.lineDashOffset = reducedMotion() ? 0 : -now / 45; ctx.stroke(); });
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // links across topics are bridges over the valleys; suggested links are dotted ferry routes
    ctx.lineWidth = 1;
    for (const l of visLinks) {
      if (special(l.s) || special(l.t)) continue;
      const cross = l.kind === "link" && l.s.cluster !== l.t.cluster, sug = l.kind === "gap" || l.kind === "similar";
      if (!cross && !sug) continue;
      const a = scr(l.s.x, l.s.y, R), b = scr(l.t.x, l.t.y, R), on = !litSet || (litSet.has(l.s.id) && litSet.has(l.t.id));
      ctx.globalAlpha = on ? (litSet ? 0.9 : 0.45) : 0.06; ctx.strokeStyle = sug ? "#bfe3ff" : "#3a2a1a"; ctx.setLineDash(sug ? [2, 4] : [5, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    // notes: small markers; summits labelled with the topic and a made-up height
    const marks = active.filter(n => !special(n) && !n.ghost).sort((a, b) => importance(a) - importance(b));
    marks.forEach(n => {
      const p = scr(n.x, n.y, R), on = !litSet || litSet.has(n.id), r = Math.max(1.8, (1.6 + 3 * importance(n)) * Math.sqrt(k));
      ctx.globalAlpha = on ? 0.95 : 0.25; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fillStyle = litSet && on ? "#fff" : "#2a1e14"; ctx.fill();
      if (st.selected === n.id) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, 2 * Math.PI); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -importance(n), r: Math.max(r, 4), a: on ? 1 : 0.3 });
    });
    ctx.globalAlpha = 1;
    if (!T.fogs) T.fogs = nodes.filter(n => !special(n) && !n.ghost && activity(n) < 0.02 && T.pos.get(n.id)).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, 9).map(n => T.pos.get(n.id));
    T.fogs.forEach(([x, y], i) => { const dx = reducedMotion() ? 0 : Math.sin(now / 9000 + i) * 60, q = scr(x + dx, y + Math.cos(now / 11000 + i * 2) * 25, R), rr = 110 * k;   // fog banks drift over quiet ground
      const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rr); g.addColorStop(0, "rgba(241,245,249,.32)"); g.addColorStop(1, "rgba(241,245,249,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(q.x, q.y, rr, rr * 0.55, 0, 0, 2 * Math.PI); ctx.fill(); });
    T.peaks.slice().sort((a, b) => b.h - a.h).forEach(pk => {
      const p = scr(pk.x, pk.y, R), name = `▲ ${clip(clusterName(pk.c), 30)}`, f = `italic 600 ${pk.h > 0.6 ? 13.5 : 11.5}px Georgia, serif`;
      ctx.font = f; const w = ctx.measureText(name).width;
      if (!freeSpot(p.x - w / 2, p.y - 26, w, 28)) return;
      haloText(name, p.x, p.y - 18, "#1d140c", "rgba(255,250,240,.55)", f, "center", 2);
      haloText(`${Math.round(pk.h * 2400).toLocaleString()} m`, p.x, p.y - 5, "#4b3a2a", "rgba(255,250,240,.5)", `500 9.5px ${font}`, "center", 2);
    });
    if (k > 1.4) marks.slice().reverse().forEach(n => {   // zoomed in: note names where there's room
      const p = P.get(n.id), text = clip(n.name, 26), f = `500 10.5px ${font}`; ctx.font = f; const w = ctx.measureText(text).width;
      if (freeSpot(p.x + p.r + 2, p.y - 6, w, 12)) haloText(text, p.x + p.r + 2, p.y, "#1d140c", "rgba(255,250,240,.8)", f);
    });
  }

  const hexMix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), A = p(a), B = p(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
  function drawCity(now) {
    const { dpr, R, litSet, font, k } = mapFrame(), C = mapCache.city;
    // the sky follows your clock: night, dawn and dusk glow, a muted day (dark enough that lit windows still read)
    const { night, dusk } = daylight();
    const SKY = night ? ["#070b1d", "#1b1638", "#33204a"] : dusk ? ["#1e1b4b", "#7c2d5e", "#f59e0b"] : ["#1e3a5f", "#3b6a9a", "#7fa7cf"];
    backdrop(SKY[0], [0.65, SKY[1]], [1, SKY[2]]);
    if (night || dusk) for (let i = 0; i < (MOBILE ? 60 : 140); i++) { const h = hash("star" + i); ctx.globalAlpha = 0.25 + (h % 60) / 100; ctx.fillStyle = "#fff"; ctx.fillRect((h % 997) / 997 * W, ((h >>> 10) % 991) / 991 * H * 0.6, 1.3, 1.3); }
    ctx.globalAlpha = 1;
    if (!C) return;
    const pt = (gx, gy, z) => { const [x, y] = iso(gx, gy), p = scr(x, y, R); return [p.x, p.y - z * k]; };
    // streets: an asphalt ring round every district with a dashed centre line
    const poly = ps => { ctx.beginPath(); ps.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
    const ring = (d, o) => [[d.bx - o, d.by - o], [d.bx + d.w + o, d.by - o], [d.bx + d.w + o, d.by + d.h + o], [d.bx - o, d.by + d.h + o]].map(([x, y]) => pt(x, y, 0));
    C.districts.forEach(d => { poly(ring(d, 0.55)); ctx.fillStyle = night ? "#141826" : "#262b38"; ctx.fill(); });
    ctx.setLineDash([4 * k, 5 * k]); ctx.strokeStyle = "rgba(250,204,21,.28)"; ctx.lineWidth = Math.max(0.6, 0.8 * k);
    C.districts.forEach(d => { poly(ring(d, 0.27)); ctx.stroke(); }); ctx.setLineDash([]);
    // district ground plates and their names
    C.districts.forEach(d => {
      const cs = [[d.bx, d.by], [d.bx + d.w, d.by], [d.bx + d.w, d.by + d.h], [d.bx, d.by + d.h]].map(([x, y]) => pt(x, y, 0));
      const col = d.c === -2 ? "#5b5f6b" : d.c < 0 ? "#4b5160" : colorOf(d.c);
      ctx.beginPath(); cs.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
      ctx.fillStyle = hexMix(col, "#0d1022", 0.72); ctx.fill(); ctx.strokeStyle = hexMix(col, "#0d1022", 0.4); ctx.lineWidth = 1; ctx.stroke();
    });
    // traffic: cars circle each district's streets, more where the topic is busy; headlights ahead, tail lights behind
    C.districts.forEach(d => {
      const o = 0.27, W0 = d.w + 2 * o, H0 = d.h + 2 * o, per = 2 * (W0 + H0), cars = Math.min(MOBILE ? 3 : 7, 1 + Math.round(6 * d.act));
      const at = s => { s = ((s % per) + per) % per; const x0 = d.bx - o, y0 = d.by - o;
        return s < W0 ? [x0 + s, y0] : s < W0 + H0 ? [x0 + W0, y0 + s - W0] : s < 2 * W0 + H0 ? [x0 + W0 - (s - W0 - H0), y0 + H0] : [x0, y0 + H0 - (s - 2 * W0 - H0)]; };
      for (let j = 0; j < cars; j++) { const s = (reducedMotion() ? 0 : now / 900) + j * per / cars + (hash(String(d.c)) % 50) / 10, hd = pt(...at(s + 0.12), 0), tl = pt(...at(s - 0.12), 0);
        ctx.fillStyle = "rgba(254,240,138,.95)"; ctx.beginPath(); ctx.arc(hd[0], hd[1], Math.max(1, 1.3 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "rgba(248,113,113,.9)"; ctx.beginPath(); ctx.arc(tl[0], tl[1], Math.max(0.9, 1.1 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
    });
    // buildings, back to front (planned lots always show)
    const lot = [...C.b.entries()].filter(([id]) => byId[id].ghost ? !replay : mapShown(byId[id])).sort((a, b) => (a[1].gx + a[1].gy) - (b[1].gx + b[1].gy));
    // shadows first, so buildings stand on the ground rather than on a neighbour's shadow
    ctx.fillStyle = night ? "rgba(0,0,0,.18)" : "rgba(0,0,0,.28)";
    lot.forEach(([id, B]) => { const n = byId[id]; if (n.ghost) return; const base = scr(n.x, n.y, R), hf = B.f / 2, sx = B.h * k * 0.42, sy = B.h * k * 0.14;
      const c = (dx, dy) => [base.x + (dx - dy) * U * 0.866 * k, base.y + (dx + dy) * U * 0.5 * k], bk = c(-hf, -hf), rt = c(hf, -hf), fr = c(hf, hf), lf = c(-hf, hf);
      poly([bk, rt, [rt[0] + sx, rt[1] + sy], [fr[0] + sx, fr[1] + sy], [lf[0] + sx, lf[1] + sy], lf]); ctx.fill(); });
    const sel = st.selected && C.b.get(st.selected);
    lot.forEach(([id, B]) => {
      const n = byId[id], on = !litSet || litSet.has(id), half = B.f / 2;
      // the note's position (it morphs in) is the lot's centre; corners are offsets from it
      const base = scr(n.x, n.y, R), off = (dx, dy, z) => [base.x + (dx - dy) * U * 0.866 * k, base.y + (dx + dy) * U * 0.5 * k - z * k];
      const bk = off(-half, -half, 0), rt = off(half, -half, 0), fr = off(half, half, 0), lf = off(-half, half, 0);
      ctx.globalAlpha = on ? 1 : 0.22;
      if (n.ghost) {   // planned: an empty lot
        ctx.setLineDash([3, 3]); ctx.strokeStyle = "#9aa3b5"; ctx.lineWidth = 1; ctx.beginPath(); [bk, rt, fr, lf].forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        P.set(id, { x: fr[0], y: (bk[1] + fr[1]) / 2, s: base.s, depth: -(B.gx + B.gy), r: Math.max(5, (fr[1] - bk[1]) / 2), a: on ? 1 : 0.3 });
        return;
      }
      const stale = staleFor(n, Q.stale_days), base0 = n.cluster >= 0 ? colorOf(n.cluster) : "#8b93a6";
      const col = stale ? hexMix(base0, "#5e626d", 0.72) : base0, h = B.h;
      const up = ([x, y]) => [x, y - h * k], xy = ([x, y]) => ({ x, y });
      // the tower: its roof pushed down to the street, through the shared prism (lit from the upper left like every solid)
      prism([up(bk), up(rt), up(fr), up(lf)].map(xy), { x: 0, y: h * k }, hexMix(col, "#ffffff", stale ? 0.05 : 0.18));
      // windows: lit by recent activity (a stable pattern per note), dark otherwise
      const act = activity(n), floors = Math.max(1, Math.floor(h / 9)), px = 1.6 * Math.sqrt(k);
      if (px >= 1) for (let fl = 0; fl < floors; fl++) for (let side = 0; side < 2; side++) for (let w = 0; w < 2; w++) {
        const t = (w + 0.5) / 2, z = (fl + 0.55) * (h / floors), [a1, a2] = side ? [fr, rt] : [lf, fr];
        const x = a1[0] + (a2[0] - a1[0]) * t, y = a1[1] + (a2[1] - a1[1]) * t - z * k;
        const flick = !reducedMotion() && hash(id + fl + side + w + Math.floor(now / 2600)) % 29 === 0;   // now and then a light goes on or off
        const litW = ((hash(id + fl + "|" + side + w) % 100) < act * 100) !== flick;
        ctx.fillStyle = litW ? "#ffd977" : "rgba(10,12,24,.55)"; ctx.fillRect(x - px / 2, y - px, px, px * 1.3);
      }
      // a crane on the newest notes (last week, at most 15)
      if (C.cranes && C.cranes.has(id)) {
        const [tx, ty] = up(fr), m = Math.max(10, 18 * Math.sqrt(k));
        ctx.strokeStyle = "#facc15"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty - m); ctx.lineTo(tx + m * 0.9, ty - m); ctx.moveTo(tx + m * 0.6, ty - m); ctx.lineTo(tx + m * 0.6, ty - m * 0.55); ctx.stroke();
      }
      if (n.tasks > 0) { const cx = (up(bk)[0] + up(fr)[0]) / 2, cy = (up(bk)[1] + up(fr)[1]) / 2, blink = reducedMotion() || Math.sin(now / 380 + hash(id) % 7) > 0.2;   // open tasks: a beacon
        ctx.fillStyle = blink ? "#ef4444" : "rgba(239,68,68,.25)"; ctx.beginPath(); ctx.arc(cx, cy - 2, Math.max(1.2, 1.8 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
      if (id === st.selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); [up(bk), up(rt), up(fr), up(lf)].forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); }
      P.set(id, { x: (lf[0] + rt[0]) / 2, y: fr[1] - (h * k) / 2 - (fr[1] - bk[1]) / 4, s: base.s, depth: -(B.gx + B.gy), r: Math.max(6, Math.max(rt[0] - lf[0], h * k) / 2), a: on ? 1 : 0.3,
        box: body([lf[0], up(bk)[1], rt[0] - lf[0], fr[1] - up(bk)[1]]) });   // the tower's screen box, so names keep off it
    });
    ctx.globalAlpha = 1;
    // town halls: each district's map stands in its plaza (click it like any note); no map = an empty plaza with a sign
    C.districts.forEach(d => { if (d.c < 0) return; const [x, y] = pt(d.bx + d.w / 2, d.by + d.h - 0.55, 0), s = Math.max(4, 9 * k);
      if (!d.hall) return;   // its "no map yet" sign goes with the names below
      ctx.globalAlpha = !litSet || litSet.has(d.hall) ? 1 : 0.3;
      ctx.fillStyle = "#e5e7eb"; ctx.fillRect(x - s, y - s * 1.1, s * 2, s * 1.1);
      ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.arc(x, y - s * 1.1, s * 0.75, Math.PI, 0); ctx.fill();
      ctx.fillStyle = "rgba(30,41,59,.75)"; for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * s * 0.6 - s * 0.12, y - s * 0.8, s * 0.24, s * 0.8);
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y - s * 1.85); ctx.lineTo(x, y - s * 2.8); ctx.stroke();
      ctx.fillStyle = colorOf(d.c); ctx.beginPath(); ctx.moveTo(x, y - s * 2.8); ctx.lineTo(x + s * 0.9, y - s * 2.5); ctx.lineTo(x, y - s * 2.2); ctx.fill();
      ctx.globalAlpha = 1; P.set(d.hall, { x, y: y - s, s: 1, depth: -(d.bx + d.by + d.w + d.h), r: s * 1.4, a: 1 });
      if (d.hall === st.selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(x - s - 2, y - s * 2.9, s * 2 + 4, s * 2.9 + 2); } });
    // selected building: light trails to its linked buildings
    if (sel) {
      const top = id => { const n = byId[id], B = C.b.get(id), p = scr(n.x, n.y, R); return [p.x, p.y - (B ? B.h : 0) * k]; };
      const [sx, sy] = top(st.selected);
      ctx.strokeStyle = "rgba(255,217,119,.75)"; ctx.lineWidth = 1.4;
      [...nb[st.selected]].filter(id => C.b.has(id) && visible(byId[id])).forEach(id => { const [x, y] = top(id); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo((sx + x) / 2, Math.min(sy, y) - 40, x, y); ctx.stroke(); });
    }
    // district names on the ground (and a plaza with no town hall says so), then the tallest buildings' names
    C.districts.forEach(d => {
      const [x, y] = pt(d.bx + d.w / 2, d.by + d.h + 0.4, 0), name = d.c === -2 ? "PLANNED (NOT WRITTEN YET)" : d.c < 0 ? "OUTSKIRTS" : clip(shortName(d.c), k > 0.8 ? 26 : 18).toUpperCase() + (d.dark && k > 0.8 ? ` · ${d.dark} DARK` : "");   // zoomed out: short names only
      const f = `700 10.5px ${font}`; ctx.font = f; const w = ctx.measureText(name).width;
      if (freeSpot(x - w / 2, y - 7, w, 14)) haloText(name, x, y, "#c7cbe0", "#0b0e20", f, "center");
      if (d.c < 0 || d.hall || k <= 0.45) return;
      const [sx, sy] = pt(d.bx + d.w / 2, d.by + d.h - 0.55, 0), sf = `700 ${Math.round(Math.max(8, Math.min(11, 9 * k)))}px ${font}`; ctx.font = sf; const sw = ctx.measureText("no map yet").width;
      if (freeSpot(sx - sw / 2, sy - 7, sw, 14)) haloText("no map yet", sx, sy, "#fbbf24", "#0b0e20", sf, "center");
    });
    noteLabels(lot.filter(([id]) => !byId[id].ghost).sort((a, b) => b[1].h - a[1].h).map(([id]) => id), "#f2f3fa", "#0b0e20", MOBILE ? 12 : 28);
  }

  // Garden: a digital garden, where notes grow from seed to evergreen. Each topic is a bed; a note's stage comes from
  // how developed it is (length, notes relying on it, references, age). Stale notes wilt, notes with open tasks need
  // water, recently active ones flower, orphans (nothing links to them) have weeds. Unlinked notes wait in the
  // nursery; notes you link to but haven't written are seed packets.
  const GC = 30;   // one plant's plot, in world units
  // unlinked notes have a place of their own here (the nursery, the storeroom), so they show without "Show unlinked"
  const mapShown = n => visible(n) || (n.isolated && !replay && !st.focusDist && !st.hidden.has(n.id) && !st.hiddenClusters.has(n.cluster));
  const maturity = n => n.ghost ? 0 : 0.35 * Math.min(1, (n.words || 0) / 1500) + 0.35 * Math.min(1, Math.log1p(n.inlinks || 0) / Math.log(12))
    + 0.15 * (n.refs ? 1 : 0) + 0.15 * Math.min(1, n.born ? (Date.now() - new Date(n.born + "T12:00")) / 864e5 / 180 : 0);
  const STAGES = ["seed packet", "seed", "seedling", "budding", "evergreen"];
  const stageOf = n => { if (n.ghost) return 0; const m = maturity(n); return m < 0.2 ? 1 : m < 0.42 ? 2 : m < 0.65 ? 3 : 4; };
  // beds keep the familiar 2D arrangement: rows by where each topic sits top to bottom, left to right within a row
  function packBeds(groups, geo, size) {
    const cen = ms => ms.reduce((s, n) => { const p = geo.get(n.id) || [0, 0]; return [s[0] + p[0] / ms.length, s[1] + p[1] / ms.length]; }, [0, 0]);
    const items = Object.entries(groups).map(([c, ms]) => ({ c: +c, ms, cen: cen(ms), ...size(ms) }));
    const total = items.reduce((s, it) => s + it.w * it.h, 0), ROW_W = Math.max(900, Math.sqrt(total) * 1.5);
    const main = items.filter(it => it.c > -2).sort((a, b) => a.cen[1] - b.cen[1]), extra = items.filter(it => it.c <= -2);
    const rows = []; let row = [], rw = 0;
    main.forEach(it => { if (row.length && rw + it.w > ROW_W) { rows.push(row); row = []; rw = 0; } row.push(it); rw += it.w + 40; });
    if (row.length) rows.push(row);
    if (extra.length) rows.push(extra);
    let y = 0;
    rows.forEach(r => { r.sort((a, b) => (a.c <= -2) - (b.c <= -2) || a.cen[0] - b.cen[0]); const wsum = r.reduce((s, it) => s + it.w, 0) + 40 * (r.length - 1);
      let x = -wsum / 2; const h = Math.max(...r.map(it => it.h)); r.forEach(it => { it.x = x; it.y = y; x += it.w + 40; }); y += h + 56; });
    items.forEach(it => { it.y -= y / 2; });
    return items;
  }
  function gardenLayout(geo) {
    const groups = {};
    nodes.forEach(n => { if (n.person || n.moc) return; const c = n.ghost ? -2 : n.isolated ? -3 : n.cluster; (groups[c] = groups[c] || []).push(n); });
    const beds = packBeds(groups, geo, ms => { const { cols } = gridDims(ms.length, 1.7); return { cols, w: cols * GC + 24, h: Math.ceil(ms.length / cols) * GC + 44 }; });
    const pos = new Map(geo), plant = new Map();
    beds.forEach(b => {
      b.ms.sort((x, y) => maturity(y) - maturity(x));   // evergreens at the back of the bed
      b.ms.forEach((n, i) => { const x = b.x + 12 + (i % b.cols + 0.5) * GC, y = b.y + 34 + (Math.floor(i / b.cols) + 0.5) * GC;
        pos.set(n.id, [x, y]); plant.set(n.id, stageOf(n)); });
      b.stats = { ever: b.ms.filter(n => plant.get(n.id) === 4).length, wilt: b.ms.filter(n => !n.ghost && staleFor(n, Q.stale_days)).length };
    });
    // the beds' corners, so the camera frames whole beds (names and edges), not just the plants in them
    return { beds, pos, plant, bounds: beds.flatMap(b => [[b.x, b.y - 8], [b.x + b.w, b.y + b.h]]) };
  }
  function drawGarden(now) {
    const { R, litSet, font, k } = mapFrame(), G = mapCache.garden;
    backdrop("#16261a", "#22351f");
    if (!G) return;
    const u = Math.max(0.35, k);   // plant scale on screen
    G.beds.forEach(b => {
      const p = scr(b.x, b.y, R), w = (b.cols * GC + 24) * k, h = (Math.ceil(b.ms.length / b.cols) * GC + 44) * k;
      ctx.fillStyle = b.c === -3 ? "#5a4636" : b.c === -2 ? "#3a3f36" : "#4a3325"; ctx.strokeStyle = b.c >= 0 ? hexMix(colorOf(b.c), "#4a3325", 0.45) : "#6d5644"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x, p.y, w, h, 8 * k) : ctx.rect(p.x, p.y, w, h); ctx.fill(); ctx.stroke();
      const name = b.c === -3 ? "NURSERY · NOT LINKED YET" : b.c === -2 ? "SEED PACKETS · NOT WRITTEN YET" : b.c < 0 ? "UNSORTED · NO TOPIC YET" : clip(shortName(b.c), 28).toUpperCase();
      const f = `700 ${Math.max(9, Math.min(12, 11 * Math.sqrt(k)))}px ${font}`; ctx.font = f;
      if (w > 60 && freeSpot(p.x + 8, p.y + 4, Math.min(w - 16, ctx.measureText(name).width), 14)) {
        haloText(name, p.x + 8, p.y + 12 * Math.min(1.2, Math.max(0.8, k)), b.c >= 0 ? hexMix(colorOf(b.c), "#ffffff", 0.45) : "#d6c7b4", "#2b1d14", f);
        if (b.c >= 0 && k > 0.55) haloText(`${b.stats.ever} evergreen · ${b.stats.wilt} wilting`, p.x + 8, p.y + 25 * Math.min(1.2, Math.max(0.8, k)), "#c9b8a0", "#2b1d14", `500 9.5px ${font}`);
      }
    });
    const leaf = (x, y, rx, ry, a, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, 2 * Math.PI); ctx.fill(); };
    for (const b of G.beds) for (const n of b.ms) {
      if (!(n.ghost ? !replay : mapShown(n))) continue;   // seed packets always show, like City's planned lots
      const p = scr(n.x, n.y, R), on = !litSet || litSet.has(n.id), stg = G.plant.get(n.id), wilt = !n.ghost && staleFor(n, Q.stale_days);
      const green = wilt ? "#9a8a45" : "#4caf50", dark = wilt ? "#7a6a32" : "#2e7d32", sway = reducedMotion() ? 0 : Math.sin(now / 1300 + hash(n.id) % 7) * 0.08;
      const bx = p.x, by = p.y + 9 * u;   // ground level
      ctx.globalAlpha = on ? 1 : 0.22;
      if (stg === 0) { ctx.fillStyle = "#cbbf9f"; ctx.fillRect(bx - 5 * u, by - 13 * u, 10 * u, 13 * u); ctx.fillStyle = colorOf(-1); ctx.fillRect(bx - 3 * u, by - 10 * u, 6 * u, 4 * u); }
      else if (stg === 1) { leaf(bx, by - 2 * u, 3.2 * u, 2.2 * u, 0, "#8d6e4f"); leaf(bx, by - 5 * u, 1 * u, 2 * u, sway, green); }
      else {
        const hgt = (stg === 2 ? 9 : stg === 3 ? 15 : 12) * u, tip = [bx + (wilt ? 4 * u : sway * 10 * u), by - hgt];
        ctx.strokeStyle = stg === 4 ? "#6d4c2f" : dark; ctx.lineWidth = (stg === 4 ? 3 : 1.4) * u;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx, by - hgt * 0.6, tip[0], tip[1]); ctx.stroke();
        if (stg === 2) { leaf(tip[0] - 3 * u, tip[1] + 1 * u, 3.4 * u, 1.6 * u, -0.5 + (wilt ? 0.9 : 0), green); leaf(tip[0] + 3 * u, tip[1] + 1 * u, 3.4 * u, 1.6 * u, 0.5 + (wilt ? 0.9 : 0), green); }
        else if (stg === 3) { [0.35, 0.65].forEach(t => { const y = by - hgt * t; leaf(bx - 3.5 * u, y, 4 * u, 1.8 * u, -0.4, green); leaf(bx + 3.5 * u, y, 4 * u, 1.8 * u, 0.4, green); });
          ctx.fillStyle = wilt ? "#8a7a55" : colorOf(n.cluster); ctx.beginPath(); ctx.arc(tip[0], tip[1], 2.6 * u, 0, 2 * Math.PI); ctx.fill(); }
        else { const r = (9 + 4 * importance(n)) * u, cy = tip[1] - r * 0.55;
          leaf(tip[0], cy, r, r * 0.85, 0, dark); leaf(tip[0] - r * 0.25, cy - r * 0.25, r * 0.55, r * 0.45, 0, wilt ? "#a8984f" : "#43a047"); }
        if (!wilt && activity(n) > 0.3) {   // in flower: recently edited or talked about
          const fx = tip[0], fy = stg === 4 ? tip[1] - (9 + 4 * importance(n)) * u * 0.9 : tip[1] - 2 * u;
          ctx.fillStyle = hexMix(colorOf(n.cluster), "#ffffff", 0.35);
          for (let i = 0; i < 5; i++) { const a = i * 1.2566 + now / 4000; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 2.6 * u, fy + Math.sin(a) * 2.6 * u, 1.5 * u, 0, 2 * Math.PI); ctx.fill(); }
          ctx.fillStyle = "#fde047"; ctx.beginPath(); ctx.arc(fx, fy, 1.2 * u, 0, 2 * Math.PI); ctx.fill();
        }
      }
      if (n.tasks > 0 && !n.ghost && u > 0.5) { ctx.fillStyle = "#60a5fa"; ctx.beginPath(); ctx.moveTo(bx + 8 * u, by - 12 * u); ctx.quadraticCurveTo(bx + 11 * u, by - 7 * u, bx + 8 * u, by - 6 * u); ctx.quadraticCurveTo(bx + 5 * u, by - 7 * u, bx + 8 * u, by - 12 * u); ctx.fill(); }
      if (!n.ghost && !n.isolated && n.inlinks === 0 && u > 0.45) { ctx.strokeStyle = "#7c9a2a"; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = -1; i <= 1; i++) { ctx.moveTo(bx - 7 * u + i * 2 * u, by); ctx.lineTo(bx - 8 * u + i * 3 * u, by - 5 * u); } ctx.stroke(); }
      if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, by - 8 * u, 14 * u, 0, 2 * Math.PI); ctx.stroke(); }
      P.set(n.id, { x: bx, y: by - 8 * u, s: p.s, depth: -maturity(n), r: Math.max(7, 12 * u), a: on ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    // bees fly between flowering notes along their links (pollination); wilting plants drop leaves
    const gz = G.life || (G.life = { bees: [], leaves: [] }), gdt = tickOf(gz, now);
    const flowers = G.beds.flatMap(b => b.ms).filter(n => P.has(n.id) && !n.ghost && !staleFor(n, Q.stale_days) && activity(n) > 0.3);
    const pool = flowers.length ? flowers : G.beds.flatMap(b => b.ms).filter(n => P.has(n.id) && G.plant.get(n.id) >= 3);
    while (pool.length && gz.bees.length < Math.min(12, Math.max(3, pool.length))) { const a = pool[Math.floor(Math.random() * pool.length)]; gz.bees.push({ from: a.id, to: a.id, t: 1, dur: 1 }); }
    gz.bees.forEach(bee => { bee.t += gdt / bee.dur;
      if (bee.t >= 1) { bee.from = bee.to; const near = [...(nb[bee.from] || [])].filter(id => P.has(id)), fl = near.filter(id => flowers.some(f => f.id === id));
        bee.to = (fl.length ? fl : near.length ? near : pool.map(n => n.id))[Math.floor(Math.random() * (fl.length || near.length || pool.length))] || bee.from;
        bee.t = 0; bee.dur = 900 + Math.random() * 1600; }
      const A = P.get(bee.from), B = P.get(bee.to); if (!A || !B) { bee.t = 1; return; }
      const e = bee.t < 0.15 ? 0 : (bee.t - 0.15) / 0.85, x = A.x + (B.x - A.x) * e + Math.sin(now / 90 + bee.dur) * 2, y = A.y + (B.y - A.y) * e - Math.sin(e * Math.PI) * 24 - 8 * u;   // hovers, then hops over
      ctx.fillStyle = "rgba(255,255,255,.75)"; const wing = 2.2 + Math.abs(Math.sin(now / 25)) * 1.5; ctx.beginPath(); ctx.ellipse(x - 1, y - 2, wing, 1.2, -0.5, 0, 2 * Math.PI); ctx.ellipse(x + 1, y - 2, wing, 1.2, 0.5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.8, 0, 0, 2 * Math.PI); ctx.fill(); ctx.fillStyle = "#1c1917"; ctx.fillRect(x - 0.6, y - 1.7, 1.2, 3.4); });
    G.beds.flatMap(b => b.ms).forEach(n => { if (n.ghost || !staleFor(n, Q.stale_days) || !P.has(n.id) || gz.leaves.length > 60 || !chance(0.6, gdt)) return;
      const q = P.get(n.id); gz.leaves.push({ x: q.x, y: q.y - 6 * u, t: 0, sway: Math.random() * 6 }); });
    gz.leaves = gz.leaves.filter(l => (l.t += gdt) < 3200);
    gz.leaves.forEach(l => { const f = l.t / 3200, x = l.x + Math.sin(l.t / 400 + l.sway) * 6, y = l.y + f * 34 * u;
      ctx.globalAlpha = 1 - f; ctx.fillStyle = "#b08442"; ctx.beginPath(); ctx.ellipse(x, y, 2.4 * u, 1.2 * u, Math.sin(l.t / 300) , 0, 2 * Math.PI); ctx.fill(); });
    ctx.globalAlpha = 1;
    // names: evergreens first, then anything with room once zoomed in
    const named = G.beds.flatMap(b => b.ms).filter(n => P.has(n.id) && (G.plant.get(n.id) === 4 || k > 1.3)).sort((a, b) => maturity(b) - maturity(a)).slice(0, k > 1.3 ? 120 : MOBILE ? 14 : 30);
    named.forEach(n => { const p = P.get(n.id), text = clip(n.name, 24), f = `600 10px ${font}`; ctx.font = f; const w = ctx.measureText(text).width;
      if (freeSpot(p.x - w / 2, p.y + p.r * 0.4, w, 13)) haloText(text, p.x, p.y + p.r * 0.4 + 7, "#f1f5e9", "#1b2a18", f, "center"); });
  }

  // Palace: the method of loci. Each topic is a room in one building, sized by its notes. Topics that link are laid
  // side by side where they can be, with a door in the shared wall (wider = more links); linked rooms that don't
  // touch are joined by a passage, and topics that should connect but don't have a bricked-up doorway. Each note is
  // an object in its room -- bigger is more relied on, a lit lamp is recent activity, dust is stale -- and the
  // topic's map (MOC) is the plaque inside the door.
  function palaceLayout(geo) {
    const groups = {};
    nodes.forEach(n => { if (n.person || n.ghost || n.moc) return; const c = n.isolated ? -3 : n.cluster; (groups[c] = groups[c] || []).push(n); });
    // order rooms as a chain of strongest links, so split neighbours tend to share a wall
    const left = Object.keys(groups).map(Number).sort((a, b) => layoutSeed() ? topicRank(a) - topicRank(b) : groups[b].length - groups[a].length), order = left.length ? [left.shift()] : [];   // a vault with no topic notes has no rooms
    while (left.length) { const last = order[order.length - 1]; let bi = 0, bw = -1; left.forEach((c, i) => { const w = topicPair(last, c).links; if (w > bw) { bw = w; bi = i; } }); order.push(left.splice(bi, 1)[0]); }
    // Floors: the rooms in that order, a few topics per floor; the storeroom (unlinked notes) is the basement.
    // No floor chosen: the palace from the front. A floor: its plan, rooms and doors as before.
    const upper = order.filter(c => c !== -3), nf = Math.max(1, Math.round(Math.sqrt(upper.length / 1.5))), per = Math.ceil(upper.length / nf);
    const levels = groups[-3] ? [[-3]] : [];
    for (let i = 0; i < upper.length; i += per) levels.push(upper.slice(i, i + per));
    const hasBase = !!groups[-3];
    if (st.palaceFloor == null || st.palaceFloor >= levels.length) { st.palaceFloor = null; return palaceFacade(geo, groups, levels, hasBase); }
    const floorRooms = levels[st.palaceFloor];
    order.splice(0, order.length, ...floorRooms);
    // the storeroom packs tighter: it's for finding, not browsing
    const area = c => groups[c].length * (c === -3 ? 900 : 2400) + 9000, total = order.reduce((s, c) => s + area(c), 0);
    const BW = Math.sqrt(total * 1.6), BH = total / BW, rooms = [];
    (function split(list, x, y, w, h) {   // ordered binary split: keeps neighbours in the list next to each other
      if (list.length === 1) { rooms.push({ c: list[0], x, y, w, h }); return; }
      const sum = list.reduce((s, c) => s + area(c), 0); let acc = 0, i = 0;
      while (i < list.length - 1 && acc + area(list[i]) / 2 < sum / 2) acc += area(list[i++]);
      i = Math.max(1, i); const a = list.slice(0, i), f = a.reduce((s, c) => s + area(c), 0) / sum;
      if (w >= h) { split(a, x, y, w * f, h); split(list.slice(i), x + w * f, y, w * (1 - f), h); }
      else { split(a, x, y, w, h * f); split(list.slice(i), x, y + h * f, w, h * (1 - f)); }
    })(order, -BW / 2, -BH / 2, BW, BH);
    const pos = new Map(geo), obj = new Map(), byC = {};
    rooms.forEach(r => {
      byC[r.c] = r;
      const ms = groups[r.c].slice().sort(byImportance), pad = 22, top = 30;
      const iw = Math.max(10, r.w - 2 * pad), ih = Math.max(10, r.h - pad - top), cols = Math.max(1, Math.round(Math.sqrt(ms.length * iw / ih))), rows = Math.ceil(ms.length / cols);
      const cells = []; for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([r.x + pad + (i + 0.5) * iw / cols, r.y + top + (j + 0.5) * ih / rows]);
      const cx = r.x + r.w / 2, cy = r.y + top + ih / 2;
      cells.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));   // the most relied-on in the middle
      ms.forEach((n, i) => { pos.set(n.id, cells[i]); obj.set(n.id, Math.min(iw / cols, ih / rows)); });
      const m = mocOf[r.c]; if (m && byId[m.id]) pos.set(m.id, [r.x + 16, r.y + 16]);
    });
    // doors on shared walls; passages between linked rooms that don't touch; bricked-up doorways for gaps
    const doors = [], passages = [], EPS = 1;
    const wallBetween = (A, B) => {
      const ov = (a0, a1, b0, b1) => [Math.max(a0, b0), Math.min(a1, b1)];
      if (Math.abs(A.x + A.w - B.x) < EPS || Math.abs(B.x + B.w - A.x) < EPS) { const [s, e] = ov(A.y, A.y + A.h, B.y, B.y + B.h); if (e - s > 30) return { v: true, at: Math.abs(A.x + A.w - B.x) < EPS ? B.x : A.x, s, e }; }
      if (Math.abs(A.y + A.h - B.y) < EPS || Math.abs(B.y + B.h - A.y) < EPS) { const [s, e] = ov(A.x, A.x + A.w, B.x, B.x + B.w); if (e - s > 30) return { v: false, at: Math.abs(A.y + A.h - B.y) < EPS ? B.y : A.y, s, e }; }
      return null;
    };
    for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
      const A = rooms[i], B = rooms[j], { links: l, gap: g0 } = topicPair(A.c, B.c), gap = !l && g0;
      if (!l && !gap) continue;
      const wall = wallBetween(A, B);
      if (wall) { const mid = (wall.s + wall.e) / 2, half = Math.min((wall.e - wall.s) * 0.35, gap ? 14 : 8 + 4 * Math.sqrt(l)) ;
        doors.push({ ...wall, mid, half, gap, a: A.c, b: B.c, l }); }
      else if (l >= 2 || gap) passages.push({ a: A, b: B, l, gap });
    }
    passages.sort((p, q) => q.l - p.l);
    const onFloor = new Set(floorRooms.flatMap(c => groups[c].map(n => n.id)));
    floorRooms.forEach(c => { const m = mocOf[c]; if (m && byId[m.id]) onFloor.add(m.id); });
    const bounds = rooms.flatMap(r => [[r.x - 30, r.y - 30], [r.x + r.w + 30, r.y + r.h + 30], [r.x - 30, r.y + r.h + 30], [r.x + r.w + 30, r.y - 30]]);
    return { rooms, byC, pos, obj, doors, passages: passages.slice(0, 14), BW, BH, onFloor, floor: st.palaceFloor, levels, hasBase, bounds };
  }
  // The palace from the front: a floor per band of topics, a bay per topic, a window per note (lit = active, dark and
  // boarded = stale, a red sill = open tasks), the map's plaque over each bay, the storeroom below ground. Click a floor
  // (or zoom into one) to walk its rooms.
  function palaceFacade(geo, groups, levels, hasBase) {
    const pos = new Map(geo), bays = [], win = new Map(), FW = 1500, FH = 240, BASE_H = 150;
    levels.forEach((cs, li) => {
      const base = hasBase && li === 0, fi = hasBase ? li - 1 : li, y0 = base ? 24 : -(fi + 1) * FH, h = base ? BASE_H : FH;
      const weight = c => Math.sqrt(groups[c].length) + 1.5, total = cs.reduce((s, c) => s + weight(c), 0);
      let x = -FW / 2;
      cs.forEach(c => {
        const w = FW * weight(c) / total, bay = { c, x, y: y0, w, h, floor: li, base }; bays.push(bay);
        const ms = groups[c].slice().sort(byImportance), top = 40, pad = 16, iw = Math.max(10, w - 2 * pad), ih = Math.max(10, h - top - 26);
        const cols = Math.max(1, Math.round(Math.sqrt(ms.length * iw / ih * 1.3))), rows = Math.max(1, Math.ceil(ms.length / cols)), cw = iw / cols, ch = ih / rows;
        ms.forEach((n, i) => { pos.set(n.id, [x + pad + (i % cols + 0.5) * cw, y0 + top + (Math.floor(i / cols) + 0.5) * ch]); win.set(n.id, [Math.min(cw * 0.62, ch * 0.5), Math.min(ch * 0.72, cw * 0.95)]); });
        const m = mocOf[c]; if (m && byId[m.id]) pos.set(m.id, [x + w / 2, y0 + 15]);
        x += w;
      });
    });
    const cracks = [];
    bays.forEach((a, i) => { const b = bays[i + 1]; if (b && b.floor === a.floor) { const pr = topicPair(a.c, b.c); if (pr.gap && !pr.links) cracks.push(b); } });
    const top = -(levels.length - (hasBase ? 1 : 0)) * FH;
    return { facade: true, bays, pos, win, cracks, FW, FH, levels, hasBase, top, bounds: [[-FW / 2 - 40, top - 390], [FW / 2 + 190, (hasBase ? BASE_H + 40 : 40)]] };
  }
  function drawPalace(now) {
    const { R, litSet, font, k } = mapFrame(), M = mapCache.palace;
    floorBar(M);
    if (M && M.facade) return drawPalaceFacade(now, M, R, litSet, font, k);
    if (M && cam.userMoved && k < 0.3) { enterFloor(null); return; }   // zoomed right out of a floor: back outside
    // A floor in 3D: the plan seen from above at an angle, walls raised, each note a block on the floor (taller =
    // more relied on, glowing = active, grey and dusty = stale, a red cap = open tasks), the map's plaque on a stand.
    const bg = "#0b1830", ink = "rgba(226,236,255,.92)";
    backdrop("#0a1426", "#13284a");
    if (!M) return;
    const iso = isoKit(R, k), poly = iso.poly, corners = r => iso.rect(r.x, r.y, r.w, r.h);
    const WH = Math.max(6, 30 * k), up = q => iso.lift(q, WH);
    const roomOn = r => !litSet || (M.rooms && [...litSet].some(id => byId[id] && (byId[id].isolated ? -3 : byId[id].cluster) === r.c));
    // the slab the floor sits on, with its edge showing
    const minX = Math.min(...M.rooms.map(r => r.x)), minY = Math.min(...M.rooms.map(r => r.y)), maxX = Math.max(...M.rooms.map(r => r.x + r.w)), maxY = Math.max(...M.rooms.map(r => r.y + r.h));
    iso.slab(minX - 30, minY - 30, maxX - minX + 60, maxY - minY + 60, Math.max(4, 18 * k), "#17233a", "#1e2a3f", "#26344d", "rgba(148,180,230,.25)");
    // passages: linked topics that don't share a wall, as glowing runners on the slab
    ctx.lineCap = "round";
    M.passages.forEach(p => { const a = iso.p(p.a.x + p.a.w / 2, p.a.y + p.a.h / 2), b = iso.p(p.b.x + p.b.w / 2, p.b.y + p.b.h / 2);
      ctx.strokeStyle = p.gap ? "rgba(248,113,113,.5)" : "rgba(186,210,255,.25)"; ctx.lineWidth = p.gap ? 1.2 : Math.min(6, 1 + Math.sqrt(p.l)); ctx.setLineDash(p.gap ? [4, 5] : [1, 6]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - 40 * k, b.x, b.y); ctx.stroke(); });
    ctx.setLineDash([]);
    // floors (tiles in the topic colour), then the back walls (the far two sides of each room)
    M.rooms.forEach(r => { const c = corners(r), on = roomOn(r);
      ctx.globalAlpha = on ? 1 : 0.35;
      poly(c, r.c >= 0 ? hexMix(colorOf(r.c), bg, 0.8) : "rgba(255,255,255,.04)", "rgba(226,236,255,.18)");
      if (k > 0.9) { ctx.strokeStyle = "rgba(255,255,255,.05)"; ctx.lineWidth = 1; ctx.beginPath();   // floor tiles
        for (let x = r.x + 40; x < r.x + r.w; x += 40) { const a = iso.p(x, r.y), b = iso.p(x, r.y + r.h); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        for (let y = r.y + 40; y < r.y + r.h; y += 40) { const a = iso.p(r.x, y), b = iso.p(r.x + r.w, y); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); }
      iso.wall(c[0], c[1], WH, "rgba(200,214,240,.22)", "rgba(226,236,255,.35)");   // back walls: the far two sides
      iso.wall(c[3], c[0], WH, "rgba(170,186,220,.18)", "rgba(226,236,255,.35)");
    });
    ctx.globalAlpha = 1;
    // doorways: a dark opening in the wall; a gap is bricked up in red
    const doorPts = d => d.v ? [iso.p(d.at, d.mid - d.half), iso.p(d.at, d.mid + d.half)] : [iso.p(d.mid - d.half, d.at), iso.p(d.mid + d.half, d.at)];
    M.doors.forEach(d => { const [p0, p1] = doorPts(d);
      if (d.gap) { poly([p0, p1, up(p1), up(p0)], "rgba(127,29,29,.55)", "rgba(248,113,113,.9)"); ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(248,113,113,.8)"; ctx.beginPath();
        for (let i = 1; i < 4; i++) { const y = WH * i / 4; ctx.moveTo(p0.x, p0.y - y); ctx.lineTo(p1.x, p1.y - y); } ctx.stroke(); ctx.setLineDash([]); return; }
      poly([p0, p1, { x: p1.x, y: p1.y - WH * 0.8 }, { x: p0.x, y: p0.y - WH * 0.8 }], "rgba(10,16,30,.85)", "rgba(253,224,71,.35)"); });
    // blocks: drawn back to front so nearer ones overlap farther ones
    const blocks = [];
    for (const r of M.rooms) for (const n of nodes) {
      if ((n.isolated ? -3 : n.cluster) !== r.c || n.person || n.ghost || n.moc || !mapShown(n) || !M.obj.has(n.id)) continue;
      blocks.push([n, r, iso.p(n.x, n.y)]);
    }
    iso.depthSort(blocks, b => b[2]);
    for (const [n, r, p] of blocks) {
      const on = roomOn(r), lit0 = !litSet || litSet.has(n.id), cell = M.obj.get(n.id) * k, s = Math.max(3, cell * (0.22 + 0.3 * importance(n)));
      const stale = staleFor(n, Q.stale_days), act = activity(n), hgt = Math.max(3, s * (0.5 + 2.2 * importance(n)));
      ctx.globalAlpha = lit0 && on ? 1 : 0.2;
      const base = stale ? "#7d8799" : r.c >= 0 ? colorOf(r.c) : "#a5b4cf";
      if (act > 0.3 && s > 3) { const fl = reducedMotion() ? 1 : 0.7 + 0.3 * Math.sin(now / 110 + hash(n.id) % 17) * Math.sin(now / 47 + hash(n.id) % 5);
        const g = ctx.createRadialGradient(p.x, p.y - hgt, 0, p.x, p.y - hgt, s * 2.6); g.addColorStop(0, `rgba(253,224,71,${(0.45 * fl).toFixed(3)})`); g.addColorStop(1, "rgba(253,224,71,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y - hgt, s * 2.6, 0, 2 * Math.PI); ctx.fill(); }
      const { T, Rp, B, Lp, hw, hh } = iso.block(p, s, hgt, base, "rgba(226,236,255,.5)");
      if (stale && s > 5) { ctx.fillStyle = "rgba(15,23,42,.5)"; for (let i = 0; i < 4; i++) { const h = hash(n.id + i); ctx.fillRect(p.x - hw * 0.5 + (h % 100) / 100 * hw, p.y - hgt - hh * 0.4 + ((h >>> 8) % 100) / 100 * hh * 0.8, 1.2, 1.2); } }
      if (n.tasks > 0 && s > 4) { ctx.fillStyle = UI.colour.tasks; ctx.beginPath(); ctx.arc(T.x, T.y + hh * 0.5, Math.max(1.6, s * 0.18), 0, 2 * Math.PI); ctx.fill(); }
      if (st.selected === n.id) poly([{ x: T.x, y: T.y - 4 }, { x: Rp.x + 4, y: Rp.y }, { x: B.x, y: B.y + hgt + 4 }, { x: Lp.x - 4, y: Lp.y }], null, UI.colour.selected, 2);
      P.set(n.id, { ...iso.hit(p, hw, hgt), s: p.s, depth: -importance(n), a: lit0 ? 1 : 0.3 });
    }
    // plaques: the room's map on a stand
    M.rooms.forEach(r => { const m = mocOf[r.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return;
      const n = byId[m.id], p = iso.p(n.x, n.y), s = Math.max(6, 11 * Math.sqrt(k)), on = roomOn(r);
      ctx.globalAlpha = on ? 1 : 0.35; ctx.strokeStyle = "#78350f"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - s * 1.6); ctx.stroke();
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(p.x - s / 2, p.y - s * 2.3, s, s * 0.8); ctx.strokeRect(p.x - s / 2, p.y - s * 2.3, s, s * 0.8);
      P.set(n.id, { x: p.x, y: p.y - s * 1.9, s: p.s, depth: -2, r: s, a: on ? 1 : 0.3 }); });
    ctx.globalAlpha = 1;
    // front walls, low and see-through, so the room stays readable
    M.rooms.forEach(r => { const c = corners(r), low = p => ({ x: p.x, y: p.y - WH * 0.35 });
      poly([c[1], c[2], low(c[2]), low(c[1])], "rgba(226,236,255,.10)", "rgba(226,236,255,.45)");
      poly([c[2], c[3], low(c[3]), low(c[2])], "rgba(226,236,255,.08)", "rgba(226,236,255,.45)"); });
    // a visitor tours the floor: room to room through the doors, preferring rooms not seen for a while
    const hasDoor = r => M.doors.some(d => !d.gap && (d.a === r.c || d.b === r.c));   // the storeroom (unlinked notes) has none
    const vz = M.visitor || (M.visitor = { room: M.rooms.filter(hasDoor).sort((a, b) => b.w * b.h - a.w * a.h)[0], seen: new Map(), path: [], t: 0, steps: [] }), vdt = tickOf(vz, now);
    const ctr = r => [r.x + r.w / 2, r.y + r.h / 2];
    if (!vz.path.length && vz.room) {
      if (!hasDoor(vz.room)) { const rs0 = M.rooms.filter(hasDoor); vz.room = rs0[Math.floor(Math.random() * rs0.length)]; }
      const exits = vz.room ? M.doors.filter(d => !d.gap && (d.a === vz.room.c || d.b === vz.room.c)) : [];
      if (exits.length) { const d0 = exits.sort((x, y) => (vz.seen.get(x.a === vz.room.c ? x.b : x.a) || 0) - (vz.seen.get(y.a === vz.room.c ? y.b : y.a) || 0) || Math.random() - 0.5)[0];
        const next = M.byC[d0.a === vz.room.c ? d0.b : d0.a], dp = d0.v ? [d0.at, d0.mid] : [d0.mid, d0.at];
        vz.path = [ctr(vz.room), dp, ctr(next)]; vz.door = d0; vz.next = next; vz.t = 0; vz.seen.set(next.c, now); }
    }
    if (vz.path.length) {
      const legLen = [Math.hypot(vz.path[1][0] - vz.path[0][0], vz.path[1][1] - vz.path[0][1]), Math.hypot(vz.path[2][0] - vz.path[1][0], vz.path[2][1] - vz.path[1][1])], total = legLen[0] + legLen[1] || 1;
      vz.t += vdt * 0.05 / total;
      const dist = Math.min(1, vz.t) * total, leg = dist < legLen[0] ? 0 : 1, f = leg ? (dist - legLen[0]) / (legLen[1] || 1) : dist / (legLen[0] || 1);
      const wx0 = vz.path[leg][0] + (vz.path[leg + 1][0] - vz.path[leg][0]) * f, wy0 = vz.path[leg][1] + (vz.path[leg + 1][1] - vz.path[leg][1]) * f, vp = iso.p(wx0, wy0);
      if (vdt && (!vz.steps.length || Math.hypot(vz.steps[vz.steps.length - 1][0] - wx0, vz.steps[vz.steps.length - 1][1] - wy0) > 14)) { vz.steps.push([wx0, wy0]); if (vz.steps.length > 16) vz.steps.shift(); }
      vz.steps.forEach(([x, y], i) => { const q = iso.p(x, y); ctx.fillStyle = `rgba(226,236,255,${0.08 + 0.3 * i / vz.steps.length})`; ctx.beginPath(); ctx.ellipse(q.x, q.y, 1.8, 1, 0, 0, 2 * Math.PI); ctx.fill(); });
      walker(vp, Math.max(2.5, 5 * Math.sqrt(k)), "#fef3c7", { lantern: true, phase: now / 160, head: "#fef3c7" });   // a visitor with a lantern
      if (vz.t >= 1) { vz.room = vz.next; vz.path = []; }
    }
    // the selected note's links: threads through the floor
    if (st.selected && P.has(st.selected)) { const a = P.get(st.selected); ctx.strokeStyle = "rgba(253,224,71,.7)"; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      nb[st.selected].forEach(id => { const b = P.get(id); if (b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }); ctx.setLineDash([]); }
    // room names on their back wall, then the most relied-on blocks' names
    M.rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h).forEach(r => { const c = corners(r), w = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
      const name = r.c === -3 ? "STOREROOM · UNLINKED" : r.c < 0 ? "HALL · NO TOPIC YET" : clip(shortName(r.c), 30).toUpperCase(), f = `700 10.5px ${font}`;
      const text = w > 50 ? fitW(name, f, w - 20) : ""; if (!text) return;
      const x = (c[0].x + c[1].x) / 2, y = (c[0].y + c[1].y) / 2 - WH - 8, tw = ctx.measureText(text).width;
      if (freeSpot(x - tw / 2, y - 7, tw, 14)) haloText(text, x, y, ink, bg, f, "center"); });
    noteLabels([...P.keys()].filter(id => !byId[id].moc).sort((a, b) => importance(byId[b]) - importance(byId[a])), "#dbe7ff", bg, k > 1.4 ? 140 : MOBILE ? 12 : 26);
  }
  // ---- the palace from the front
  function drawPalaceFacade(now, M, R, litSet, font, k) {
    const { night, dusk } = daylight();
    backdrop(...(night ? ["#070b1d", "#1b2440"] : dusk ? ["#2b2d5c", "#f4a76a"] : ["#6aa7e0", "#d9ecfb"]));
    if (night) for (let i = 0; i < 90; i++) { const h = hash("star" + i); ctx.fillStyle = `rgba(255,255,255,${0.25 + (h % 50) / 100})`; ctx.fillRect(h % Math.max(1, W), (h >>> 10) % Math.max(1, Math.round(H * 0.6)), 1.2, 1.2); }
    const g0 = scr(0, 0, R), L = scr(-M.FW / 2 - 40, M.top - 10, R), Rr = scr(M.FW / 2 + 40, 0, R);
    // ground and street
    ctx.fillStyle = night ? "#15161c" : "#5b6b4a"; ctx.fillRect(0, g0.y, W, H - g0.y);
    ctx.fillStyle = night ? "#22242c" : "#8a8f86"; ctx.fillRect(0, g0.y, W, Math.max(2, 8 * k));
    const stone = night ? "#4a443c" : dusk ? "#c9a983" : "#e4d8c0", stoneDark = night ? "#3a352f" : dusk ? "#a98a68" : "#cbbd9f", line = night ? "rgba(0,0,0,.45)" : "rgba(80,60,40,.45)";
    // depth: the building and its roof are solids pushed back up and to the right (oblique), through the shared prism
    const d = { x: Math.max(8, 150 * k * 0.55), y: -Math.max(5, 150 * k * 0.32) }, roof = night ? "#3b352e" : dusk ? "#866850" : "#b9ab90";   // a step darker than the pediment at every hour
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse((L.x + Rr.x) / 2 + d.x * 0.6, g0.y + 6, (Rr.x - L.x) * 0.62, Math.max(6, 22 * k), 0, 0, 2 * Math.PI); ctx.fill();   // shadow
    // the body: its front is the facade (the bays go on it below), its right side the side wall
    prism([{ x: L.x, y: L.y }, { x: Rr.x, y: L.y }, { x: Rr.x, y: g0.y }, { x: L.x, y: g0.y }], d, stone, { faces: { right: stoneDark, up: roof }, edge: line, sides: true });
    for (let f = 0; f <= M.levels.length - (M.hasBase ? 1 : 0); f++) { const y = scr(0, -f * M.FH, R).y; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Rr.x, y); ctx.lineTo(Rr.x + d.x, y + d.y); ctx.stroke();   // ledges round the corner
      for (let w = 1; w <= 3 && f < M.levels.length - (M.hasBase ? 1 : 0); w++) { const t = w / 4, wy = y - M.FH * k * 0.62, wh = M.FH * k * 0.34;   // side windows
        ctx.fillStyle = night ? "#2c3e5c" : "#8fb0c6"; ctx.beginPath(); ctx.moveTo(Rr.x + d.x * t - 4 * k, wy + d.y * t); ctx.lineTo(Rr.x + d.x * t + 6 * k, wy + d.y * (t + 0.05)); ctx.lineTo(Rr.x + d.x * t + 6 * k, wy + wh + d.y * (t + 0.05)); ctx.lineTo(Rr.x + d.x * t - 4 * k, wy + wh + d.y * t); ctx.fill(); } }
    // the roof: a pediment pushed back the depth of the building, sitting on the walls, its eaves just over them
    const midX = scr(0, 0, R).x, roofY = L.y, span = (Rr.x - L.x) / 2, eave = 10 * k, fascia = Math.max(2, 7 * k);
    const xl = L.x - eave, xr = Rr.x + eave, apex = { x: midX, y: roofY - fascia - Math.min(140, span * 0.22) };
    ctx.fillStyle = "rgba(0,0,0,.14)"; ctx.beginPath(); ctx.moveTo(Rr.x, roofY); ctx.lineTo(Rr.x + d.x, roofY + d.y); ctx.lineTo(Rr.x + d.x, roofY + d.y + fascia * 1.6); ctx.lineTo(Rr.x, roofY + fascia * 1.6); ctx.fill();   // the eave's shadow on the side wall
    prism([{ x: xl, y: roofY }, { x: xl, y: roofY - fascia }, apex, { x: xr, y: roofY - fascia }, { x: xr, y: roofY }], d, roof, { front: stoneDark, edge: line, sides: true, lw: 1.2 });
    ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.fillRect(L.x, roofY, Rr.x - L.x, Math.max(2, 4 * k));   // and under the cornice
    // the dome: a drum standing on the middle of the ridge, the dome on the drum, lit from the left like the rest
    const domeR = Math.min(120, span * 0.16), ridge = { x: apex.x + d.x / 2, y: apex.y + d.y / 2 + domeR * 0.12 }, drumH = domeR * 0.35, base = domeR * 0.22;
    const drum = ctx.createLinearGradient(ridge.x - domeR, 0, ridge.x + domeR, 0); drum.addColorStop(0, stone); drum.addColorStop(1, stoneDark);
    ctx.fillStyle = drum; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ridge.x - domeR, ridge.y - drumH); ctx.lineTo(ridge.x - domeR, ridge.y);
    ctx.ellipse(ridge.x, ridge.y, domeR, base, 0, Math.PI, 0, true); ctx.lineTo(ridge.x + domeR, ridge.y - drumH); ctx.closePath(); ctx.fill(); ctx.stroke();
    const domeY = ridge.y - drumH, dg = ctx.createRadialGradient(ridge.x - domeR * 0.35, domeY - domeR * 0.55, domeR * 0.1, ridge.x, domeY, domeR * 1.1);
    dg.addColorStop(0, night ? "#9fb0cf" : dusk ? "#f6dccb" : "#e3f1f9"); dg.addColorStop(1, night ? "#3b4763" : dusk ? "#7c6a8c" : "#6f97b0"); ctx.fillStyle = dg;   // the dome reflects the sky
    ctx.beginPath(); ctx.arc(ridge.x, domeY, domeR, Math.PI, 0); ctx.ellipse(ridge.x, domeY, domeR, base, 0, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
    // flags: the topics busiest this month fly from the roof: one on the dome, the others standing on the pediment
    const busy = M.bays.filter(b => !b.base).map(b => [b, topicBusy(b.c)]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const onPediment = x => apex.y + Math.min(1, Math.abs(x - midX) / (xr - midX)) * (roofY - fascia - apex.y);
    busy.forEach(([b], i) => { const fx = i === 1 ? ridge.x : midX + (i - 1) * span * 0.55, fy = i === 1 ? domeY - domeR : onPediment(fx), wave = reducedMotion() ? 0 : Math.sin(now / 300 + i) * 4;
      ctx.strokeStyle = "#3f3a33"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 46); ctx.stroke();
      ctx.fillStyle = colorOf(b.c); ctx.beginPath(); ctx.moveTo(fx, fy - 46); ctx.quadraticCurveTo(fx + 16, fy - 44 + wave, fx + 30, fy - 40); ctx.lineTo(fx, fy - 32); ctx.fill(); });
    // floors: a cornice, bays between pilasters, the topic's name on its cornice; a click on the wall goes inside
    const floorNames = M.levels.map((cs, li) => M.hasBase && li === 0 ? "Basement" : `Floor ${M.hasBase ? li : li + 1}`);
    M.bays.forEach(b => {
      const a = scr(b.x, b.y, R), w = b.w * k, h = b.h * k, on = !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === b.c && !special(byId[id]));
      ctx.globalAlpha = on ? 1 : 0.45;
      ctx.fillStyle = b.base ? (night ? "#2b2822" : "#b8ab92") : hexMix(colorOf(b.c), stone, 0.86); ctx.fillRect(a.x, a.y, w, h);
      ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, 1.6 * Math.sqrt(k)); ctx.strokeRect(a.x, a.y, w, h);
      ctx.fillStyle = stoneDark; ctx.fillRect(a.x, a.y, w, Math.max(3, 9 * k));   // cornice
      const name = b.c === -3 ? "STOREROOM · UNLINKED" : b.c < 0 ? "HALL · NO TOPIC YET" : clip(shortName(b.c), 40).toUpperCase();
      if (w > 40) topicLabel(b.c, name, a.x + w / 2, a.y + 10 * k + 9, w - 16, night ? "#f5ead6" : "#2a2016", night ? "#2a2016" : "rgba(255,248,235,.7)", Math.max(8, Math.min(12, 10 * Math.sqrt(k))));
      spot(a.x, a.y, w, h, () => enterFloor(b.floor), `${floorNames[b.floor]}: walk in`);
      ctx.globalAlpha = 1;
    });
    // pillars between bays and a ledge under each floor, lit from the left
    M.bays.forEach(b => { const a = scr(b.x, b.y, R), w = Math.max(3, 9 * k), h = b.h * k;
      const g = ctx.createLinearGradient(a.x - w / 2, 0, a.x + w / 2, 0); g.addColorStop(0, night ? "#6b6255" : "#f3ead8"); g.addColorStop(1, stoneDark);
      ctx.fillStyle = g; ctx.fillRect(a.x - w / 2, a.y, w, h);
      ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(a.x, a.y + h - Math.max(2, 5 * k), b.w * k, Math.max(2, 5 * k)); });
    // cracks in the wall between topics that should connect and don't
    M.cracks.forEach(b => { const a = scr(b.x, b.y, R); ctx.strokeStyle = "rgba(185,28,28,.85)"; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const yy = a.y + (i / 8) * b.h * k, xx = a.x + (i % 2 ? 4 : -4) * Math.sqrt(k); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); });
    // windows
    for (const b of M.bays) for (const n of nodes) {
      if ((n.isolated ? -3 : n.cluster) !== b.c || special(n) || n.ghost || !mapShown(n) || !M.win.has(n.id)) continue;
      const p = scr(n.x, n.y, R), [ww, wh] = M.win.get(n.id).map(v => Math.max(2.5, v * k)), lit0 = !litSet || litSet.has(n.id);
      const act = activity(n), x0 = p.x - ww / 2, y0 = p.y - wh / 2;
      ctx.globalAlpha = lit0 ? 1 : 0.25;
      // someone's home (active): lit; nobody's been in a while (stale): boarded; a red sill: open tasks
      windowSprite(x0, y0, ww, wh, { state: act > 0.3 ? "lit" : staleFor(n, Q.stale_days) ? "boarded" : "plain", busy: act, seed: hash(n.id), now, night,
        frame: line, tasks: n.tasks > 0, selected: st.selected === n.id, k });
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -importance(n), r: Math.max(5, Math.max(ww, wh) / 2 + 1), a: lit0 ? 1 : 0.3 });
    }
    ctx.globalAlpha = 1;
    // plaques (the bay's map) and the front door
    M.bays.forEach(b => { const m = mocOf[b.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return; const n = byId[m.id], p = scr(n.x, n.y, R), s = Math.max(6, 11 * Math.sqrt(k));
      ctx.fillStyle = "#fbbf24"; ctx.fillRect(p.x - s, p.y - s * 0.4, 2 * s, s * 0.8); ctx.strokeStyle = "#78350f"; ctx.lineWidth = 1; ctx.strokeRect(p.x - s, p.y - s * 0.4, 2 * s, s * 0.8);
      P.set(n.id, { x: p.x, y: p.y, s: p.s, depth: -2, r: s, a: 1 }); });
    const dw = Math.max(10, 46 * k), dh = Math.max(14, 70 * k);
    for (let i = 3; i >= 1; i--) { ctx.fillStyle = i % 2 ? stoneDark : stone; ctx.fillRect(midX - dw / 2 - i * 8 * k, g0.y + (3 - i) * 3 * k, dw + i * 16 * k, 3 * k); }   // steps
    ctx.fillStyle = night ? "#2a1d12" : "#5b3a1e";
    ctx.beginPath(); ctx.moveTo(midX - dw / 2, g0.y); ctx.lineTo(midX - dw / 2, g0.y - dh + dw / 2); ctx.arc(midX, g0.y - dh + dw / 2, dw / 2, Math.PI, 0); ctx.lineTo(midX + dw / 2, g0.y); ctx.fill();
    // names of the most relied-on windows when close enough to read
    if (k > 1.1) noteLabels(nodes.filter(n => !special(n) && P.has(n.id) && M.win.has(n.id)).sort(byImportance).map(n => n.id), night ? "#f5ead6" : "#1f1a14", night ? "#1f1a14" : "rgba(255,248,235,.8)", k > 2 ? 80 : 24);
    // zoom into a floor to walk in: the floor in the middle of the pane
    if (cam.userMoved && k > 2.6) { const mid = M.bays.find(b => { const a = scr(b.x, b.y, R); return W / 2 >= a.x && W / 2 <= a.x + b.w * k && H / 2 >= a.y && H / 2 <= a.y + b.h * k; }); if (mid) enterFloor(mid.floor); }
  }
  // Facade, or one floor's rooms: st.palaceFloor (null = outside). Each change lays the palace out again.
  function enterFloor(f) {
    if (st.palaceFloor === f || st.view !== "palace") return;
    st.palaceFloor = f; cam.userMoved = false;
    applyMapLayout(true); renderLegend(); renderToday();
    fitted = false; setTimeout(() => { fitted = true; fit(mapFitPred(), 600); }, 1000);   // after the morph lands
  }
  // Facade / Basement / Floor 1.. as buttons over the palace
  let floorBarFor = null;
  function floorBar(M) {
    let bar = root.querySelector(".vg-floorbar");
    if (!bar) { bar = document.createElement("div"); bar.className = "vg-floorbar"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Palace floors"); wrap.appendChild(bar); }
    if (!M || floorBarFor === M) return;
    floorBarFor = M;
    const lv = M.levels || [], names = lv.map((cs, li) => M.hasBase && li === 0 ? "B" : String(M.hasBase ? li : li + 1));
    const cur = M.facade ? null : M.floor;
    bar.innerHTML = `<button class="vg-segbtn" data-floor="" aria-pressed="${cur == null}">Front</button>` +
      lv.map((cs, li) => li).reverse().map(li => `<button class="vg-segbtn" data-floor="${li}" aria-pressed="${cur === li}" title="${esc(lv[li].map(c => c === -3 ? "Storeroom" : shortName(c)).join(", "))}">${names[li]}</button>`).join("");
    bar.querySelectorAll("[data-floor]").forEach(b => b.onclick = () => { enterFloor(b.dataset.floor === "" ? null : +b.dataset.floor); syncAngleBtn(); });
  }

