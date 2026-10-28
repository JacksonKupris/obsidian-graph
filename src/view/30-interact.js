  // ---------------------------------------------------------------- frame loop
  let settledShown = false, lastNeural = 0, onScreen = true, lastMapAnim = 0, drawMs = 0;
  const liveEdits = [];   // notes edited while the graph is open (from live sync): {id, t}
  const tickOf = (o, now) => { const dt = Math.min(100, now - (o.last || now)); o.last = now; return reducedMotion() ? 0 : dt; };
  const ANIM_MAPS = { ...Object.fromEntries(Object.entries(SCENES).map(([k, d]) => [k, d.fps || 30])), radar: 60, ships: 30, weather: 30, sky: 30, garden: 30, foodweb: 30, alchemy: 30, ripples: 30, subway: 30, city: 30, clock: 30, topo: 30, realm: 30, palace: 30, rings: 20 };   // divisors of 60 Hz: an even cadence, no judder
  // An embed scrolled out of view (or a hidden pane) costs nothing: the loop stops and restarts when it's back
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver(es => {
    onScreen = es[es.length - 1].isIntersecting; if (onScreen) { dirty = true; kick(); }
  }) : null;
  function frame(now) {
    cssCache.clear();   // theme can change between frames; within one frame it can't
    raf = 0;
    if (destroyed || !onScreen) return;
    let more = false;
    if (morph) {   // layout transition (2D/3D <-> neural)
      const u = Math.min(1, (now - morph.t0) / morph.ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      for (const n of nodes) {
        const a = morph.from.get(n.id), b = morph.to.get(n.id);
        n.x = a[0] + (b[0] - a[0]) * e; n.y = a[1] + (b[1] - a[1]) * e; n.z = a[2] + (b[2] - a[2]) * e;
      }
      if (u >= 1) { morph = null; if (!neural()) alpha = Math.max(alpha, 0.04); }
      more = true; dirty = true;
    }
    if (replay) { stepReplay(now); more = true; dirty = true; }
    if (isCosmos() && !morph) alpha = Math.max(alpha, 0.1);   // orbits keep moving
    if (alpha > 0.005 && !neural() && !mapView() && !(isCosmos() && st.paused)) {
      tick(); more = true; dirty = true;
      if (alpha <= 0.005) { persistSoon(); renderStatus(); }   // settled: remember layout
      else if (settledShown) renderStatus();
    }
    if (cam.spin && st.three) {   // orbit momentum after a flick
      cam.yaw += cam.spin.y; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + cam.spin.p));
      cam.spin.y *= 0.9; cam.spin.p *= 0.9; dirty = true; more = true;
      if (Math.abs(cam.spin.y) + Math.abs(cam.spin.p) < 0.0005) cam.spin = null;
    }
    if (tween) {
      const u = Math.min(1, (now - tween.t0) / tween.ms), e = 1 - Math.pow(1 - u, 3);
      for (const key of TWEEN_KEYS) cam[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * e;
      if (!(cam.k > 0.03)) cam.k = 0.03;   // a bad target (e.g. fitting an empty set) must never flip the view
      if (u >= 1) tween = null; else more = true;
      dirty = true;
    }
    if (isCosmos()) { dirty = true; more = true; if (st.ship) shipStep(); }
    // Animated maps (radar sweep, ships, wind, twinkling, swaying plants, pulses) redrew only on input, so they
    // jumped. Like neural: a steady budget while visible, full rate while moving, 3 fps when Obsidian isn't focused.
    const animFps = mapView() && !reducedMotion() ? ANIM_MAPS[st.view] || 0 : 0;
    if (animFps) {
      const busy = morph || tween || drag, fps = busy ? 0 : !document.hasFocus() ? 3 : opts.compact ? Math.min(15, animFps) : animFps;
      if (!fps || now - lastMapAnim >= 1000 / fps - 2) { lastMapAnim = now; dirty = true; }
      more = true;
    }
    if (neural()) {   // living view: pulses + slow drift while idle
      // Frame budget: full rate while you're moving it, otherwise 30 fps (15 in small panes and the
      // home-screen card), and 3 fps while Obsidian isn't the focused window.
      const busy = morph || tween || drag || cam.spin;
      const fps = busy ? 0 : !document.hasFocus() ? 3 : opts.compact ? 15 : 30;
      const dt = Math.min(250, now - (lastNeural || now));
      if (!fps || dt >= 1000 / fps) {
        if (!opts.compact && !drag && !tween && !reducedMotion() && now - lastInteract > 3500) cam.yaw += 0.0016 * dt / 16.7;   // not in small panes: it drifts a few notes out of view
        lastNeural = now; dirty = true;
      }
      more = true;
      if (st.selected && dirty && (now | 0) % 6 === 0) renderHud();
    }
    if (dirty && W) { const t0 = performance.now(); draw(now); drawMs = drawMs * 0.9 + (performance.now() - t0) * 0.1; dirty = false; }
    if (bursts.length && W) { if (drawBursts(now)) { more = true; dirty = true; } }
    if (refitOnSettle && alpha < 0.05 && W && !morph) { const p = refitOnSettle; refitOnSettle = null; if (!cam.userMoved) { fit(p, 400); more = true; } }
    if (!fitted && (alpha < 0.05 || neural() || mapView()) && W && !morph) { fitted = true; fit(neural() ? n => !special(n) : mapView() ? mapFitPred() : null, 600); more = true; }
    if (more) kick();
  }
  function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
  const ro = new ResizeObserver(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, MOBILE ? 2 : 3);
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    cv.style.width = W + "px"; cv.style.height = H + "px";
    if (fitted && !cam.userMoved) fit(lastFit, 0);   // keep the framing until the user pans/zooms
    dirty = true; kick();
  });
  ro.observe(wrap);
  if (io && !opts.alwaysOn) io.observe(wrap);   // alwaysOn: the plugin's off-screen self-test still has to draw
  if (opts.embed) cv.style.touchAction = "pan-y pinch-zoom";   // one finger scrolls the page around the embed
  const narrow = () => root.clientWidth < 760;
  // a lens sits beside the view on a wide pane (vault_graph_view.css, same width), so choosing a row shows it there; narrower, the lens covers the view and closes first
  const lensBeside = () => root.clientWidth >= 1100;
  // in a narrow pane the side panel is a drawer over the toolbar: anything that opens a panel or acts on the graph closes it
  const closeDrawer = () => { if (narrow()) root.classList.remove("vg-side-open"); };

  // ---------------------------------------------------------------- pointer (mouse, pen, touch)
  // the notes a pointer can reach: what's drawn (map views also draw unlinked notes, through mapShown)
  const pickable = () => mapView() ? nodes.filter(mapShown) : active;
  const hit = (mx, my) => {
    // closest centre relative to size wins; depth only breaks near-ties (a tiny node in front
    // of a big one must not steal clicks aimed at the big one's centre). Touch gets a bigger target.
    const slop = MOBILE ? 12 : 4;
    let best = null, bestScore = Infinity;
    for (const n of pickable()) {
      const p = P.get(n.id); if (!p || p.r == null || p.a < 0.15) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d > p.r + slop) continue;
      const score = d / (p.r + slop) + p.depth * 1e-5;
      if (score < bestScore) { best = n; bestScore = score; }
    }
    return best;
  };
  const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // Move a node with the pointer; its neighbourhood follows through the springs. In 3D the screen delta
  // is mapped back through the camera rotation, so the node moves in the plane facing you.
  function dragNode(n, dx, dy) {
    const p = P.get(n.id); if (!p) return;
    const X = dx / p.s, Y = dy / p.s;
    let wx = X, wy = Y, wz = 0;
    if (st.three) {   // inverse of project(): un-pitch, then un-yaw (screen-plane delta has Z = 0)
      const [cy, sy, cp, sp] = rot(), z1 = -Y * sp;
      wy = Y * cp; wx = X * cy - z1 * sy; wz = X * sy + z1 * cy;
    } else if (cam.turn) { wx = Y; wy = -X; }   // undo proj()'s quarter turn
    const base = n.pin || [n.x, n.y, n.z];
    n.pin = [base[0] + wx, base[1] + wy, base[2] + wz];
    alpha = Math.max(alpha, 0.25); kick();
  }
  let drag = null, pinch = null, lastTap = null, pressTimer = 0;
  const pointers = new Map();
  cv.addEventListener("pointerdown", e => {
    cv.setPointerCapture(e.pointerId); root.focus({ preventScroll: true }); closeMenu();
    lastInteract = performance.now();
    closeDrawer();   // tapping the graph closes the drawer
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 2) {   // pinch / two-finger pan
      clearTimeout(pressTimer); drag = null;
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, tx0: cam.tx, ty0: cam.ty };
      tween = null; return;
    }
    if (isCosmos() && st.placing) { placeBody(st.placing, x, y); return; }
    // a scene that takes drags itself (painting in Falling sand): press(phase, x, y) returns true to keep the pointer
    if (SCENES[st.view] && SCENES[st.view].press && !hit(x, y) && SCENES[st.view].press("down", x, y)) { pressing = true; return; }
    const body = isCosmos() ? bodyHit(x, y) : null;
    const n = body ? null : hit(x, y);
    const lasso = st.lasso || e.altKey;
    drag = { x, y, x0: x, y0: y, moved: false, orbit: st.three && !e.shiftKey, node: lasso ? null : n, body, lasso, vy: 0, vp: 0, touch: e.pointerType === "touch" };
    tween = null; cam.spin = null;
    if (e.pointerType === "touch" && n && !lasso) {   // long-press selects (and buzzes)
      pressTimer = setTimeout(() => { if (drag && !drag.moved) { drag.longPress = true; select(n.id); if (navigator.vibrate) navigator.vibrate(12); } }, 520);
    }
  });
  cv.addEventListener("pointermove", e => {
    const [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x, y });
    if (pressing && SCENES[st.view] && SCENES[st.view].press) { SCENES[st.view].press("move", x, y); dirty = true; kick(); return; }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = Math.min(12, Math.max(0.03, pinch.k0 * d / pinch.d0)), r = k / pinch.k0;
      cam.k = k; cam.tx = (pinch.mx - W / 2) - ((pinch.mx - W / 2) - pinch.tx0) * r + (mx - pinch.mx); cam.ty = (pinch.my - H / 2) - ((pinch.my - H / 2) - pinch.ty0) * r + (my - pinch.my);
      cam.userMoved = true; dirty = true; kick(); return;
    }
    if (drag) {
      const dx = x - drag.x, dy = y - drag.y;
      if (!drag.moved && Math.abs(x - drag.x0) + Math.abs(y - drag.y0) > (drag.touch ? 8 : 3)) { drag.moved = true; clearTimeout(pressTimer); root.classList.add("is-dragging"); }
      if (drag.moved) {
        lastInteract = performance.now();
        if (drag.body) { drag.body.x += dx / cam.k; drag.body.y += dy / cam.k; drag.fvx = dx / cam.k; drag.fvy = dy / cam.k; persistSoon(); }
        else if (drag.lasso) { drawLassoBox(drag.x0, drag.y0, x, y); }
        else if (drag.node && !neural() && !mapView()) dragNode(drag.node, dx, dy);
        else if (drag.orbit) {
          drag.vy = dx * 0.006; drag.vp = dy * 0.006;
          cam.yaw += drag.vy; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + drag.vp));
        } else { cam.tx += dx; cam.ty += dy; st.follow = null; }
        if (!drag.node) cam.userMoved = true;
        drag.x = x; drag.y = y; tip.classList.remove("is-on"); dirty = true; kick();
      }
      return;
    }
    if (e.pointerType === "touch") return;   // no hover on touch
    const n = hit(x, y), id = n ? n.id : null;
    if (id !== st.hover) {
      st.hover = id; dirty = true; kick();
      cv.style.cursor = n ? "pointer" : (st.three ? "grab" : "default");
      if (n && opts.onHoverNote && !special(n)) opts.onHoverNote(n.id, e);
    }
    if (n) {
      const sub = n.moc ? `Map of content · ${n.outlinks} notes in ${esc(clusterName(n.cluster))}` : n.ghost ? `Not written yet · linked from ${plural(n.from.length, "note")}` : n.person ? `Person · ${plural(n.outlinks, "linked note")}`
        : `${plural(nb[n.id].size, "link")} · ${esc(clusterName(n.cluster))}${n.recent ? ` · ${n.recent} recent` : ""}${n.tasks ? ` · ${plural(n.tasks, "open task")}` : ""}`;
      tip.innerHTML = `<div class="vg-tip-title"><span class="vg-dot" style="background:${fillOf(n)}"></span>${esc(n.name)}</div>` +
        `<div class="vg-muted">${esc(n.folder || "/")}</div><div class="vg-tip-meta">${sub}</div>`;
      tip.classList.add("is-on");
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (x + 14 + tw > W ? Math.max(4, x - 14 - tw) : x + 14) + "px";
      tip.style.top = Math.min(H - th - 4, y + 12) + "px";
    } else if (lobeAt(x, y) != null) {
      const c = lobeAt(x, y), g = lobeStats[c] || { notes: 0, fresh: 0, stale: 0, tasks: 0 };
      const map = mocOf[c];
      tip.innerHTML = `<div class="vg-tip-title"><span class="vg-dot" style="background:${neonOf(c)}"></span>${esc(clusterName(c))}</div>` +
        `<div class="vg-tip-meta">${plural(g.notes, "note")} · ${g.fresh} edited this week · ${plural(g.stale, "stale note")} (${Q.stale_days}+ days)` +
        `${g.tasks ? ` · ${plural(g.tasks, "open task")}` : ""}</div><div class="vg-muted">${map ? `Map: ${esc(map.title)}` : "No map for this topic yet"} · click to focus</div>`;
      tip.classList.add("is-on"); cv.style.cursor = "pointer";
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (x + 14 + tw > W ? Math.max(4, x - 14 - tw) : x + 14) + "px";
      tip.style.top = Math.min(H - th - 4, y + 12) + "px";
    } else { tip.classList.remove("is-on"); cv.style.cursor = st.three ? "grab" : "default"; }
  });
  const lobeAt = (x, y) => { if (!neural()) return null; const s = lobeSpots.find(([lx, ly, w, h]) => x >= lx && x <= lx + w && y >= ly && y <= ly + h); return s ? s[4] : null; };
  const endPointer = e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return true; }
    return false;
  };
  cv.addEventListener("pointerleave", e => { tip.classList.remove("is-on"); if (st.hover) { st.hover = null; dirty = true; kick(); } });
  cv.addEventListener("pointercancel", e => { endPointer(e); drag = null; clearTimeout(pressTimer); root.classList.remove("is-dragging"); });
  cv.addEventListener("pointerup", e => {
    clearTimeout(pressTimer);
    if (pressing) { pressing = false; if (SCENES[st.view] && SCENES[st.view].press) SCENES[st.view].press("up", ...local(e)); endPointer(e); drag = null; return; }
    if (endPointer(e)) return;
    const d = drag; drag = null; root.classList.remove("is-dragging");
    if (d && d.lasso) { finishLasso(d, ...local(e)); return; }
    if (d && d.body) { if (!d.moved) selectBody(d.body.id); else releaseBody(d.body, d.fvx || 0, d.fvy || 0); return; }
    if (d && d.node && d.node.pin) { d.node.pin = null; alpha = Math.max(alpha, 0.15); kick(); }   // let go: it springs back into place
    if (d && d.moved && d.orbit && !d.node && Math.abs(d.vy) + Math.abs(d.vp) > 0.004) { cam.spin = { y: d.vy, p: d.vp }; kick(); }
    if (!d || d.moved || d.longPress) return;
    const [x, y] = local(e), n = hit(x, y);
    if (d.touch) {   // double-tap focuses (dblclick doesn't fire reliably for touch)
      const now = performance.now();
      if (n && lastTap && lastTap.id === n.id && now - lastTap.t < 320) { lastTap = null; enterFocus(n.id); return; }
      lastTap = n ? { id: n.id, t: now } : null;
    }
    if (!n) { const sp = spots.slice().reverse().find(([sx, sy, w, h]) => x >= sx && x <= sx + w && y >= sy && y <= sy + h); if (sp) { sp[4](x, y); dirty = true; kick(); return; } }
    if (!n && st.view === "clock") { const cs = clockSpots.find(([cx, cy, w, h]) => x >= cx && x <= cx + w && y >= cy && y <= cy + h); if (cs) { st.clockFocus = st.clockFocus === cs[4] ? null : cs[4]; dirty = true; kick(); return; } }
    if (!n && isCosmos()) {
      const moon = moonSpots.find(([mx, my]) => Math.hypot(mx - x, my - y) < 6);
      if (moon) { select(moon[2]); const tb = $(".vg-inspector .vg-tasksbox"); if (tb) renderTasks(moon[2], tb); return; }
      const con = constSpots.find(([cx, cy, w, h]) => x >= cx && x <= cx + w && y >= cy && y <= cy + h);
      if (con) { applySaved(con[4]); return; }
      const w = wormholeHit(x, y); if (w) { select(w.s.id); return; }
      if (st.ship) { warpTo(x, y); return; }
    }
    if (!n && lobeAt(x, y) != null) { focusClusters([lobeAt(x, y)]); return; }
    if (!n) { clearHighlight(); clearMulti(); select(null); if (st.body) { st.body = null; $(".vg-inspector").hidden = true; root.classList.remove("has-inspector"); } return; }
    if ((e.ctrlKey || e.metaKey) && opts.openNote && !special(n)) { opts.openNote(n.id, true); return; }
    if (e.shiftKey && st.selected && st.selected !== n.id) { findPath(st.selected, n.id); return; }
    if (opts.compact && opts.openNote && !special(n)) { opts.openNote(n.id, false); return; }   // side pane: click opens
    select(n.id);
  });
  cv.addEventListener("dblclick", e => {
    const [x, y] = local(e), n = hit(x, y);
    if (n && !special(n) && st.focus !== n.id) enterFocus(n.id);
    else if (!n) fit(st.focusDist ? m => st.focusDist.has(m.id) : lastFit, 400);   // empty space: recenter
  });   // touch already focused on double-tap
  cv.addEventListener("wheel", e => {
    if (opts.embed && !e.ctrlKey && !e.metaKey) return;   // let the note scroll
    e.preventDefault(); tween = null; lastInteract = performance.now();
    const [mx, my] = local(e), k = Math.min(12, Math.max(0.03, cam.k * Math.exp(-e.deltaY * 0.0015))), r = k / cam.k;
    cam.tx = (mx - W / 2) - ((mx - W / 2) - cam.tx) * r; cam.ty = (my - H / 2) - ((my - H / 2) - cam.ty) * r;
    cam.k = k; cam.userMoved = true; dirty = true; kick();
  }, { passive: false });

  // ---------------------------------------------------------------- lasso + multi-select
  const lassoEl = $(".vg-lasso");
  function drawLassoBox(x0, y0, x1, y1) {
    lassoEl.hidden = false;
    Object.assign(lassoEl.style, { left: Math.min(x0, x1) + "px", top: Math.min(y0, y1) + "px", width: Math.abs(x1 - x0) + "px", height: Math.abs(y1 - y0) + "px" });
  }
  function finishLasso(d, x, y) {
    lassoEl.hidden = true;
    const [x0, x1] = [Math.min(d.x0, x), Math.max(d.x0, x)], [y0, y1] = [Math.min(d.y0, y), Math.max(d.y0, y)];
    const ids = pickable().filter(n => { const p = P.get(n.id); return p && p.a > 0.2 && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !n.ghost; }).map(n => n.id);
    setLassoMode(false);
    if (!ids.length) return;
    st.multi = new Set(ids); select(null); showMulti(); dirty = true; kick();
  }
  function setLassoMode(on) { st.lasso = on; $(".vg-lassobtn").setAttribute("aria-pressed", on); syncToolsBtn(); root.classList.toggle("is-lasso", on); if (on) toast("Drag a box around the notes to select"); }
  $(".vg-lassobtn").onclick = () => setLassoMode(!st.lasso);
  function clearMulti() { if (!st.multi) return; st.multi = null; const box = $(".vg-inspector"); box.hidden = true; root.classList.remove("has-inspector"); dirty = true; kick(); }
  function showMulti() {
    $(".vg-inspector").dataset.id = "";   // not a single note: the next note shown starts at the top
    const ids = [...st.multi], box = $(".vg-inspector"), groups = {};
    ids.forEach(id => (groups[byId[id].cluster] = groups[byId[id].cluster] || []).push(id));
    box.hidden = false; root.classList.add("has-inspector");
    box.innerHTML = `<div class="vg-sheet-handle" aria-hidden="true"></div>
      <div class="vg-ins-head"><span class="vg-chip" style="--c:${css("--vg-accent")}">Selection</span>
        <button class="vg-ibtn vg-ins-close" aria-label="Close" title="Close (Esc)">${icon("close")}</button></div>
      <h2 class="vg-ins-title">${plural(ids.length, "note")} selected</h2>
      <div class="vg-ins-actions vg-wrap">
        <button class="vg-btn" data-act="copy">${icon("copy", 14)} Copy links</button>
        ${opts.writeNote ? `<button class="vg-btn" data-act="hub">${icon("hub", 14)} Hub note</button><button class="vg-btn" data-act="map">${icon("file", 14)} Map note</button>` : ""}
      </div>
      <div class="vg-ins-sec">${Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([c, ms]) =>
        `<details class="vg-group" open><summary><span class="vg-dot" style="background:${colorOf(+c)}"></span>${esc(clusterName(+c))} <span class="vg-count">${ms.length}</span></summary>${ms.map(m => noteRow(m)).join("")}</details>`).join("")}</div>`;
    box.querySelector(".vg-ins-close").onclick = clearMulti;
    box.querySelector('[data-act="copy"]').onclick = () => copy(ids.map(id => mdLink(id)).join("\n"), `Copied ${plural(ids.length, "link")}`);
    const hub = box.querySelector('[data-act="hub"]'); if (hub) hub.onclick = () => writeSelectionHub(ids);
    const map = box.querySelector('[data-act="map"]'); if (map) map.onclick = () => writeMap(ids, "Selection");
    wire(box); wireSheet(box);
  }

  // ---------------------------------------------------------------- keyboard
  root.addEventListener("keyup", e => { const d = SCENES[st.view]; if (d && d.key) d.key(e.key.toLowerCase(), false); });
  root.addEventListener("keydown", e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape") {
      if (tourIdx >= 0) endTour();
      else if (closeTools()) { $(".vg-toolsbtn").focus(); }
      else if (!$(".vg-palette").hidden) { closePalette(); }
      else if (!$(".vg-picker").hidden) closeMenu();
      else if (!$(".vg-lens").hidden) closeLens();
      else if (typing) { e.target.blur(); return; }
      else if (st.lasso) setLassoMode(false);
      else if (st.placing) { st.placing = null; root.classList.remove("is-placing"); $$(".vg-dockbtn").forEach(x => x.setAttribute("aria-pressed", "false")); dirty = true; }
      else if (st.body) { st.body = null; $(".vg-inspector").hidden = true; root.classList.remove("has-inspector"); dirty = true; }
      else if (st.path) clearPath();
      else if (st.focus && !st.quietFocus) exitFocus();
      else if (st.multi) clearMulti();
      else if (st.selected) select(null);
      else if (st.highlight) clearHighlight();
      else if (root.classList.contains("vg-side-open")) root.classList.remove("vg-side-open");
      else return;
      e.stopPropagation(); return;
    }
    if (typing) return;
    lastInteract = performance.now();
    const k = KEYS.find(x => x.run && (x.match ? x.match(e) : !e.ctrlKey && !e.metaKey && !e.altKey && x.keys[0].toLowerCase() === e.key.toLowerCase()) && (!x.when || x.when()));
    if (k) { if (k.prevent) e.preventDefault(); k.run(e); }
  });
  // Every keyboard shortcut, once: the handler above runs them and the shortcuts sheet (?) lists them, so the two can't
  // disagree. keys[0] is the key matched unless match() says otherwise; an entry without run() is only listed.
  const KEYS = [
    { keys: ["W A S D", "Space"], label: "Walk and attack (Dungeon)", prevent: true, match: e => !!(SCENES[st.view] && SCENES[st.view].keys && SCENES[st.view].keys.test(e.key.toLowerCase())),
      run: e => { SCENES[st.view].key(e.key.toLowerCase(), true); kick(); } },
    { keys: ["W A S D", "Q E"], label: "Fly the ship (Cosmos, ship on)", prevent: true, match: e => st.ship && isCosmos() && /^(w|a|s|d|q|e|arrowup|arrowdown|arrowleft|arrowright)$/.test(e.key.toLowerCase()),
      run: e => { ship.keys.add(e.key.toLowerCase()); kick(); } },
    { keys: ["/", "Ctrl K"], label: "Search notes, clusters and inside notes", prevent: true, run: () => openPalette() },
    { keys: ["Esc"], label: "Close what's open, or step back one level" },
    { keys: ["Enter"], label: "Open the selected note (Ctrl+Enter: in a new tab)", match: e => e.key === "Enter", when: () => st.selected && opts.openNote && !special(byId[st.selected]), run: e => opts.openNote(st.selected, e.ctrlKey || e.metaKey) },
    { keys: ["F"], label: "Focus on the selected note and its neighbours", when: () => st.selected, run: () => enterFocus(st.selected) },
    { keys: ["Arrows"], label: "Move to the linked note in that direction (nothing selected: pan)", prevent: true, match: e => e.key.startsWith("Arrow") && !(st.ship && isCosmos()), run: e => walk(e.key) },
    { keys: ["Tab", "Shift Tab"], label: "Next or previous linked note", prevent: true, match: e => e.key === "Tab", when: () => st.selected, run: e => cycleNeighbour(e.shiftKey ? -1 : 1) },
    { keys: ["+", "−"], label: "Zoom in or out", match: e => "+=-_".includes(e.key) && e.key.length === 1, run: e => zoomBy("+=".includes(e.key) ? 1.25 : 0.8) },
    { keys: ["0"], label: "Fit everything on screen", run: () => fit(neural() ? n => !special(n) : null) },
    { keys: ["M"], label: "Choose a view", run: () => openPicker() },
    { keys: ["3"], label: "Switch 2D and 3D (in a 3D scene: flat, tilt, iso)", run: () => isoAngle() ? cycleAngle() : setView(st.view === "3d" ? "2d" : "3d") },
    { keys: ["N"], label: "Neural view", run: () => setView(neural() ? "3d" : "neural") },
    { keys: ["C"], label: "Cosmos view", run: () => setView(isCosmos() ? "2d" : "cosmos") },
    { keys: ["R"], label: "Replay how the vault grew", run: () => toggleReplay() },
    { keys: ["T"], label: "Time slider", run: () => toggleTimebar($(".vg-timebar").hidden) },
    { keys: ["G"], label: "Today", when: () => !opts.compact, run: () => setMissionsShown(!root.classList.contains("show-missions"), true) },
    { keys: ["Space"], label: "Pause or play (Cosmos)", prevent: true, match: e => e.key === " ", when: () => isCosmos(), run: () => setPaused(!st.paused) },
    { keys: ["?"], label: "This list", match: e => e.key === "?", run: () => showKeys() },
  ];
  function showKeys() {
    const kbd = k => k.split(" ").map(x => `<kbd>${esc(x)}</kbd>`).join(" ");
    const shown = [...KEYS.filter(x => !x.match || !/ship/.test(x.label)), ...KEYS.filter(x => x.match && /ship/.test(x.label))];   // the ship's keys match first, read last
    confirmBox("Keyboard shortcuts", `<table class="vg-keys">${shown.map(x => `<tr><td>${x.keys.map(kbd).join(" or ")}</td><td>${esc(x.label)}</td></tr>`).join("")}</table>`, "Done", null, { only: true });
  }
  // Walk the graph from the keyboard: an arrow moves to the linked note lying most in that direction on
  // screen; with nothing selected, arrows pan.
  const ARROW = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function walk(key) {
    const [dx, dy] = ARROW[key];
    if (!st.selected) { cam.tx -= dx * 80; cam.ty -= dy * 80; cam.userMoved = true; dirty = true; kick(); return; }
    project();
    const a = P.get(st.selected); if (!a) return;
    let best = null, bestScore = Infinity;
    neighboursOf(st.selected).forEach(id => {
      const b = P.get(id); if (!b) return;
      const vx = b.x - a.x, vy = b.y - a.y, d = Math.hypot(vx, vy) || 1, cos = (vx * dx + vy * dy) / d;
      if (cos < 0.35) return;   // within ~70 degrees of the arrow
      const score = d * (2 - cos);
      if (score < bestScore) { best = id; bestScore = score; }
    });
    if (best) goTo(best); else toast("No linked note that way");
  }
  const neighboursOf = id => [...nb[id], ...(peopleOf[id] || [])].filter(m => byId[m] && active.includes(byId[m]))
    .sort((x, y) => byId[y].bc - byId[x].bc);
  let cycleFrom = null, cycleIdx = -1;
  function cycleNeighbour(dir) {
    if (cycleFrom === null || (st.selected !== cycleFrom && !nb[cycleFrom].has(st.selected))) { cycleFrom = st.selected; cycleIdx = -1; }
    const list = neighboursOf(cycleFrom); if (!list.length) return;
    cycleIdx = (cycleIdx + dir + list.length) % list.length;
    goTo(list[cycleIdx], true);
  }
  function goTo(id, keepCycle) {
    if (!keepCycle) cycleFrom = null;
    select(id);
    const p = P.get(id);
    if (!p || p.x < 40 || p.y < 60 || p.x > W - 40 || p.y > H - 40) centreOn(id, cam.k);   // keep it on screen
  }

  // ---------------------------------------------------------------- focus mode
  function enterFocus(id, depth, quiet) {
    if (!st.focus && !neural()) keepLayout();
    st.focus = id; st.focusDepth = depth || st.focusDepth; st.quietFocus = !!quiet;
    const dist = new Map([[id, 0]]), queue = [id];
    while (queue.length) {
      const v = queue.shift(), d = dist.get(v);
      if (d >= st.focusDepth) continue;
      nb[v].forEach(m => { if (!dist.has(m) && baseVisible(byId[m])) { dist.set(m, d + 1); queue.push(m); } });
    }
    st.focusDist = dist;
    const n = byId[id];
    if (!neural()) { cam.cx = n.x; cam.cy = n.y; cam.cz = n.z; }
    fitted = true; rebuild(true); if (!quiet) select(id); else { st.selected = id; dirty = true; }
    setTimeout(() => fit(m => dist.has(m.id), quiet ? 300 : 500), quiet ? 250 : 400);
    // the reheated layout keeps moving after that first fit and could carry the notes out of a small pane
    refitOnSettle = m => st.focusDist && st.focusDist.has(m.id);
    if (quiet) return;
    const bar = $(".vg-focusbar:not(.vg-pathbar)");
    bar.hidden = false;
    bar.innerHTML = `${icon("target", 14)}<span class="vg-fb-text">Focus · <b>${esc(n.name)}</b> <span class="vg-muted">${plural(dist.size - 1, "note")}</span></span>
      <label class="vg-fb-depth"><span class="vg-muted">Depth</span><input type="range" min="1" max="4" value="${st.focusDepth}" class="vg-range vg-fdepth" aria-label="Focus depth"><b>${st.focusDepth}</b></label>
      <button class="vg-btn vg-btn-sm vg-fexit">Exit <kbd>Esc</kbd></button>`;
    bar.querySelector(".vg-fdepth").oninput = e => enterFocus(id, +e.target.value);
    bar.querySelector(".vg-fexit").onclick = exitFocus;
    root.focus({ preventScroll: true });
  }
  function exitFocus() {
    st.focus = null; st.focusDist = null; st.quietFocus = false; $(".vg-focusbar:not(.vg-pathbar)").hidden = true;
    if (!neural()) {
      cam.cx = cam.cy = cam.cz = 0;
      if (layoutClean() && applyLayout()) { rebuild(false); alpha = 0.05; } else rebuild(true);   // back to the familiar map
    } else rebuild(false);
    setTimeout(() => fit(null, 500), 400);
  }



  // ---------------------------------------------------------------- first-run tour
  // one short sentence per step, each about the control it points at
  const TOUR = [
    { sel: ".vg-pickbtn", title: "Views and lenses", text: "Draw the vault another way (2D, 3D, City, Cosmos…) or open a lens: a focused list with buttons that fix what it finds. Press M." },
    { sel: ".vg-searchbtn", title: "Search", text: "Jump to any note, topic or saved view. Press / or Ctrl K." },
    { sel: ".vg-reviewbtn", title: "Today's review", text: "One small improvement at a time: a link to add, a note to put on its map, a note to write." },
    { sel: ".vg-toggle", title: "Insights", text: "What changed since the last analysis, your topics and the gaps between them. Tap a count to see those notes." },
    { sel: ".vg-cv", ring: false, title: "Tap a note", text: "Its panel lists what it needs, each with the button that fixes it." },
  ];
  let tourIdx = -1, tourSeen = false;
  function startTour() { tourIdx = 0; showTour(); }
  function endTour() { tourIdx = -1; const o = root.querySelector(".vg-tour"); if (o) o.remove(); tourSeen = true; persistSoon(); }
  function showTour() {
    let o = root.querySelector(".vg-tour"); if (!o) { o = document.createElement("div"); o.className = "vg-tour"; root.appendChild(o); }
    while (tourIdx < TOUR.length) { const el = $(TOUR[tourIdx].sel); if (el && el.offsetParent !== null) break; tourIdx++; }   // skip steps hidden at this width
    if (tourIdx >= TOUR.length) { endTour(); return; }
    const step = TOUR[tourIdx], el = $(step.sel), r = el.getBoundingClientRect(), R = root.getBoundingClientRect();
    const x = r.left - R.left, y = r.top - R.top, below = y + r.height + 170 < R.height;
    // a step about the whole canvas (ring: false) gets no ring and a card in the middle
    const card = step.ring === false ? `left:${Math.max(10, (R.width - 290) / 2)}px;top:${Math.max(60, R.height / 2 - 80)}px` : `left:${Math.max(10, Math.min(R.width - 300, x))}px;${below ? `top:${y + r.height + 12}px` : `bottom:${R.height - y + 12}px`}`;
    o.innerHTML = `${step.ring === false ? "" : `<div class="vg-tour-ring" style="left:${x - 4}px;top:${y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>`}
      <div class="vg-tour-card" style="${card}">
        <span class="vg-muted">${tourIdx + 1} / ${TOUR.length}</span><b>${esc(step.title)}</b><p>${esc(step.text)}</p>
        <div class="vg-confirm-acts"><button class="vg-btn vg-btn-ghost" data-t="skip">Skip</button><button class="vg-btn vg-btn-primary" data-t="next">${tourIdx === TOUR.length - 1 ? "Done" : "Next"}</button></div></div>`;
    o.querySelector('[data-t="skip"]').onclick = endTour;
    o.querySelector('[data-t="next"]').onclick = () => { tourIdx++; showTour(); };
    o.querySelector('[data-t="next"]').focus();
  }

  // ---------------------------------------------------------------- confirm dialog + discovery log
  // Every action that writes to the vault asks here first (an in-app dialog: works the same on phones).
  function confirmBox(title, body, okLabel, input, o = {}) {   // o.only: one button (a sheet to read, nothing to cancel)
    return new Promise(resolve => {
      const box = document.createElement("div"); box.className = "vg-confirm";
      box.innerHTML = `<div class="vg-confirm-box" role="dialog" aria-modal="true"><b class="vg-confirm-title">${esc(title)}</b>
        <div class="vg-confirm-body">${body}</div>${input ? `<textarea class="vg-input vg-confirm-input" rows="3" placeholder="${esc(input)}"></textarea>` : ""}
        <div class="vg-confirm-acts">${o.only ? "" : `<button class="vg-btn vg-btn-ghost" data-c="no">Cancel</button>`}<button class="vg-btn vg-btn-primary" data-c="ok">${esc(okLabel || "Do it")}</button></div></div>`;
      root.appendChild(box);
      const done = v => { box.remove(); root.focus({ preventScroll: true }); resolve(v); };
      if (!o.only) box.querySelector('[data-c="no"]').onclick = () => done(false);
      box.querySelector('[data-c="ok"]').onclick = () => { const ta = box.querySelector("textarea"); if (ta && !ta.value.trim()) { ta.focus(); return; } done(ta ? ta.value.trim() : true); };
      box.onclick = e => { if (e.target === box) done(false); };
      box.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
      (box.querySelector("textarea") || box.querySelector('[data-c="ok"]')).focus({ preventScroll: true });   // a long body opens at its top
    });
  }
  // formBox(title, rows, okLabel) -> the values by key, or null if cancelled. rows: [[field, ...], ...], each row side by
  // side; a field: { k, label, type: "text" | "select" | "color", options, value, required, hint }. Same dialog as confirmBox.
  function formBox(title, rows, okLabel) {
    return new Promise(resolve => {
      const ctl = f => f.type === "select" ? `<select class="vg-input" data-k="${f.k}">${f.options.map(o => { const [v, t] = [].concat(o); return `<option value="${esc(v)}"${v === f.value ? " selected" : ""}>${esc(t || v)}</option>`; }).join("")}</select>`
        : `<input class="vg-input" data-k="${f.k}" type="${f.type === "color" ? "color" : "text"}" value="${esc(f.value || "")}"${f.hint ? ` placeholder="${esc(f.hint)}"` : ""}${f.required ? " required" : ""}>`;
      const box = document.createElement("div"); box.className = "vg-confirm";
      box.innerHTML = `<div class="vg-confirm-box vg-form" role="dialog" aria-modal="true"><b class="vg-confirm-title">${esc(title)}</b>
        ${rows.map(r => `<div class="vg-form-row">${r.map(f => `<label class="vg-form-f${f.type === "color" ? " is-colour" : ""}"><span>${esc(f.label)}</span>${ctl(f)}</label>`).join("")}</div>`).join("")}
        <div class="vg-form-err" hidden></div>
        <div class="vg-confirm-acts"><button class="vg-btn vg-btn-ghost" data-c="no">Cancel</button><button class="vg-btn vg-btn-primary" data-c="ok">${esc(okLabel || "Save")}</button></div></div>`;
      root.appendChild(box);
      const done = v => { box.remove(); root.focus({ preventScroll: true }); resolve(v); };
      box.querySelector('[data-c="no"]').onclick = () => done(null);
      box.querySelector('[data-c="ok"]').onclick = () => {
        const empty = [...box.querySelectorAll("[required]")].find(x => !x.value.trim()); if (empty) { empty.focus(); return; }
        done(Object.fromEntries([...box.querySelectorAll("[data-k]")].map(x => [x.dataset.k, x.value.trim()]))); };
      box.onclick = e => { if (e.target === box) done(null); };
      box.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); done(null); } if (e.key === "Enter" && e.target.tagName === "INPUT") box.querySelector('[data-c="ok"]').click(); };
      box.querySelector("input, select").focus();
    });
  }
  // New scene: a form over the scene words (VGRules.SCENE_PARTS / SCENE_WHEN), written as a scene note in the scenes
  // folder; the note opens with its block, which has the Open button
  async function newScene() {
    const P = VGRules.SCENE_PARTS, rules = Object.keys(VGRules.SCENE_WHEN).filter(w => w !== "else");
    const ruleRow = (i, when, as, motion, colour) => [
      { k: `w${i}`, label: i ? "And notes that are" : "Notes that are", type: "select", options: [["", "(none)"], ...rules], value: when },
      { k: `a${i}`, label: "look like", type: "select", options: P.as, value: as },
      { k: `m${i}`, label: "and move", type: "select", options: P.motion, value: motion },
      { k: `c${i}`, label: "colour", type: "color", value: colour }];
    const v = await formBox("New scene", [
      [{ k: "name", label: "Name", required: true, hint: "Night market" }, { k: "blurb", label: "What it shows", hint: "Topics as stalls; busy ones glow" }],
      [{ k: "place", label: "Topics placed in a", type: "select", options: P.place, value: "grid" },
       { k: "angle", label: "Seen", type: "select", options: P.angle, value: "iso" },
       { k: "wall", label: "Walls show", type: "select", options: P.wall, value: "none" }],
      ruleRow(0, "stale", "walker", "drift", "#94a3b8"),
      ruleRow(1, "unlinked", "walker", "roam", "#f87171"),
      [{ k: "else", label: "Everything else looks like", type: "select", options: P.as, value: "block" }],
      [{ k: "verb", label: "Now and then", type: "select", options: [["", "(nothing happens)"], ...P.verb], value: "" },
       { k: "target", label: "aimed at the nearest", type: "select", options: rules, value: "stale" },
       { k: "every", label: "as often as the topic's", type: "select", options: P.every, value: "activity" }],
    ], "Create");
    if (!v) return;
    const o = { name: v.name, blurb: v.blurb, group: "topic", place: v.place, angle: v.angle, wall: v.wall,
      entity: [0, 1].filter(i => v[`w${i}`]).map(i => ({ when: v[`w${i}`], as: v[`a${i}`], motion: v[`m${i}`], colour: v[`c${i}`] })).concat([{ when: "else", as: v.else }]),
      events: v.verb ? [{ verb: v.verb, target: v.verb === "spar" ? null : v.target, every: v.every }] : [] };
    const { errors } = VGRules.sceneSpec({ ...o, entity: o.entity.map(r => r.when === "else" ? { else: r.as } : r), events: o.events.map(e => ({ every: e.every, do: e.verb + (e.target ? " nearest " + e.target : "") })) });
    if (errors.length) { toast(errors[0], "warn"); return; }
    const title = safeName(v.name) + " (scene)";
    const md = `---\ncreated: ${today()}\ntags:\n  - meta/knowledge-graph\n---\n# ${title}\n\n${v.blurb ? v.blurb + "\n\n" : ""}\`\`\`vault-graph-scene\n${VGRules.sceneYaml(o)}\n\`\`\`\n`;
    try { await opts.writeNote(`${FOLDERS.scenes}/${title}.md`, md, { mode: "create", open: true }); toast(`Created ${title}`, "ok"); }
    catch (e) { toast(e.message, "warn"); }
  }
  function logDiscovery(text) {
    if (!cos.log) cos.log = [];
    cos.log.unshift({ date: today(), text }); cos.log = cos.log.slice(0, 200);
    const rule = XP_FOR.find(([re]) => re.test(text)); if (rule) awardXp(rule[1], text);
    if (typeof updateDaily === "function") updateDaily(true);
    persistSoon(); if (typeof renderMissions === "function") renderMissions();
  }

  // ---------------------------------------------------------------- legend + status + HUD + toasts
  function renderLegend() {
    if (mapView()) {
      const item = (sw, t) => `<span class="vg-lg-item">${sw}${t}</span>`;
      $(".vg-legend").innerHTML = SCENES[st.view] ? (SCENES[st.view].legend ? SCENES[st.view].legend(item) : "") : st.view === "subway" ? item(`<i class="vg-lg-line" style="height:4px;background:${colorOf(0)}"></i>`, "line = topic") + item(`<i class="vg-lg-stn"></i>`, "note") + item(`<i class="vg-lg-stn is-x"></i>`, "connects topics")
        : st.view === "topo" ? item(`<span class="vg-lg-grad is-topo"></span>`, "height = relied on") + item(`<i class="vg-lg-line is-gap" style="border-color:#3a2a1a"></i>`, "bridge (link across topics)") + item(`<i class="vg-lg-fog"></i>`, "fog = quiet")
        : st.view === "garden" ? item("🌱", "seed → seedling → budding") + item("🌳", "evergreen = developed, relied on") + item("🍂", "wilting = stale") + item("🌸", "flowering = recent") + item("💧", "open tasks")
        : st.view === "weather" ? item("<b style='color:#b91c1c'>L</b>", "busier than usual") + item("<b style='color:#1d4ed8'>H</b>", "quieter") + item("⛈", "burst this week") + item("<i class='vg-lg-line' style='border-color:#dc2626'></i>", "front = come up together")
        : st.view === "ships" ? item("⚓", "port = topic") + item("⛴", "lane = links (more ships = more)") + item("🌫", "fog = gap, uncharted")
        : st.view === "rings" ? item("◎", "one ring per month") + item("<i class='vg-lg-bld'></i>", "wide = many new notes") + item("╱", "scar = incident or failure")
        : st.view === "sky" ? item("✦", "bright = relied on") + item("▲", "rising (recent)") + item("<b style='color:#fca5a5'>●</b>", "fading (stale)")
        : st.view === "realm" ? item("🏰", "castle = map (MOC)") + item("⛰", "mountain = relied on") + item("🌲", "forest = stale") + item("🐉", "unlinked notes")
        : st.view === "foodweb" ? item("↑", "producers at the bottom, logs at the top") + item("<b style='color:#f87171'>◯</b>", "endangered: relied on, stale")
        : st.view === "lineage" ? item("↝", "grew from: linked, already existed") + item("<b style='color:#fb923c'>↝</b>", "crossed into another topic") + item("●", "bigger = more grew from it")
        : st.view === "ripples" ? item("◎", "ring = clicks from your maps") + item("<b style='color:#f87171'>●</b>", "no link reaches it") + item("⌖", "select a note → Centre here")
        : st.view === "alchemy" ? item("<b style='color:#fbbf24'>●</b>", "gold at the centre, raw lead outside") + Object.values(REACTIONS).map(([n, c, w]) => item(`<b style='color:${c}'>⋯</b>`, `${n}: ${w}`)).join("")
        : st.view === "clock" ? item("◔", "ring = topic") + item("<i class='vg-lg-win'></i>", "brighter = more of its mentions")
        : st.view === "radar" ? item("<b style='color:#22c55e'>●</b>", "note with open tasks") + item("<b style='color:#f87171'>●</b>", "oldest task 90+ days") + item("↻", "click a blip to tick off")
        : st.view === "palace" && (!mapCache.palace || mapCache.palace.facade) ? item("▢", "window = note") + item("<b style='color:#fcd34d'>▢</b>", "lit = active") + item("▨", "boarded = stale") + item("<b style='color:#dc2626'>▁</b>", "red sill = open tasks") + item("<b style='color:#b91c1c'>⚡</b>", "crack = gap") + item("⌂", "click a floor to go in")
        : st.view === "palace" ? item(`<i class="vg-lg-stn"></i>`, "room = topic") + item("🚪", "door = links (wider = more)") + item(`<i class="vg-lg-line is-gap" style="border-color:#f87171"></i>`, "bricked = gap") + item("💡", "lit = recent") + item(`<i class="vg-lg-bld is-stale"></i>`, "dusty = stale")
        : item(`<i class="vg-lg-bld"></i>`, "height = relied on") + item(`<i class="vg-lg-win"></i>`, "lit = recent activity") + item(`<i class="vg-lg-bld is-stale"></i>`, "grey = stale") + item(`<i class="vg-lg-lot"></i>`, "empty lot = not written") + item("<b style='color:#ef4444'>•</b>", "beacon = open tasks") + item("🏛", "town hall = the topic's map");
      return;
    }
    const sizeWord = { bc: "influence", recent: "daily mentions", opens90: "opens · 90 days", opens: "opens" }[st.sizeBy];
    const colour = neural() && st.vision === "thermal" ? `<span class="vg-lg-item"><span class="vg-lg-grad is-thermal"></span>activity · ${DATA.recent_days}d</span>`
      : st.colorBy === "cluster" ? `<span class="vg-lg-item"><span class="vg-lg-dots">${(neural() ? NEON : PALETTE).slice(0, 5).map(c => `<i style="background:${c}"></i>`).join("")}</span>topic</span>`
      : `<span class="vg-lg-item"><span class="vg-lg-grad"></span>${st.colorBy === "opens90" ? "opens · 90d" : "mentions · 30d"}</span>`;
    $(".vg-legend").innerHTML = `<span class="vg-lg-item"><span class="vg-lg-size"><i></i><i></i></span>${sizeWord}</span>${colour}` +
      `<span class="vg-lg-item"><i class="vg-lg-line"></i>link</span>` +
      (neural() ? `<span class="vg-lg-item" title="Pulses fire along links of notes edited or mentioned lately; lobes glow by the same activity">✦ pulse · recent activity</span>` : "") +
      (st.gaps ? `<span class="vg-lg-item"><i class="vg-lg-line is-gap"></i>co-mentioned</span><span class="vg-lg-item"><i class="vg-lg-line is-sim"></i>similar</span>` : "") +
      (st.layers.mocs && mocs.length ? `<span class="vg-lg-item"><i class="vg-lg-hex"></i>map (MOC)</span>` : "") +
      (st.layers.people ? `<span class="vg-lg-item"><i class="vg-lg-diamond"></i>person</span>` : "") +
      (st.layers.wanted ? `<span class="vg-lg-item"><i class="vg-lg-ghost"></i>not written</span>` : "");
  }
  // A scene's own counts (alchemy's reactions, radar's tasks) go in the status pill like every other view's,
  // instead of text painted on the canvas where the banner or legend can cover it
  let sceneStat = { view: null, text: "" };
  function setSceneStat(text) { if (sceneStat.view !== st.view || sceneStat.text !== text) { sceneStat = { view: st.view, text }; renderStatus(); } }
  function renderStatus() {
    const settling = alpha > 0.005 && !neural() && !isCosmos() && !mapView();
    settledShown = settling;
    const parts = [sceneStat.view === st.view && sceneStat.text ? sceneStat.text : `${active.length} shown`];   // what's on screen (maps, people and unwritten notes too); the sidebar counts linked notes
    if (st.highlightLabel) parts.push(st.highlightLabel);
    if (st.path) parts.push(`path · ${plural(st.path.ids.length - 1, "step")}`);
    if (st.multi) parts.push(`${st.multi.size} selected`);
    if (st.hiddenClusters.size) parts.push(`${plural(st.hiddenClusters.size, "cluster")} hidden`);
    if (st.hidden.size) parts.push(`top ${st.hidden.size} hidden`);
    $(".vg-status").innerHTML = `${settling ? '<span class="vg-spin" aria-hidden="true"></span>Laying out · ' : ""}${parts.map(esc).join(" · ")}`;
  }
  function renderHud() {
    if (!neural()) return;
    const n = st.selected && byId[st.selected];
    $(".vg-hud-title").innerHTML = `<b>VAULT // NEURAL MAP</b><span>${esc(DATA.vault || "").toUpperCase()} · ${esc(DATA.date)} · ${st.vision.toUpperCase()}</span>` +
      `<span>NODES ${active.length} · LINKS ${visLinks.filter(l => l.kind === "link").length} · LOBES ${DATA.clusters.length} · MAPS ${mocs.length} · BRIDGES ${nodes.filter(n => n.bridge).length}</span>`;
    const p = n && P.get(n.id);
    $(".vg-hud-tele").innerHTML = n ? `<b>TARGET ▸ ${esc(n.name.toUpperCase())}</b>` +
      `<span>LOBE ${esc(clusterName(n.cluster).toUpperCase())}</span>` +
      `<span>RANK #${rankOf[n.id] || "—"} · LINKS ${nb[n.id].size} · MENTIONS ${n.mentions}</span>` +
      `<span>ACTIVITY ${"█".repeat(Math.min(10, Math.round(10 * (n.recent || 0) / maxRecent)))}${"░".repeat(10 - Math.min(10, Math.round(10 * (n.recent || 0) / maxRecent)))}</span>` +
      (p ? `<span>XYZ ${Math.round(n.x)} ${Math.round(n.y)} ${Math.round(n.z)}</span>` : "")
      : MOBILE ? `<span>NO TARGET · TAP A NODE</span><span>DRAG TO ORBIT · PINCH TO ZOOM</span>` : `<span>NO TARGET · CLICK A NODE</span><span>DRAG TO ORBIT · SCROLL TO ZOOM</span>`;
    $(".vg-hud-tele").classList.toggle("is-idle", !n);
  }
  // undo (optional): an Undo button on the toast, which then stays up longer
  function toast(msg, kind, undo) {
    if (opts.compact && !kind) return;   // explanatory toasts are noise in a card or embed; results and warnings still show
    const el = document.createElement("div");
    el.className = `vg-toast ${kind ? "is-" + kind : ""}`; el.textContent = msg;
    if (undo) {
      const b = document.createElement("button"); b.className = "vg-toast-undo"; b.textContent = "Undo";
      b.onclick = e => { e.stopPropagation(); el.remove(); undo(); };
      el.append(" ", b); el.classList.add("has-undo");
    }
    $(".vg-toasts").appendChild(el);
    // text is the background colour, which a see-through host (Hearth cards) makes invisible: pick black or white instead
    const tbg = getComputedStyle(el).color.match(/[\d.]+/g) || [], tfg = (getComputedStyle(el).backgroundColor.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
    if (tbg.length === 4 && +tbg[3] < 0.5) el.style.color = 0.299 * tfg[0] + 0.587 * tfg[1] + 0.114 * tfg[2] > 140 ? "#111" : "#fff";
    requestAnimationFrame(() => el.classList.add("is-in"));
    setTimeout(() => { el.classList.remove("is-in"); setTimeout(() => el.remove(), 250); }, undo ? UI.time.toastUndo : UI.time.toast);
  }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast(msg), () => toast("Couldn't copy", "warn"));
  }

