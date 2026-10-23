  // Periodic table: each topic is a group (a column), its most relied-on notes the elements down it, period 1 first.
  // An element's number is its influence rank; its state is how alive it is (gas = active this week, liquid = current,
  // solid = stale). Select one to see its chemistry: solid bonds are links it has, dashed ones are reactions waiting
  // (the shared set: bond, fusion, transmutation; gold = a column's top element). The strip runs the strongest one.
  ICON.atom = '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>';
  const EL = { PERIODS: 7, GROUPS: 18, CW: 110, CH: 110 };
  const elSymbol = n => { const w = n.name.replace(/[^A-Za-z ]/g, " ").trim().split(/\s+/).filter(Boolean);
    return w.length > 1 ? w[0][0].toUpperCase() + w[1][0].toLowerCase() : (w[0] || "?").slice(0, 2).replace(/^./, c => c.toUpperCase()); };
  const elState = n => activity(n) > 0.35 ? "gas" : staleFor(n, Q.stale_days) ? "solid" : "liquid";
  const elReactions = () => { const T = mapCache.elements; if (!T) return [];   // worked out once per layout, so a run one stays done
    T.rx = T.rx || reactionsAmong(new Set(nodes.filter(n => !special(n) && !n.ghost && n.cluster >= 0).map(n => n.id)), mem => mem.filter(n => T.cell.has(n.id)).sort(byImportance)[0])
      .filter(x => T.cell.has(x.a.id) || T.cell.has(x.b.id));
    return T.rx.filter(x => !x.done); };
  scene("elements", {
    name: "Periodic table", icon: "atom", iso: "tilt", fps: 30,
    blurb: "Topics as element groups, notes as elements; select one to see its bonds and the reactions waiting",
    toast: "Periodic table — a column per topic, its most relied-on notes down it; gas = active, liquid = current, solid = stale. Select an element for its bonds (links) and reactions (links worth making)",
    layout(geo) {
      const pos = new Map(geo), cell = new Map(), groups = topicOrder().slice(0, EL.GROUPS);
      // the classic shape: the outer groups run the full seven periods, the middle ones start lower
      const startRow = g => (g < 2 || g >= EL.GROUPS - 6 ? 0 : 3);
      groups.forEach((c, g) => {
        const ms = topicNotes(c.id, true).sort(byImportance).slice(0, EL.PERIODS - startRow(g));
        ms.forEach((n, i) => { const x = (g - (EL.GROUPS - 1) / 2) * EL.CW, y = (startRow(g) + i - (EL.PERIODS - 1) / 2) * EL.CH; pos.set(n.id, [x, y]); cell.set(n.id, { g, p: startRow(g) + i }); });
      });
      const X = EL.GROUPS / 2 * EL.CW + 60, Y = EL.PERIODS / 2 * EL.CH + 60;
      return { pos, cell, groups: groups.map(c => c.id), bounds: [[-X, -Y - 60], [X, Y], [-X, Y], [X, -Y]] };
    },
    fit: n => mapCache.elements && mapCache.elements.cell.has(n.id),
    lit: id => { const T = mapCache.elements; if (!T || !T.cell.has(id)) return null;
      return new Set([id, ...nb[id], ...elReactions().filter(x => x.a.id === id || x.b.id === id).map(x => x.a.id === id ? x.b.id : x.a.id)]); },
    draw(now) {
      const { R, litSet, font, k } = mapFrame(), T = mapCache.elements, iso = isoKit(R, k, "tilt");
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H)); g.addColorStop(0, "#1c1f2e"); g.addColorStop(1, "#0c0d14"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (!T) return;
      const [b0, b1] = T.bounds; iso.slab(b0[0], b0[1] + 60, b1[0] - b0[0], b1[1] - b0[1] - 60, Math.max(4, 14 * k), "#232634", null, null, "rgba(148,163,184,.25)");
      // group headers along the back edge
      T.groups.forEach((c, gi) => { const q = iso.p((gi - (EL.GROUPS - 1) / 2) * EL.CW, -(EL.PERIODS + 1) / 2 * EL.CH); topicLabel(c, clip(shortName(c), 24), q.x, q.y, EL.CW * k * 1.1, colorOf(c), "#0c0d14"); });
      const sel = st.selected && T.cell.has(st.selected) ? st.selected : null;
      const tiles = [...T.cell.keys()].map(id => byId[id]).filter(n => n && mapShown(n)).map(n => [n, iso.p(n.x, n.y)]);
      iso.depthSort(tiles, t => t[1]);
      for (const [n, q] of tiles) {
        const lit0 = !litSet || litSet.has(n.id), state = elState(n), size = EL.CW * 0.78 * k / 1.2, bob = state === "gas" && !reducedMotion() ? (1 + Math.sin(now / 500 + hash(n.id) % 9)) * 4 * k : 0;
        const hgt = Math.max(3, (6 + 40 * importance(n)) * k), base = state === "solid" ? hexMix(colorOf(n.cluster), "#6b7280", 0.6) : colorOf(n.cluster);
        ctx.globalAlpha = lit0 ? 1 : 0.22;
        const lifted = { x: q.x, y: q.y - bob }, top = iso.block(lifted, size, hgt, base, state === "gas" ? "rgba(253,224,71,.9)" : "rgba(226,232,240,.45)");
        if (state === "gas") { const gl = ctx.createRadialGradient(top.c.x, top.c.y, 0, top.c.x, top.c.y, size); gl.addColorStop(0, "rgba(253,224,71,.28)"); gl.addColorStop(1, "rgba(253,224,71,0)"); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(top.c.x, top.c.y, size, 0, 2 * Math.PI); ctx.fill(); }
        if (state === "liquid") iso.poly(top.top, "rgba(147,197,253,.22)");
        // the symbol on the top face, the number in its corner
        const cx = top.c.x, cy = top.c.y, fs = Math.max(7, Math.min(22, size * 0.32));
        if (size > 14) { ctx.font = `800 ${fs}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = state === "solid" ? "#e5e7eb" : "#0b0d14"; ctx.fillText(elSymbol(n), cx, cy);
          if (size > 30) { ctx.font = `600 ${fs * 0.42}px ${font}`; ctx.fillText(String(rankOf[n.id] || "—"), cx, cy - fs * 0.85); } }
        if (n.tasks > 0) { ctx.fillStyle = UI.colour.tasks; ctx.beginPath(); ctx.arc(top.Rp.x - 6, top.c.y - top.hh * 0.5, Math.max(1.5, 3 * Math.sqrt(k)), 0, 2 * Math.PI); ctx.fill(); }
        if (sel === n.id) iso.poly(top.top, null, UI.colour.selected, 2.5);
        P.set(n.id, { ...iso.hit(lifted, top.hw, hgt), s: q.s, depth: -importance(n), a: lit0 ? 1 : 0.3 });
      }
      ctx.globalAlpha = 1;
      // chemistry of the selected element: bonds it has, reactions waiting
      if (sel && P.has(sel)) { const a = P.get(sel);
        nb[sel].forEach(id => { const b = P.get(id); if (!b) return; ctx.strokeStyle = "rgba(134,239,172,.8)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 50 * k, b.x, b.y); ctx.stroke(); });
        elReactions().filter(x => x.a.id === sel || x.b.id === sel).forEach(x => { const b = P.get(x.a.id === sel ? x.b.id : x.a.id); if (!b) return;
          ctx.strokeStyle = REACTIONS[x.type][1]; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -now / 60; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo((a.x + b.x) / 2, Math.min(a.y, b.y) - 70 * k, b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; });
      }
      noteLabels(tiles.map(t => t[0]).sort(byImportance).map(n => n.id), "#e5e7eb", "#0c0d14", k > 1.3 ? 70 : 12);
      const rx = elReactions().length; setSceneStat(`⚛ ${T.cell.size} elements · ${plural(rx, "reaction")} waiting`);
    },
    legend: item => item("<b style='color:#fde047'>◆</b>", "gas = active") + item("<b style='color:#93c5fd'>◆</b>", "liquid = current") + item("<b style='color:#9ca3af'>◆</b>", "solid = stale")
      + item("<b style='color:#86efac'>⌒</b>", "linked") + Object.values(REACTIONS).map(([nm, col]) => item(`<b style='color:${col}'>┅</b>`, nm.toLowerCase())).join("") + item("#", "number = influence rank"),
    today() {
      const all = elReactions(), rx = all.find(x => st.selected && (x.a.id === st.selected || x.b.id === st.selected)) || all[0]; if (!rx) return null;
      return { text: `${REACTIONS[rx.type][0]} waiting: ${elSymbol(rx.a)} ${rx.a.name} + ${elSymbol(rx.b)} ${rx.b.name} · ${rx.why}`, label: opts.linkNotes || rx.type === "fusion" ? "React" : "Show both",
        run: () => opts.linkNotes || rx.type === "fusion" ? runReaction(rx) : select(rx.a.id) };
    },
  });
