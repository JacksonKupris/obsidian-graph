  // Triage Run: your open tasks dealt as cards against a clock. Swipe or press an arrow: right Done, left Later, up Delegate,
  // down Cancel. These are real writes through VGActions, the same as HQ's buttons, so each has its Undo: Done on today's task
  // goes in the standup, Done on an old one doesn't (as the sweep), Delegate keeps its confirmation with the clock stopped.
  ICON.triage = '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 10l2 2 4-4"/><path d="M9 17h6"/>';
  const TRIAGE_SECONDS = 60, SWIPE = 70, FLY_MS = 180;
  const TG = { state: "title", deck: [], at: 0, left: TRIAGE_SECONDS, score: 0, combo: 0, bestCombo: 0, counts: { done: 0, later: 0, delegate: 0, cancel: 0 }, failed: 0, waiting: false, drag: null, fly: null, last: 0, chain: Promise.resolve(), newBest: false, said: "", undos: [] };
  const TRIAGE_MOVES = {
    done: { label: "Done", arrow: "→", dx: 1, dy: 0, colour: "#79c7a0" }, later: { label: "Later", arrow: "←", dx: -1, dy: 0, colour: "#8fb8d8" },
    delegate: { label: "Delegate", arrow: "↑", dx: 0, dy: -1, colour: "#f1b88a" }, cancel: { label: "Cancel", arrow: "↓", dx: 0, dy: 1, colour: "#e0796f" },
  };
  const triageKeys = { arrowright: "done", arrowleft: "later", arrowup: "delegate", arrowdown: "cancel" };
  const triageItems = () => VGRules.triageDeck(VGRules.todayList(todayData(), { review, hidden: cos.hidden, today: today(), skipDays: UI.time.skipDays, groups: ["today"] }));
  function triageStart(items) {
    TG.deck = items || triageItems(); TG.at = 0; TG.left = TRIAGE_SECONDS; TG.score = 0; TG.combo = 0; TG.bestCombo = 0; TG.failed = 0; TG.newBest = false;
    TG.counts = { done: 0, later: 0, delegate: 0, cancel: 0 }; TG.drag = null; TG.fly = null; TG.waiting = false; TG.last = 0; TG.said = ""; TG.undos = [];
    TG.state = TG.deck.length ? "play" : "title";
  }
  function triageEnd() {
    if (TG.state !== "play") return;
    TG.state = "over"; TG.drag = null;
    const was = cos.triage || {}; TG.newBest = TG.score > (was.best || 0);
    cos.triage = { best: Math.max(was.best || 0, TG.score), bestCombo: Math.max(was.bestCombo || 0, TG.bestCombo), runs: (was.runs || 0) + 1 }; persistSoon();
  }
  // Done, Later, Delegate or Cancel on one task, through the one action path. Writes run one at a time, in order.
  function triageWrite(move, it, entry) {
    // what a write reports stays in the game's own line: a toast per swipe would cover the buttons
    const c = { ...actionCtx(), done: (msg, undo) => { TG.said = msg; if (entry && undo) entry.undo = undo; }, fail: msg => { TG.said = msg; } }, more = key => VGActions.todayMore(it, c).find(m => m.key === key);
    if (move === "done") return it.kind === "carried" && c.api.setTasksStatus ? VGActions.runBatch([it], "x", c) : VGActions.runToday(it, c);
    if (move === "cancel") return c.api.setTasksStatus ? VGActions.runBatch([it], "-", c) : Promise.resolve(false);
    const m = more(move === "later" ? "later" : "delegate");
    return m ? VGActions.runMore(m, it, c) : Promise.resolve(false);
  }
  function triageSwipe(move) {
    if (TG.state !== "play" || TG.waiting || TG.fly) return;
    const it = TG.deck[TG.at]; if (!it) return;
    TG.drag = null;
    const entry = { move, points: 0, undo: null };
    const score = ok => { if (!ok) { TG.failed++; TG.combo = 0; return; }
      const points = move === "later" ? 0 : VGRules.triagePoints(it.age, TG.combo);   // putting it off keeps the run going but earns nothing
      entry.points = points; TG.score += points; TG.counts[move]++; if (move !== "later") { TG.combo++; TG.bestCombo = Math.max(TG.bestCombo, TG.combo); }
      if (entry.undo) TG.undos.push(entry); };
    const next = () => { TG.fly = { move, t: performance.now(), it }; TG.at++; if (TG.at >= TG.deck.length) setTimeout(triageEnd, FLY_MS); };
    if (move === "delegate") {   // it asks first: the clock waits, and the card stays until the answer
      TG.waiting = true;
      return (TG.chain = TG.chain.then(() => triageWrite(move, it, entry)).then(ok => { TG.waiting = false; TG.last = 0; if (ok) { score(true); next(); } }, () => { TG.waiting = false; TG.last = 0; }));
    }
    next();
    return (TG.chain = TG.chain.then(() => triageWrite(move, it, entry)).then(score, () => score(false)));
  }
  // Undo the latest write: the note goes back, and the swipe's points with it
  function triageUndo() {
    const entry = TG.undos.pop(); if (!entry) return;
    TG.score = Math.max(0, TG.score - entry.points); TG.counts[entry.move] = Math.max(0, TG.counts[entry.move] - 1); TG.combo = 0;
    TG.chain = TG.chain.then(() => entry.undo()).then(() => { TG.said = "Undone"; }, () => { TG.said = "Couldn't undo: the note changed since"; });
    return TG.chain;
  }
  function triagePointer(phase, e, x, y) {
    if (phase === "down") {
      const b = (TG.buttons || []).find(([bx, by, w, h]) => x >= bx && x <= bx + w && y >= by && y <= by + h);
      if (b) { b[4](); return true; }
      if (TG.state === "play" && !TG.waiting) { TG.drag = { x0: x, y0: y, x, y }; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* it still works inside the canvas */ } }
      return true;
    }
    if (phase === "move") { if (TG.drag) { TG.drag.x = x; TG.drag.y = y; } return TG.state === "play"; }
    if (phase === "up" || phase === "cancel") {
      const d = TG.drag; TG.drag = null; if (!d || phase === "cancel") return true;
      const dx = d.x - d.x0, dy = d.y - d.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= SWIPE) triageSwipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "done" : "later") : (dy < 0 ? "delegate" : "cancel"));
      return true;
    }
    return false;
  }
  // lines of text that fit a width; the last one ends in … when there's more
  function triageWrap(text, width, max) {
    const lines = []; let line = "", words = String(text).split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const w = words[i], tryLine = line ? `${line} ${w}` : w;
      if (ctx.measureText(tryLine).width <= width) { line = tryLine; continue; }
      if (line) lines.push(line); line = w;
      if (lines.length === max) { lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, "") + "…"; return lines; }
    }
    if (line && lines.length < max) lines.push(line);
    return lines;
  }
  function triageButton(x, y, w, h, label, run, font, primary) {
    ctx.fillStyle = primary ? "#f1b88a" : "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
    ctx.fillStyle = primary ? "#2b1a0e" : "#efe9e2"; ctx.font = `600 14px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    TG.buttons.push([x, y, w, h, run]);
  }
  function triageCard(it, cx, cy, w, h, angle, alpha, font, tint) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.fillStyle = "#211d1a"; ctx.strokeStyle = tint || "rgba(255,255,255,.14)"; ctx.lineWidth = tint ? 2 : 1;
    ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 16); ctx.fill(); ctx.stroke();
    const pad = 20, age = it.age || 0;
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = age > 14 ? "#e9a95e" : "#a79f97"; ctx.font = `600 12px ${font}`;
    ctx.fillText(it.kind === "carried" ? (age === 1 ? "1 day old" : `${age} days old`) : "From today", -w / 2 + pad, -h / 2 + pad + 8);
    ctx.fillStyle = "#f4efe9"; ctx.font = `600 ${w < 320 ? 17 : 20}px ${font}`;
    triageWrap(it.title, w - pad * 2, 5).forEach((l, i) => ctx.fillText(l, -w / 2 + pad, -h / 2 + pad + 44 + i * (w < 320 ? 23 : 27)));
    ctx.fillStyle = "#a79f97"; ctx.font = `12px ${font}`;
    const from = triageWrap(it.why || "", w - pad * 2, 1)[0] || ""; ctx.fillText(from, -w / 2 + pad, h / 2 - pad + 4);
    ctx.restore();
  }
  function triageDraw(now) {
    const { font } = mapFrame(); TG.buttons = [];
    const dt = TG.last ? Math.min(0.1, (now - TG.last) / 1000) : 0; TG.last = now;
    if (TG.state === "play" && !TG.waiting) { TG.left -= dt; if (TG.left <= 0) { TG.left = 0; triageEnd(); } }
    ctx.fillStyle = "#14110f"; ctx.fillRect(0, 0, W, H);
    const cx = W / 2, narrow = W < 520; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    if (TG.state === "title" || TG.state === "over") {
      const best = (cos.triage || {}).best || 0, n = TG.state === "over" ? 0 : triageItems().length;
      ctx.fillStyle = "#f4efe9"; ctx.font = `700 ${narrow ? 30 : 40}px ${font}`; ctx.fillText(TG.state === "over" ? `${TG.score} points` : "Triage Run", cx, H * 0.27);
      ctx.font = `15px ${font}`; ctx.fillStyle = "#c9c1b8";
      const lines = TG.state === "over"
        ? [`Done ${TG.counts.done} · Later ${TG.counts.later} · Delegated ${TG.counts.delegate} · Cancelled ${TG.counts.cancel}`, `Best streak ${TG.bestCombo}${TG.newBest ? " · New best" : best ? ` · Best ${best}` : ""}`, ...(TG.failed ? [`${TG.failed} couldn't be written: the task changed since`] : [])]
        : n ? [`${plural(n, "open task")}, oldest first. ${TRIAGE_SECONDS} seconds.`, "Older tasks score more. Each swipe changes the real task.", ...(best ? [`Best ${best}`] : [])]
          : ["No open tasks to triage."];
      let textY = H * 0.27 + 36;
      lines.forEach(l => triageWrap(l, W - 40, 2).forEach(t => { ctx.fillText(t, cx, textY); textY += 22; }));
      if (TG.state === "title" && n) { ctx.font = `13px ${font}`; Object.values(TRIAGE_MOVES).forEach((m, i) => { const step = Math.min(90, (W - 24) / 4); ctx.fillStyle = m.colour; ctx.fillText(`${m.arrow} ${m.label}`, cx + (i - 1.5) * step, textY + 10); }); textY += 28; }
      const y = textY + 12, bw = narrow ? Math.min(170, (W - 44) / 2) : 170;
      if (TG.state === "over") { const again = triageItems().length; if (again) triageButton(cx - bw - 6, y, bw, 44, "Run again", () => triageStart(), font, true); triageButton(again ? cx + 6 : cx - bw / 2, y, bw, 44, "Back to the graph", () => setView("2d"), font, !again);
        if (TG.undos.length) triageButton(cx - bw / 2, y + 54, bw, 44, `Undo the last (${TG.undos.length})`, triageUndo, font); }
      else if (n) triageButton(cx - bw / 2, y, bw, 42, "Start", () => triageStart(), font, true);
      else triageButton(cx - bw / 2, y, bw, 42, "Back to the graph", () => setView("2d"), font, true);
      return;
    }
    // the deck, and the card under the finger; the scene's toolbar covers the top 60 or so pixels
    const cw = Math.min(460, W - 40), ch = Math.max(170, Math.min(280, H - 290)), cy = Math.max(112 + ch / 2, H * 0.46), it = TG.deck[TG.at], under = TG.deck[TG.at + 1], d = TG.drag;
    // time, score and streak, right above the card
    const hudY = cy - ch / 2 - 16, hudL = cx - cw / 2, hudR = cx + cw / 2;
    ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(0, 0, W, 4); ctx.fillStyle = TG.left < 10 ? "#e0796f" : "#f1b88a"; ctx.fillRect(0, 0, W * TG.left / TRIAGE_SECONDS, 4);
    ctx.font = `700 22px ${font}`; ctx.fillStyle = "#f4efe9"; ctx.textAlign = "left"; ctx.fillText(String(TG.score), hudL, hudY);
    ctx.textAlign = "center"; if (TG.waiting) { ctx.font = `600 14px ${font}`; ctx.fillStyle = "#f1b88a"; ctx.fillText("Clock stopped", cx, hudY); } else { ctx.fillStyle = TG.left < 10 ? "#e0796f" : "#f4efe9"; ctx.fillText(String(Math.ceil(TG.left)), cx, hudY); }
    ctx.textAlign = "right"; ctx.font = `600 14px ${font}`; ctx.fillStyle = TG.combo > 1 ? "#f1b88a" : "#a79f97"; ctx.fillText(TG.combo > 1 ? `×${(1 + Math.min(TG.combo, 16) * 0.25).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}` : `${Math.min(TG.at + 1, TG.deck.length)} of ${TG.deck.length}`, hudR, hudY);
    if (under) triageCard(under, cx, cy + 8, cw - 12, ch, 0, 0.55, font);
    const off = d ? [d.x - d.x0, d.y - d.y0] : [0, 0], lean = Math.max(Math.abs(off[0]), Math.abs(off[1]));
    const going = lean >= 24 ? (Math.abs(off[0]) > Math.abs(off[1]) ? (off[0] > 0 ? "done" : "later") : (off[1] < 0 ? "delegate" : "cancel")) : null, sure = lean >= SWIPE;
    const tint = going ? TRIAGE_MOVES[going].colour : null;
    if (it) triageCard(it, cx + off[0], cy + off[1], cw, ch, off[0] / 900, 1, font, tint);
    if (TG.fly) { const p = (now - TG.fly.t) / FLY_MS, m = TRIAGE_MOVES[TG.fly.move];
      if (p >= 1 || reducedMotion()) TG.fly = null; else triageCard(TG.fly.it, cx + m.dx * p * W * 0.7, cy + m.dy * p * H * 0.7, cw, ch, m.dx * p * 0.25, 1 - p, font, m.colour); }
    if (going) { const m = TRIAGE_MOVES[going]; ctx.font = `700 ${sure ? 26 : 20}px ${font}`; ctx.fillStyle = m.colour; ctx.textAlign = "center"; ctx.fillText(m.label, cx + off[0], cy + off[1] + ch / 2 - 44); }
    // the four moves, always showing: a tap does the same as a swipe, and they work without a keyboard or a steady hand
    const moves = Object.entries(TRIAGE_MOVES), gap = 8, bw = Math.min(120, (W - 24 - gap * 3) / 4), total = bw * 4 + gap * 3, by = Math.min(H - 56, cy + ch / 2 + 22);
    moves.forEach(([key, m], i) => { const x = cx - total / 2 + i * (bw + gap);
      ctx.fillStyle = going === key ? m.colour : "rgba(255,255,255,.08)"; ctx.beginPath(); ctx.roundRect(x, by, bw, 44, 10); ctx.fill();
      ctx.fillStyle = going === key ? "#14110f" : m.colour; ctx.font = `600 ${narrow ? 12 : 14}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(`${m.arrow} ${m.label}`, x + bw / 2, by + 23); ctx.textBaseline = "alphabetic";
      TG.buttons.push([x, by, bw, 44, () => triageSwipe(key)]); });
    // what the last write did, and its Undo
    const lineY = by + 56, undoW = 78, hasUndo = TG.undos.length > 0;
    ctx.font = `13px ${font}`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = "#c9c1b8";
    ctx.fillText(triageWrap(TG.said, total - (hasUndo ? undoW + 10 : 0), 1)[0] || "", cx - total / 2, lineY + 22);
    ctx.textBaseline = "alphabetic";
    if (hasUndo) triageButton(cx + total / 2 - undoW, lineY, undoW, 44, "Undo", triageUndo, font);
  }
  scene("triage", {
    name: "Triage Run", icon: "triage", fps: 60, game: true,
    menu: "play", hint: "Your open tasks as cards against the clock: swipe Done, Later, Delegate or Cancel",
    toast: "",   // its title screen says it, and a toast here sits on the buttons
    layout() { const pos = new Map(), span = 800; nodes.forEach(n => { const [u, v] = scatter("tr:" + n.id); pos.set(n.id, [u * span, v * span]); }); if (TG.state !== "play") TG.state = "title"; return { pos, bounds: [[0, 0], [span, 0], [span, span], [0, span]] }; },
    fit: n => !n.ghost,
    keys: { test: k => (TG.state === "play" ? k in triageKeys : k === "enter" || k === " ") },
    key(k, down) { if (!down) return; if (TG.state === "play" && triageKeys[k]) triageSwipe(triageKeys[k]); else if (TG.state !== "play" && (k === "enter" || k === " ") && triageItems().length) triageStart(); },
    pointer: triagePointer,
    escape() { if (TG.state === "play") { triageEnd(); return true; } return false; },
    release() { TG.drag = null; },
    state: TG,   // for tests/test_triage.js
    api: { start: triageStart, swipe: triageSwipe, undo: triageUndo, end: triageEnd, moves: () => Object.keys(TRIAGE_MOVES) },
    draw: triageDraw,
  });
