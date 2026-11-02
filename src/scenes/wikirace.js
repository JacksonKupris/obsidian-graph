  // Wikirace: today's route from one note to another, following links only. Fewest hops wins. A hub gets you there but costs
  // points, and a broken link is a trap: it goes nowhere and costs more. Everyone gets the same route today (VGRules.wikiraceRoute).
  // It only reads the vault: nothing here touches a note.
  ICON.wikirace = '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-4a3 3 0 0 0-3 3v0a3 3 0 0 0 3 3h5.5"/>';
  const WR = { state: "title", route: null, day: "", at: null, path: [], hops: 0, hubs: 0, traps: 0, seconds: 0, startedAt: 0, trapped: "", scroll: 0, buttons: [], score: 0, newBest: false, near: null, wheelAt: 0 };
  const wrName = id => (byId[id] ? byId[id].name : nameOfGhost(id));
  const nameOfGhost = id => { const g = ghosts.find(x => x.id === id); return g ? g.name : String(id); };
  const wrHub = id => !!(byId[id] && (byId[id].moc || VGRules.isHub(id, byId[id].tags)));
  // the map of links as a player sees it: what's linked from here, hubs included, and any broken links in the note
  function wrNear() {
    if (WR.near) return WR.near;
    const near = new Map(), add = (a, b) => { if (!near.has(a)) near.set(a, new Set()); near.get(a).add(b); };
    links.filter(l => l.kind === "link").forEach(l => { const a = l.s.id, b = l.t.id; if (a !== b && !l.s.ghost && !l.t.ghost) { add(a, b); add(b, a); } });
    return (WR.near = near);
  }
  function wrRoute() {
    const avoid = new Set(nodes.filter(n => n.ghost || n.person || wrHub(n.id)).map(n => n.id));
    return VGRules.wikiraceRoute(links.filter(l => l.kind === "link").map(l => [l.s.id, l.t.id]), today(), { avoid });
  }
  function wrStart(route) {
    const r = route || wrRoute(); if (!r) return;
    Object.assign(WR, { route: r, day: r.day, at: r.from, path: [r.from], hops: 0, hubs: 0, traps: 0, seconds: 0, startedAt: performance.now(), trapped: "", scroll: 0, state: "play", score: 0, newBest: false });
  }
  // where you can go from here, broken links last so a list reads the same way each time
  function wrOptions() {
    const here = [...(wrNear().get(WR.at) || [])].map(id => ({ id, name: wrName(id), hub: wrHub(id), trap: false })).sort((a, b) => (a.name < b.name ? -1 : 1));
    const broken = ghosts.filter(g => (g.from || []).includes(WR.at)).map(g => ({ id: g.id, name: g.name, hub: false, trap: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    return [...here, ...broken];
  }
  function wrGo(option) {
    if (WR.state !== "play") return;
    if (option.trap) { WR.traps++; WR.trapped = `${option.name} doesn't exist: a broken link. −75`; return; }
    WR.trapped = ""; WR.hops++; if (option.hub) WR.hubs++;
    WR.at = option.id; WR.path.push(option.id); WR.scroll = 0;
    if (option.id === WR.route.to) wrWin();
  }
  function wrBack() { if (WR.state !== "play" || WR.path.length < 2) return; WR.path.pop(); WR.at = WR.path[WR.path.length - 1]; WR.hops++; WR.trapped = ""; WR.scroll = 0; }   // going back is a hop too
  function wrWin() {
    WR.seconds = (performance.now() - WR.startedAt) / 1000; WR.score = VGRules.wikiraceScore({ hops: WR.hops, par: WR.route.par, hubs: WR.hubs, traps: WR.traps, seconds: WR.seconds }); WR.state = "over";
    const was = cos.wikirace || {}, day = WR.day, yesterday = VGRules.localDay(new Date(Date.parse(day + "T12:00:00") - 864e5));
    WR.newBest = WR.score > (was.day === day ? was.today || 0 : 0);
    const streak = was.day === day ? was.streak || 1 : was.day === yesterday ? (was.streak || 0) + 1 : 1;
    cos.wikirace = { day, today: Math.max(was.day === day ? was.today || 0 : 0, WR.score), best: Math.max(was.best || 0, WR.score), streak }; persistSoon();
  }
  function wrButton(x, y, w, h, label, run, font, primary) {
    ctx.fillStyle = primary ? "#f1b88a" : "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
    ctx.fillStyle = primary ? "#2b1a0e" : "#efe9e2"; ctx.font = `600 14px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + w / 2, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
    WR.buttons.push([x, y, w, h, run]);
  }
  const wrFit = (text, width) => { let t = String(text); if (ctx.measureText(t).width <= width) return t; while (t.length > 1 && ctx.measureText(t + "…").width > width) t = t.slice(0, -1); return t + "…"; };
  function wrDraw() {
    const { font } = mapFrame(); WR.buttons = [];
    ctx.fillStyle = "#14110f"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, narrow = W < 520, col = Math.min(620, W - 32), left = cx - col / 2;
    if (WR.state !== "play") {
      const r = wrRoute(), was = cos.wikirace || {}, played = was.day === today(); ctx.textAlign = "center";
      ctx.fillStyle = "#f4efe9"; ctx.font = `700 ${narrow ? 30 : 40}px ${font}`; ctx.fillText(WR.state === "over" ? `${WR.score} points` : "Wikirace", cx, H * 0.24);
      ctx.font = `15px ${font}`; ctx.fillStyle = "#c9c1b8"; let y = H * 0.24 + 36;
      const lines = WR.state === "over"
        ? [`${WR.hops} hops, par ${WR.route.par} · ${Math.floor(WR.seconds)} seconds`, `Hubs ${WR.hubs} · Broken links ${WR.traps}`, `${was.streak || 1}-day streak${WR.newBest ? " · Today's best" : ""}`]
        : r ? [wrName(r.from), "to", wrName(r.to), `Par ${r.par} hops. Links only. Hubs cost points, and broken links are traps.`, ...(played ? [`Today's best ${was.today}`] : [])]
          : ["No route today. It takes notes linked at least three hops apart."];
      lines.forEach(l => { ctx.fillText(wrFit(l, W - 32), cx, y); y += 22; });
      const bw = narrow ? Math.min(170, (W - 44) / 2) : 170; y += 12;
      if (r) wrButton(WR.state === "over" ? cx - bw - 6 : cx - bw / 2, y, bw, 44, WR.state === "over" ? "Race again" : "Start", () => wrStart(), font, true);
      if (WR.state === "over" || !r) wrButton(r ? cx + 6 : cx - bw / 2, y, bw, 44, "Back to the graph", () => setView("2d"), font, !r);
      if (WR.state === "over" && opts.openNote) wrButton(cx - bw / 2, y + 54, bw, 44, "Open the last note", () => opts.openNote(WR.route.to), font);
      return;
    }
    // where you are, where you're going
    const top = 66; ctx.textAlign = "left";
    ctx.fillStyle = "#a79f97"; ctx.font = `12px ${font}`; ctx.fillText(`Hop ${WR.hops} · par ${WR.route.par}`, left, top + 10);
    ctx.textAlign = "right"; ctx.fillStyle = "#f1b88a"; ctx.fillText(wrFit(`To: ${wrName(WR.route.to)}`, col * 0.7), left + col, top + 10);
    ctx.textAlign = "left"; ctx.fillStyle = "#f4efe9"; ctx.font = `700 ${narrow ? 20 : 24}px ${font}`; ctx.fillText(wrFit(wrName(WR.at), col), left, top + 40);
    ctx.font = `13px ${font}`; ctx.fillStyle = WR.trapped ? "#e0796f" : "#a79f97"; ctx.fillText(wrFit(WR.trapped || "Links from here", col), left, top + 62);
    // the links, as rows big enough to tap; the wheel or a drag scrolls them
    const options = wrOptions(), rowH = 44, listTop = top + 74, footer = 60, visible = Math.max(1, Math.floor((H - listTop - footer) / rowH));
    WR.scroll = Math.max(0, Math.min(WR.scroll, Math.max(0, options.length - visible)));
    options.slice(WR.scroll, WR.scroll + visible).forEach((o, i) => { const y = listTop + i * rowH;
      ctx.fillStyle = "rgba(255,255,255,.05)"; ctx.beginPath(); ctx.roundRect(left, y, col, rowH - 4, 8); ctx.fill();
      ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = `14px ${font}`; ctx.fillStyle = "#efe9e2"; ctx.fillText(wrFit(o.name, col - (o.hub ? 96 : 24)), left + 12, y + rowH / 2 - 1);
      if (o.hub) { ctx.textAlign = "right"; ctx.font = `12px ${font}`; ctx.fillStyle = "#e9a95e"; ctx.fillText("Hub −50", left + col - 12, y + rowH / 2 - 1); } ctx.textBaseline = "alphabetic";
      WR.buttons.push([left, y, col, rowH - 4, () => wrGo(o)]); });
    if (!options.length) { ctx.textAlign = "left"; ctx.font = `14px ${font}`; ctx.fillStyle = "#c9c1b8"; ctx.fillText("No links from this note. Go back.", left, listTop + 20); }
    const by = H - footer + 8, more = options.length > visible;
    if (WR.path.length > 1) wrButton(left, by, 92, 44, "Back", wrBack, font);
    if (more) { ctx.textAlign = "center"; ctx.font = `12px ${font}`; ctx.fillStyle = "#a79f97"; ctx.fillText(`${WR.scroll + 1}–${Math.min(options.length, WR.scroll + visible)} of ${options.length}`, cx, by + 26);
      wrButton(left + col - 96, by, 44, 44, "↑", () => { WR.scroll = Math.max(0, WR.scroll - visible); }, font); wrButton(left + col - 44, by, 44, 44, "↓", () => { WR.scroll += visible; }, font); }
  }
  scene("wikirace", {
    name: "Wikirace", icon: "wikirace", fps: 30, game: true,
    blurb: "Today's route from note to note, by links only: broken links are traps, hubs cost points",
    toast: "",
    layout() { const pos = new Map(), span = 800; WR.near = null; nodes.forEach(n => { const [u, v] = scatter("wr:" + n.id); pos.set(n.id, [u * span, v * span]); }); if (WR.state === "over") WR.state = "title"; return { pos, bounds: [[0, 0], [span, 0], [span, span], [0, span]] }; },
    fit: n => !n.ghost,
    keys: { test: k => (WR.state === "play" ? k === "backspace" || k === "pageup" || k === "pagedown" || /^[1-9]$/.test(k) : k === "enter" || k === " ") },
    key(k, down) { if (!down) return;
      if (WR.state !== "play") { if ((k === "enter" || k === " ") && wrRoute()) wrStart(); return; }
      if (k === "backspace") wrBack(); else if (k === "pagedown") WR.scroll += 5; else if (k === "pageup") WR.scroll = Math.max(0, WR.scroll - 5);
      else if (/^[1-9]$/.test(k)) { const o = wrOptions().slice(WR.scroll)[+k - 1]; if (o) wrGo(o); } },
    pointer(phase, e, x, y) {
      if (phase !== "down") return WR.state === "play";
      const b = WR.buttons.find(([bx, by, w, h]) => x >= bx && x <= bx + w && y >= by && y <= by + h); if (b) b[4]();
      return true;
    },
    wheel(e) { if (WR.state === "play") WR.scroll = Math.max(0, WR.scroll + (e && e.deltaY < 0 ? -1 : 1)); },
    escape() { if (WR.state === "play") { WR.state = "title"; return true; } return false; },
    state: WR,   // for tests/test_play.js
    api: { start: wrStart, route: wrRoute, options: wrOptions, go: wrGo, back: wrBack, near: wrNear, hub: wrHub },
    draw: wrDraw,
  });
