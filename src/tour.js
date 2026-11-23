// tour.js - a short walk over the controls, one card per control, for the graph and for Vault HQ. A step whose control isn't
// showing at this width is skipped. The build puts this with the shared rules, so both surfaces use the same one.
//   runTour(host, steps, o) -> { draw(), end(), active() }
// steps: [{ sel, title, text, ring (false: about the whole pane, no ring), before() (get the control on screen) }]
// o: find(selector) (default: in host) · cls { btn, primary, ghost, acts, muted } (the surface's own button classes) · onEnd() · clear() (elements a card must not cover, such as a banner: a card that would sit on one moves just below it)
function runTour(host, steps, o = {}) {
  const cls = o.cls || {}, find = o.find || (s => host.querySelector(s)), back = document.activeElement;
  let at = 0, box = null, drawing = false;
  const esc = VGShared.escapeHtml;
  function end() {
    if (at < 0) return; at = -1;
    if (box) box.remove(); box = null;
    if (o.onEnd) o.onEnd();
    if (back && back.isConnected && back.focus) back.focus();
  }
  // drawn again whenever the host redraws under it, which may be while a step's before() is changing the screen
  function draw() {
    if (at < 0 || drawing) return;
    drawing = true;
    try {
      let target = null;
      while (at < steps.length) { const s = steps[at]; if (s.before) s.before(); target = find(s.sel); if (target && target.offsetParent !== null) break; at++; }
      if (at >= steps.length) { end(); return; }
      if (!box) {
        box = document.createElement("div"); box.className = "vg-tour"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
        box.addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (!b) return; if (b.dataset.t === "skip") end(); else { at++; draw(); } });
        box.addEventListener("keydown", e => { e.stopPropagation();
          if (e.key === "Escape") { e.preventDefault(); end(); }
          else if (e.key === "Tab") { const f = [...box.querySelectorAll("button")], i = f.indexOf(document.activeElement); e.preventDefault(); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); } });
      }
      const step = steps[at];
      if (step.ring !== false) target.scrollIntoView({ block: "nearest" });
      const r = target.getBoundingClientRect(), R = host.getBoundingClientRect(), x = r.left - R.left, y = r.top - R.top, below = y + r.height + 170 < R.height;
      // a step about the whole pane gets no ring and a card in the middle
      const card = step.ring === false ? `left:${Math.max(10, (R.width - 290) / 2)}px;top:${Math.max(60, R.height / 2 - 80)}px` : `left:${Math.max(10, Math.min(R.width - 300, x))}px;${below ? `top:${y + r.height + 12}px` : `bottom:${R.height - y + 12}px`}`;
      const showing = x => !!(x.before || (find(x.sel) && find(x.sel).offsetParent !== null)), shown = steps.filter(showing), pos = shown.indexOf(steps[at]) + 1;   // numbered over the cards that appear
      const last = !steps.slice(at + 1).some(s => { if (s.before) return true; const e = find(s.sel); return e && e.offsetParent !== null; });
      box.setAttribute("aria-label", step.title);
      box.innerHTML = `${step.ring === false ? "" : `<div class="vg-tour-ring" style="left:${x - 4}px;top:${y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>`}
        <div class="vg-tour-card" style="${card}">
          <span class="vg-tour-count ${cls.muted || ""}">${pos} / ${shown.length}</span><b>${esc(step.title)}</b><p>${esc(step.text)}</p>
          <div class="vg-tour-acts ${cls.acts || ""}"><button class="${cls.btn || ""} ${cls.ghost || ""}" data-t="skip">Skip</button><button class="${cls.btn || ""} ${cls.primary || ""}" data-t="next">${last ? "Done" : "Next"}</button></div></div>`;
      if (!box.isConnected) host.appendChild(box);
      const cardEl = box.querySelector(".vg-tour-card");
      for (const el of (o.clear ? o.clear() : [])) {
        if (!el || el.hidden || el.offsetParent === null) continue;
        const a = el.getBoundingClientRect(), d = cardEl.getBoundingClientRect();
        if (d.right > a.left && d.left < a.right && d.bottom > a.top && d.top < a.bottom) { cardEl.style.bottom = "auto"; cardEl.style.top = `${a.bottom - R.top + 8}px`; }
      }
      box.querySelector('[data-t="next"]').focus();
    } finally { drawing = false; }
  }
  return { draw, end, active: () => at >= 0 };
}
