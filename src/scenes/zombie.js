  // Zombie outbreak: each topic is a walled settlement. Current notes are the survivors inside, stale notes are the
  // horde shambling at the walls, unlinked notes are raiders roaming the wasteland between. The wall is as high as the
  // share of the topic its map lists; the watchtower is the map. Survivors fire on the horde as often as the topic is
  // active. Marking a stale note current, or linking a raider, takes it off the street on the next redraw.
  ICON.zombie = '<circle cx="12" cy="6" r="3"/><path d="M12 9v7M8 21l4-5 4 5M5 11l7 1 7-3"/>';
  const ZB = { shots: [], last: 0, hit: new Map() };
  // a settlement is overrun when its horde outnumbers its survivors and its map lists little of it: then the oldest
  // stale notes are inside the wall
  const overrun = cp => cp.horde > Math.max(3, cp.alive) && cp.wall < 0.35;
  scene("zombie", {
    name: "Zombie outbreak", icon: "zombie", iso: true, fps: 30,
    blurb: "Topics as walled settlements; stale notes are the horde at the walls, unlinked ones roam as raiders",
    toast: "Zombie outbreak — settlements are topics, survivors are current notes, the horde is stale notes, raiders are unlinked notes; walls are as high as the topic's map coverage",
    layout(geo) {
      const pos = new Map(geo), camps = [], cs = topicsWithNotes(), { at, span } = placeGroups(cs.length, "grid", 520);
      cs.forEach((c, i) => {
        const ms = topicNotes(c.id, true), [cx, cy] = at[i];
        const alive = ms.filter(n => !staleFor(n, Q.stale_days)).sort(byImportance), dead = ms.filter(n => staleFor(n, Q.stale_days));
        const half = Math.min(200, 60 + 9 * Math.sqrt(alive.length) * 4), m = mocOf[c.id];
        const listed = m ? ms.filter(n => VGRules.onMap(m, n.id)).length : 0;
        camps.push({ c: c.id, cx, cy, half, wall: ms.length ? listed / ms.length : 0, horde: dead.length, alive: alive.length });
        packIn(alive, cx, cy, half, pos); ringAround(dead, cx, cy, half + 30, pos);
        if (m && byId[m.id]) pos.set(m.id, [cx - half + 14, cy - half + 14]);
      });
      // raiders: the unlinked notes, out between the settlements
      nodes.filter(n => n.isolated && !special(n) && !n.ghost).forEach(n => { const [u, v] = scatter("raider:" + n.id); pos.set(n.id, [(u - 0.5) * 2 * span, (v - 0.5) * 2 * span]); });
      const byC = Object.fromEntries(camps.map(k => [k.c, k]));
      return { pos, camps, byC, bounds: [[-span - 80, -span - 80], [span + 80, span + 80], [-span - 80, span + 80], [span + 80, -span - 80]] };
    },
    fit: n => !special(n) && !n.ghost,
    draw(now) {
      const { R, litSet, font, k } = mapFrame(), Z = mapCache.zombie, iso = isoKit(R, k), dt = tickOf(ZB, now);
      const { night } = daylight();
      backdrop(...(night ? ["#0b0f14", "#1a1f17"] : ["#3b3a2e", "#6b6a4a"]));
      if (!Z) return;
      const [b0, b1] = [Z.bounds[0], Z.bounds[1]];
      iso.slab(b0[0], b0[1], b1[0] - b0[0], b1[1] - b0[1], Math.max(4, 16 * k), night ? "#262a1e" : "#5d5a3c", null, null, "rgba(0,0,0,.3)");   // the wasteland
      const on = c => !litSet || [...litSet].some(id => byId[id] && byId[id].cluster === c);
      // settlements: dirt yard, then the far two walls (the near two go on after the people)
      const wallH = cp => Math.max(4, (8 + 46 * cp.wall) * k);
      Z.camps.forEach(cp => { const c = iso.rect(cp.cx - cp.half, cp.cy - cp.half, 2 * cp.half, 2 * cp.half);
        ctx.globalAlpha = on(cp.c) ? 1 : 0.35;
        iso.poly(c, hexMix(colorOf(cp.c), night ? "#1b1a14" : "#6e5d3f", 0.72), "rgba(0,0,0,.35)");
        iso.wall(c[0], c[1], wallH(cp), "#6b6152", "rgba(0,0,0,.4)"); iso.wall(c[3], c[0], wallH(cp), "#5a5145", "rgba(0,0,0,.4)"); });
      ctx.globalAlpha = 1;
      // everyone, back to front: survivors (topic colour), the horde (green, shambling at the wall), raiders (red, roaming)
      const people = [];
      for (const n of nodes) { if (special(n) || n.ghost || !mapShown(n)) continue;
        const kind = n.isolated ? "raider" : staleFor(n, Q.stale_days) ? "zombie" : "survivor", cp = Z.byC[n.cluster];
        let x = n.x, y = n.y;
        if (kind === "zombie" && cp && overrun(cp) && (n.age || 0) > 2 * Q.stale_days) { x = cp.cx + (n.x - cp.cx) * 0.35; y = cp.cy + (n.y - cp.cy) * 0.35; }   // inside the wall
        const add = ([dx, dy]) => { x += dx; y += dy; };
        if (kind === "zombie" && cp) { add(MOTION.lurch(n.id, now, [x, y], [cp.cx, cp.cy]));   // lurch at the wall; shot, it's knocked back
          add(MOTION.knock(ZB.hit.get(n.id), now, [x, y], [cp.cx, cp.cy])); }
        if (kind === "survivor" && cp) add(MOTION.patrol(n.id, now));
        if (kind === "raider") { add(MOTION.roam(n.id, now));   // and now and then a run at the nearest settlement
          const near = Z.camps.reduce((b, c) => (!b || Math.hypot(c.cx - n.x, c.cy - n.y) < Math.hypot(b.cx - n.x, b.cy - n.y) ? c : b), null);
          add(MOTION.sortie(n.id, now, [x, y], near && [near.cx, near.cy])); }
        people.push([n, kind, iso.p(x, y)]); }
      iso.depthSort(people, q => q[2]);
      for (const [n, kind, q] of people) {
        const lit0 = !litSet || litSet.has(n.id), s = Math.max(2, (2.5 + 3 * importance(n)) * Math.sqrt(k)), h = s * 3.2;
        ctx.globalAlpha = lit0 ? 1 : 0.25;
        const col = kind === "zombie" ? "#6b8e23" : kind === "raider" ? "#b91c1c" : colorOf(n.cluster);
        const sway = kind === "zombie" && !reducedMotion() ? Math.sin(now / 300 + hash(n.id)) * s * 0.5 : 0;
        walker(q, s, col, { pose: kind === "zombie" ? "reach" : kind === "survivor" && n.tasks > 0 ? "guard" : "walk", sway, phase: kind === "zombie" ? 0 : now / 180 + hash(n.id),
          head: kind === "zombie" ? "#a3b86c" : kind === "raider" ? "#fca5a5" : UI.colour.skin });
        if (n.tasks > 0 && kind !== "zombie") { ctx.fillStyle = UI.colour.tasks; ctx.fillRect(q.x + sway - 1, q.y - h - s * 2, 2, s); }
        if (st.selected === n.id) { ctx.strokeStyle = UI.colour.selected; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(q.x, q.y, s * 2, s, 0, 0, 2 * Math.PI); ctx.stroke(); }
        P.set(n.id, { ...iso.hit(q, s * 1.2, h), s: q.s, depth: -importance(n), a: lit0 ? 1 : 0.3 });
      }
      ctx.globalAlpha = 1;
      // watchtowers: each settlement's map
      Z.camps.forEach(cp => { const m = mocOf[cp.c]; if (!m || !byId[m.id] || !visible(byId[m.id])) return; const n = byId[m.id], q = iso.p(n.x, n.y), s = Math.max(6, 12 * Math.sqrt(k));
        const top = iso.block(q, s, s * 4, "#8b7355", "rgba(0,0,0,.4)"); ctx.fillStyle = "#fbbf24"; ctx.beginPath(); ctx.arc(top.c.x, top.c.y, Math.max(2, s * 0.25), 0, 2 * Math.PI); ctx.fill();
        P.set(n.id, { ...iso.hit(q, s, s * 4), s: q.s, depth: -2, a: 1 }); });
      // night: the towers sweep searchlights over the wasteland
      if (night && !reducedMotion()) Z.camps.forEach(cp => { const m = mocOf[cp.c]; if (!m || !byId[m.id]) return; const n = byId[m.id], q = iso.p(n.x, n.y), s = Math.max(6, 12 * Math.sqrt(k)), top = { x: q.x, y: q.y - s * 4 };
        const a = now / 2400 + (hash(cp.c + "light") % 628) / 100, len = 240 * k, spread = 0.18, g = ctx.createRadialGradient(top.x, top.y, 0, top.x, top.y, len);
        g.addColorStop(0, "rgba(254,249,195,.35)"); g.addColorStop(1, "rgba(254,249,195,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x + Math.cos(a - spread) * len, top.y + Math.sin(a - spread) * len * 0.55); ctx.lineTo(top.x + Math.cos(a + spread) * len, top.y + Math.sin(a + spread) * len * 0.55); ctx.closePath(); ctx.fill(); });
      // overrun settlements flash at the gate
      Z.camps.forEach(cp => { if (!overrun(cp)) return; const c = iso.rect(cp.cx - cp.half, cp.cy - cp.half, 2 * cp.half, 2 * cp.half), gx = (c[2].x + c[3].x) / 2, gy = (c[2].y + c[3].y) / 2;
        ctx.fillStyle = `rgba(220,38,38,${reducedMotion() ? 0.6 : 0.35 + 0.35 * Math.sin(now / 250)})`; ctx.beginPath(); ctx.arc(gx, gy, Math.max(4, 10 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); });
      // the near walls, low enough to see over
      Z.camps.forEach(cp => { const c = iso.rect(cp.cx - cp.half, cp.cy - cp.half, 2 * cp.half, 2 * cp.half), h = wallH(cp) * 0.55;
        ctx.globalAlpha = on(cp.c) ? 0.85 : 0.3; iso.wall(c[1], c[2], h, "rgba(122,111,94,.75)", "rgba(0,0,0,.4)"); iso.wall(c[2], c[3], h, "rgba(110,100,85,.75)", "rgba(0,0,0,.4)"); });
      ctx.globalAlpha = 1;
      // pushback: survivors fire on the nearest of their horde, more often where the topic is busy
      if (!reducedMotion()) {
        Z.camps.forEach(cp => { const busy = topicBusy(cp.c);
          if (!cp.horde || !chance(busy / 9, dt)) return;
          const shooter = people.find(([n, kd]) => kd === "survivor" && n.cluster === cp.c && activity(n) > 0.2), target = people.filter(([n, kd]) => kd === "zombie" && n.cluster === cp.c)[hash(String(now | 0)) % Math.max(1, cp.horde)];
          if (shooter && target) { ZB.shots.push({ a: shooter[2], b: target[2], t: 0 }); ZB.hit.set(target[0].id, now); } });
        ZB.shots = ZB.shots.filter(sh => (sh.t += dt) < 220);
        ZB.shots.forEach(sh => { ctx.strokeStyle = `rgba(253,224,71,${1 - sh.t / 220})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(sh.a.x, sh.a.y - 10 * k); ctx.lineTo(sh.b.x, sh.b.y - 8 * k); ctx.stroke(); });
      }
      // settlement names, with the horde at their gate
      Z.camps.forEach(cp => { const c = iso.rect(cp.cx - cp.half, cp.cy - cp.half, 2 * cp.half, 2 * cp.half);
        topicLabel(cp.c, `${clip(shortName(cp.c), 28).toUpperCase()}${cp.horde ? ` · 🧟 ${cp.horde}` : ""}`, (c[0].x + c[1].x) / 2, (c[0].y + c[1].y) / 2 - wallH(cp) - 22,
          Math.max(60, Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y) + 40), "#f5ead6", "#1b1a14", 10.5, { readout: true }); });
      noteLabels(nodes.filter(n => !special(n) && P.has(n.id) && !staleFor(n, Q.stale_days)).sort(byImportance).map(n => n.id), "#f5ead6", "#1b1a14", k > 1.4 ? 60 : 14);
      setSceneStat(`🧟 ${Z.camps.reduce((s, c) => s + c.horde, 0)} stale · ${Z.camps.reduce((s, c) => s + c.alive, 0)} current · ${nodes.filter(n => n.isolated && !special(n) && !n.ghost).length} raiders`);
    },
    legend: item => item("<b style='color:#6b8e23'>⚲</b>", "zombie = stale note") + item("<b style='color:#fde7c8'>⚲</b>", "survivor = current note") + item("<b style='color:#b91c1c'>⚲</b>", "raider = unlinked note")
      + item("▮", "wall height = map coverage") + item("<b style='color:#fbbf24'>▲</b>", "tower = map") + item("<b style='color:#dc2626'>●</b>", "overrun: big horde, weak map"),
    today() {
      const Z = mapCache.zombie; if (!Z) return null;
      const worst = Z.camps.slice().sort((a, b) => (overrun(b) - overrun(a)) || b.horde - a.horde)[0]; if (!worst || !worst.horde) return null;
      const ids = nodes.filter(n => n.cluster === worst.c && !special(n) && staleFor(n, Q.stale_days)).map(n => n.id);
      return { text: `${overrun(worst) ? "Overrun" : "Biggest horde"}: ${clusterName(worst.c)} · ${plural(worst.horde, "stale note")} at the walls${overrun(worst) ? `, its map lists ${Math.round(worst.wall * 100)}%` : ""}`, label: "Show them", run: () => setHighlight(new Set(ids), `${clusterName(worst.c)} · horde`) };
    },
  });
