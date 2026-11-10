  // Cas9: the Guide scan as the molecule it is named after. The model is the real one, atom by atom: S. pyogenes Cas9 holding
  // its guide RNA on a DNA double helix (CAS9_MODEL, made by scripts/cas9_model.js from PDB 5F9R), drawn as a space-filling
  // model: protein white, RNA orange-red, the two DNA strands two blues. The DNA carries on past both ends of the crystal as
  // ideal B-DNA (VGScience.helixArm), wound into a spring each side so a whole vault fits.
  // What it means: every note in the scan's folder or tag is one base pair, in path order. The enzyme sits on a note the
  // guide matched; the stretch of DNA it holds open is that note. Exact matches are gold, look-alikes lilac. A base pair
  // opens its note; a gold one also moves the enzyme there. It only reads: the scan and the repair stay in the Guide scan lens.
  // It opens from the side where most of the DNA and RNA shows (the enzyme wraps round them; measured over every angle).
  // Solids are drawn by the shared WebGL layer (gl: true); without WebGL, or flat, the same atoms are painted far to near.
  ICON.cas9 = '<path d="M2 14c3-5 5 3 8-1M14 11c3-4 5 4 8-1"/><path d="M8 7c3-3 8-2 9 2s-1 9-5 9-7-3-6-7"/>';
  const C9 = { U: 3, ATOM: 1.8, FINE: 2.2, INK: "#070b14", TEXT: "#e5e7eb", MUTED: "#94a3b8",
    PROTEIN: [0.93, 0.93, 0.9], RNA: [0.94, 0.34, 0.15], TARGET: [0.13, 0.31, 0.8], OTHER: [0.38, 0.64, 0.97], HIT: [1, 0.79, 0.2], NEAR: [0.78, 0.62, 0.96],
    LIGHT: [-0.5, -0.9, -0.45],   // from over the viewer's left shoulder whichever way the model is turned, as a model in the hand is lit
    COIL: { lead: 90, ease: 40, radius: 60, pitch: 34 }, NEAR_AXIS: [0, 1, 0], FAR_AXIS: [-1, 0, 0] };   // Å; the springs run down from the PAM side and left from the far side
  const c9Css = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;
  const c9 = { site: null, sel: null, drew: null };
  // ---- the model, unpacked once: positions in Å, what each atom belongs to, and how deep in a crevice it sits
  let c9Made = null;
  function c9Parts() {
    if (c9Made) return c9Made;
    const M = CAS9_MODEL, raw = atob(M.atoms), n = raw.length / 3, xyz = new Float32Array(n * 3), kind = new Uint8Array(n), res = new Int16Array(n), flank = new Int8Array(n).fill(-1), shade = new Float32Array(n);
    for (let i = 0; i < n * 3; i++) xyz[i] = raw.charCodeAt(i) * M.q + M.lo[i % 3];
    let at = M.protein;   // kind: 0 protein, 1 RNA, 2 the target strand, 3 the other strand
    [M.rna, M.target, M.other].forEach((table, t) => table.forEach(([seq, count]) => { for (let c = 0; c < count; c++, at++) { kind[at] = t + 1; res[at] = seq; } }));
    if (at !== n) throw new Error("the Cas9 model's tables don't add up to its atoms: run scripts/cas9_model.js again");
    for (let i = 0; i < n; i++) M.flank.forEach(([t, o], f) => { if ((kind[i] === 2 && res[i] === t) || (kind[i] === 3 && res[i] === o)) flank[i] = f; });
    // shading: an atom with many neighbours sits in a groove or a cleft and gets less light (what makes a printed model read as solid)
    const CELL = 12, cells = new Map(), cellOf = i => `${Math.floor(xyz[i * 3] / CELL)},${Math.floor(xyz[i * 3 + 1] / CELL)},${Math.floor(xyz[i * 3 + 2] / CELL)}`, count = new Uint16Array(n);
    for (let i = 0; i < n; i++) { const k = cellOf(i); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); }
    for (let i = 0; i < n; i++) { const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2], cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), cz = Math.floor(z / CELL); let c = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) for (const j of cells.get(`${cx + a},${cy + b},${cz + d}`) || []) { const dx = xyz[j * 3] - x, dy = xyz[j * 3 + 1] - y, dz = xyz[j * 3 + 2] - z; if (dx * dx + dy * dy + dz * dz < CELL * CELL) c++; }
      count[i] = c; }
    const sorted = Array.from(count).sort((p, q) => p - q), lo = sorted[Math.floor(n * 0.08)], hi = sorted[Math.floor(n * 0.97)];
    for (let i = 0; i < n; i++) shade[i] = 1 - 0.72 * Math.max(0, Math.min(1, (count[i] - lo) / Math.max(1, hi - lo)));
    const mid = pick => { const c = [0, 0, 0]; let m = 0; for (let i = 0; i < n; i++) if (pick(i)) { c[0] += xyz[i * 3]; c[1] += xyz[i * 3 + 1]; c[2] += xyz[i * 3 + 2]; m++; } return c.map(v => v / (m || 1)); };
    const farthest = (pick, score) => { let best = -1, bs = -Infinity; for (let i = 0; i < n; i++) if (pick(i)) { const s = score(i); if (s > bs) { bs = s; best = i; } } return [xyz[best * 3], xyz[best * 3 + 1], xyz[best * 3 + 2]]; };
    const hi3 = [0, 1, 2].map(k => M.lo[k] + 255 * M.q), box = []; for (const x of [M.lo[0], hi3[0]]) for (const y of [M.lo[1], hi3[1]]) for (const z of [M.lo[2], hi3[2]]) box.push([x * C9.U, y * C9.U, z * C9.U]);
    // one base pair of the tails: every atom, and four beads for when it is too small on screen to tell atoms apart
    const pair = M.pair.map(([x, y, z, strand, base]) => ({ x, y, z, strand, base })), beads = [];
    for (const strand of [0, 1]) for (const base of [0, 1]) { const set = pair.filter(a => a.strand === strand && a.base === base), c = k => set.reduce((s, a) => s + a[k], 0) / set.length; beads.push({ x: c("x"), y: c("y"), z: c("z"), strand, base, r: base ? 3.3 : 3.6 }); }
    return (c9Made = { M, n, xyz, kind, res, flank, shade, pair, beads, box,
      flankAt: M.flank.map((_, f) => mid(i => flank[i] === f)),
      held: mid(i => (kind[i] === 1 && res[i] <= M.spacer + 1) || (kind[i] === 2 && res[i] > 30 - M.spacer)),   // where the guide lies on the target strand
      labels: { protein: farthest(i => kind[i] === 0, i => -xyz[i * 3 + 1]), rna: farthest(i => kind[i] === 1, i => Math.hypot(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2])) } });
  }
  // ---- which note is which base pair
  function cas9Layout() {
    const A = c9Parts(), M = A.M, U = C9.U, G = guideNow, R = G.result, hits = new Map();
    const all = nodes.filter(n => !special(n) && !n.ghost && (!R || VGShared.scopeHas(R.scope, n.id, n.tags))).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const inAll = new Set(all.map(n => n.id));
    if (R) R.notes.forEach(n => { if (inAll.has(n.path)) hits.set(n.path, n.hits.length ? "hit" : "near"); });
    const sites = all.filter(n => hits.get(n.id) === "hit"), site = sites.find(n => n.id === c9.site) || sites[0] || null, i0 = site ? all.indexOf(site) : all.length >> 1;
    // past the PAM: the crystal's own seven pairs, then the spring. Before the site: the other spring, nearest first.
    const after = all.slice(site ? i0 + 1 : i0), flankIds = after.slice(0, M.flank.length).map(n => n.id), nearIds = after.slice(M.flank.length).map(n => n.id), farIds = all.slice(0, i0).reverse().map(n => n.id);
    const near = VGScience.helixArm(M.tails.near, nearIds.length, M.step, { ...C9.COIL, axis: C9.NEAR_AXIS }), far = VGScience.helixArm(M.tails.far, farIds.length, M.step, { ...C9.COIL, axis: C9.FAR_AXIS });
    const pos = new Map(), where = new Map();
    if (site) { pos.set(site.id, [0, 0, 0]); where.set(site.id, "held"); }   // the middle of the complex: what turning turns about
    flankIds.forEach((id, f) => { pos.set(id, A.flankAt[f].map(v => v * U)); where.set(id, "flank"); });
    [[nearIds, near, "near"], [farIds, far, "far"]].forEach(([ids, arm, name]) => ids.forEach((id, j) => { pos.set(id, [arm[j * 12] * U, arm[j * 12 + 1] * U, arm[j * 12 + 2] * U]); where.set(id, name); }));
    const home = new Set(site ? [site.id] : [flankIds[0], farIds[0]].filter(Boolean));
    return { pos, bounds: A.box, where, all, hits, sites, site: site ? site.id : null, flankIds, nearIds, farIds, near, far, home, result: R };
  }
  const c9Guide = L => (L.result ? `“${L.result.guide.seq}”` : "");
  function c9Go(id) { c9.site = id; dirty = true; kick(); }
  function c9Step(d) { const L = mapCache.cas9; if (!L || L.sites.length < 2) return; const i = L.sites.findIndex(n => n.id === L.site); c9Go(L.sites[(i + d + L.sites.length) % L.sites.length].id); }
  function c9ShowSites(L) { if (L.sites.length) setHighlight(new Set(L.sites.map(n => n.id)), `Exact matches of ${c9Guide(L)}`); else openLens("guide"); }
  function drawCas9() {
    const { R, litSet, font } = mapFrame(), A = c9Parts(), U = C9.U, gl3 = glOn();
    let L = mapCache.cas9;
    if (!L) { backdrop(C9.INK, "#0d1424", C9.INK); return; }
    // a gold base pair that was just picked is where the enzyme goes; a new scan lays the strand out again
    const picked = st.selected !== c9.sel && L.hits.get(st.selected) === "hit" ? st.selected : null; c9.sel = st.selected; if (picked) c9.site = picked;
    if (L.result !== guideNow.result || (c9.site && c9.site !== L.site && L.hits.get(c9.site) === "hit")) { applyMapLayout(false); L = mapCache.cas9; }
    c9.site = L.site;
    const light = C9.LIGHT, flat = [], tmp = [0, 0, 0], drew = { gl: gl3, atoms: 0, pairs: 0, fine: 0, beads: 0 };
    if (gl3) { GL.begin(glColor(C9.INK), glScale()); glSn = 0; } else backdrop(C9.INK, "#0d1424", C9.INK);
    // one sphere: lit by the WebGL layer, or kept to be painted far to near
    const ball = (p, rA, col, sh, zw) => { const r = Math.max(0.8, rA * U * p.s); drew.atoms++;
      if (gl3) { tmp[0] = col[0] * sh; tmp[1] = col[1] * sh; tmp[2] = col[2] * sh; putSprite(p.x, p.y, depth01(p.depth), r, tmp, 1, 0, rA * U / (2 * DEPTH_RANGE)); }
      else flat.push([st.three ? p.depth : zw, p.x, p.y, r, col, sh]); };
    const off = (p, m) => p.x < -m || p.x > W + m || p.y < -m || p.y > H + m;
    const dimmed = id => (litSet && !litSet.has(id)) || !mapShown(byId[id]) ? 0.3 : 1;
    const tint = id => { const h = L.hits.get(id); return h === "hit" ? C9.HIT : h === "near" ? C9.NEAR : null; };
    const hit = (id, p, rA) => { if (mapShown(byId[id])) P.set(id, { x: p.x, y: p.y, s: p.s, depth: p.depth, r: Math.max(5, rA * U * p.s), a: dimmed(id) }); };
    // ---- the complex, atom by atom
    const base = [C9.PROTEIN, C9.RNA, C9.TARGET, C9.OTHER], flankCol = L.flankIds.map(tint), flankDim = L.flankIds.map(dimmed);
    for (let i = 0; i < A.n; i++) { const x = A.xyz[i * 3] * U, y = A.xyz[i * 3 + 1] * U, z = A.xyz[i * 3 + 2] * U, p = proj(x, y, z, R); if (!p || off(p, 12)) continue;
      const f = A.flank[i], mine = f >= 0 && f < L.flankIds.length; ball(p, C9.ATOM, (mine && flankCol[f]) || base[A.kind[i]], A.shade[i] * (mine ? flankDim[f] : 1), z); }
    L.flankIds.forEach((id, f) => { const c = A.flankAt[f], p = proj(c[0] * U, c[1] * U, c[2] * U, R); if (p) hit(id, p, 6); });
    if (L.site) { const p = proj(A.held[0] * U, A.held[1] * U, A.held[2] * U, R); if (p) hit(L.site, p, 14); }
    // ---- the two springs: a pair near enough to see is drawn atom by atom, a far one as four beads
    const fine = C9.FINE * (MOBILE ? 1.4 : 1);
    [[L.nearIds, L.near, 1], [L.farIds, L.far, 0]].forEach(([ids, arm, firstIsOther]) => {
      for (let j = 0; j < ids.length; j++) { const o = j * 12, ox = arm[o] * U, oy = arm[o + 1] * U, oz = arm[o + 2] * U, p = proj(ox, oy, oz, R); if (!p || off(p, 14 * U * p.s)) continue;
        const id = ids[j], t = tint(id), dm = dimmed(id), detail = C9.ATOM * U * p.s >= fine, set = detail ? A.pair : A.beads; drew.pairs++; if (detail) drew.fine++; else drew.beads++;
        for (const a of set) { const wx = ox + (arm[o + 3] * a.x + arm[o + 6] * a.y + arm[o + 9] * a.z) * U, wy = oy + (arm[o + 4] * a.x + arm[o + 7] * a.y + arm[o + 10] * a.z) * U, wz = oz + (arm[o + 5] * a.x + arm[o + 8] * a.y + arm[o + 11] * a.z) * U, q = proj(wx, wy, wz, R); if (!q) continue;
          const strandCol = (a.strand === 0) === !!firstIsOther ? C9.OTHER : C9.TARGET;
          ball(q, detail ? C9.ATOM : a.r, t && (a.base || !detail) ? t : strandCol, (a.base ? 0.78 : 1) * dm, wz); }
        hit(id, p, 7); } });
    if (gl3) { GL.sprites("lit", glS, glSn, { light, dark: true, matte: 1 }); glSn = 0; }
    else { flat.sort((a, b) => b[0] - a[0]); const styles = new Map();
      for (const [, x, y, r, col, sh] of flat) { const s8 = Math.round(sh * 8), k = col[0] * 1e6 + col[1] * 1e3 + col[2] + s8 * 1e7; let css1 = styles.get(k); if (!css1) styles.set(k, css1 = c9Css(col.map(v => v * (0.25 + 0.75 * s8 / 8))));
        ctx.fillStyle = css1; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); } }
    c9.drew = drew;
    // ---- names, as on a labelled model: each in its part's colour, each a way in
    const lf = `700 15px ${font}`, label = (text, at, col, dy, fn, title) => { const p = at && proj(at[0] * U, at[1] * U, at[2] * U, R); if (!p) return; ctx.font = lf; const w = ctx.measureText(text).width, x = Math.max(8 + w / 2, Math.min(W - 8 - w / 2, p.x)), y = Math.max(70, Math.min(H - 110, p.y + dy));   // clear of the bar above and the buttons below
      if (!freeSpot(x - w / 2 - 4, y - 11, w + 8, 22)) return; haloText(text, x, y, c9Css(col), C9.INK, lf, "center"); spot(x - w / 2 - 4, y - 11, w + 8, 22, fn, title); };
    const guide = c9Guide(L);
    label("Cas9 protein", A.labels.protein, C9.PROTEIN, -22, () => openLens("guide"), "Open Guide scan");
    label(guide ? `RNA · ${clip(guide, 24)}` : "RNA", A.labels.rna, C9.RNA, 24, () => openLens("guide"), guide ? `The guide: ${guide}. Open Guide scan` : "The guide. Open Guide scan");
    label("DNA", A.flankAt[A.flankAt.length - 1], C9.OTHER, 30, () => c9ShowSites(L), L.sites.length ? `${plural(L.all.length, "note")}, a base pair each. Show the ${plural(L.sites.length, "note")} the guide matches` : `${plural(L.all.length, "note")}, a base pair each. Open Guide scan`);
    // the note in hand, named where it sits
    const focus = st.hover || st.selected, fp = focus && P.get(focus);
    if (fp && byId[focus]) { ctx.strokeStyle = C9.TEXT; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(fp.x, fp.y, fp.r + 2, 0, 2 * Math.PI); ctx.stroke();
      const nf = `600 12px ${font}`, t = clip(byId[focus].name, 34); ctx.font = nf; const w = ctx.measureText(t).width; if (freeSpot(fp.x - w / 2, fp.y - fp.r - 22, w, 16)) haloText(t, fp.x, fp.y - fp.r - 13, C9.TEXT, C9.INK, nf, "center"); }
    // ---- what to do next, along the bottom
    const by = H - (opts.compact ? 26 : 58), sf = `13px ${font}`;
    if (!L.result) { haloText(`${plural(L.all.length, "note")}, a base pair each. No guide yet.`, W / 2, by - 30, C9.MUTED, C9.INK, sf, "center"); sceneButton("Open Guide scan", W / 2, by, () => openLens("guide")); }
    else if (!L.sites.length) { haloText(`No ${guide} in these ${plural(L.all.length, "note")}.`, W / 2, by - 30, C9.MUTED, C9.INK, sf, "center"); sceneButton("Open Guide scan", W / 2, by, () => openLens("guide")); }
    else { const s = byId[L.site], i = L.sites.findIndex(n => n.id === L.site), one = L.sites.length < 2, name = clip(s.name, W < 520 ? 18 : 36);
      ctx.font = `600 13px ${font}`; const w = ctx.measureText(name).width + 28;
      sceneButton(name, W / 2, by, () => select(s.id), `Cas9 is on ${s.name}: open it`);
      sceneButton("‹", W / 2 - w / 2 - 24, by, () => c9Step(-1), "Previous site", { off: one }); sceneButton("›", W / 2 + w / 2 + 24, by, () => c9Step(1), "Next site", { off: one });
      haloText(`Site ${i + 1} of ${L.sites.length}`, W / 2, by - 30, C9.MUTED, C9.INK, sf, "center"); }
    const nearN = L.all.filter(n => L.hits.get(n.id) === "near").length;
    setSceneStat(!L.result ? `${plural(L.all.length, "note")} · no guide` : `${guide} ${guideScopeText(L.result.scope)}: ${L.sites.length ? `exact in ${plural(L.sites.length, "note")} of ${L.all.length}` : `no match in ${plural(L.all.length, "note")}`}${nearN ? ` · look-alikes in ${nearN}` : ""}`);
  }
  scene("cas9", {
    name: "Cas9", icon: "cas9", menu: "see", space: true, gl: true, home: { yaw: 2.95, pitch: 0.3 }, polish: { pulses: false, wave: false },
    hint: "The Guide scan as the molecule: Cas9 and its guide RNA on a DNA strand where every base pair is a note",
    toast: "Cas9 — the white protein holds the orange guide RNA against the blue DNA. Every base pair is a note; gold ones are where the guide matches. Drag to turn it",
    layout: () => cas9Layout(), draw: () => drawCas9(), fit: n => !!(mapCache.cas9 && mapCache.cas9.home.has(n.id)),
    legend: item => item(`<b style="color:${c9Css(C9.PROTEIN)}">●</b>`, "Cas9 protein") + item(`<b style="color:${c9Css(C9.RNA)}">●</b>`, "guide RNA") + item(`<b style="color:${c9Css(C9.OTHER)}">●</b>`, "DNA: a base pair is a note") + item(`<b style="color:${c9Css(C9.HIT)}">●</b>`, "the guide matches") + item(`<b style="color:${c9Css(C9.NEAR)}">●</b>`, "look-alike"),
    today() { const L = mapCache.cas9; if (!L || !L.site) return null; const i = L.sites.findIndex(n => n.id === L.site);
      return { text: `Cas9 is on ${byId[L.site].name}: site ${i + 1} of ${L.sites.length} for ${c9Guide(L)}`, label: L.sites.length > 1 ? "Next site" : "Open it", run: () => (L.sites.length > 1 ? c9Step(1) : select(L.site)) }; },
    api: { layout: () => mapCache.cas9, parts: () => c9Parts(), drew: () => c9.drew, at: id => P.get(id), step: d => c9Step(d), go: id => c9Go(id), yaw: () => cam.yaw, still: () => { cam.spin = null; } },   // for tests/test_cas9.js
  });
