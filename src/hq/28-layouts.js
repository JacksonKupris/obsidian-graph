  // ---- layouts: the Today screen drawn many ways over the same list, the same rail and the same buttons.
  // Each layout is [key, name, draw]: only the arrangement differs, every row, button and rule is shared. 29-layouts-more.js adds the rest.
  const LAYOUTS = [["queue", "Queue", () => todayQueue()], ["bench", "Workbench", () => benchScreen()], ["day", "Day", () => dayScreen()]];
  let layout = opts.layout || "queue", benchLens = "today";
  const layoutNow = () => LAYOUTS.some(l => l[0] === layout) ? layout : "queue";   // a remembered choice from a newer build falls back
  const layoutSelect = () => cur !== "today" ? "" : `<label class="vg-hq-layoutlabel"><select class="vg-hq-layoutsel" data-layout aria-label="Layout" title="Layout of Today">${LAYOUTS.map(([k, name]) => `<option value="${k}"${layoutNow() === k ? " selected" : ""}>${name}</option>`).join("")}</select></label>`;
  let hqPalette = opts.palette;
  const paletteNow = () => VGShared.paletteOf(hqPalette);
  const applyPalette = () => VGShared.applyPalette(el, hqPalette);
  const paletteSelect = () => `<label class="vg-hq-layoutlabel"><select class="vg-hq-layoutsel" data-palette aria-label="Theme" title="Colour theme">${VGShared.PALETTES.map(([k, name]) => `<option value="${k}"${VGShared.paletteIs(paletteNow(), k) ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label><button class="vg-hq-btn vg-hq-btn-sm" data-editcolors>Edit colours</button>`;
  function setPalette(p) {
    if (!VGShared.PALETTES.some(x => x[0] === p) && !VGShared.customOf(p)) return;
    p = VGShared.paletteChoice(paletteNow(), p); if (p === paletteNow()) return;
    hqPalette = p; if (opts.onPalette) opts.onPalette(p);
    applyPalette();
  }
  // the colour editor: four pickers, each readable pairing listed live (the rule is VGShared.customChecks), a live preview on the page,
  // Save only while every pairing passes, Reset puts the defaults back in the pickers, Escape or Cancel puts the saved colours back
  function openColourEditor() {
    if (el.querySelector(".vg-hq-colours")) return;
    const was = paletteNow(); let baseHue = null, cols = VGShared.customOf(was) || VGShared.liveColours(el) || VGShared.CUSTOM_DEFAULT.slice();
    const box = document.createElement("div"); box.className = "vg-hq-dialog vg-hq-colours"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Edit colours");
    box.innerHTML = `<div class="vg-hq-dialog-card"><b>Edit colours</b><p>Page, panel, text and accent set the look. Good, warning, error and link carry meaning. Every other colour follows from these.</p>
      <label class="vg-hq-colourbase">Start from a colour<input type="color" data-colour-base value="${cols[3]}"></label>
      <div class="vg-hq-colourgrid">${VGShared.CUSTOM_NAMES.map((n, i) => `<label>${n}<input type="color" data-colour="${i}" value="${cols[i]}"></label>`).join("")}</div>
      <ul class="vg-hq-colourchecks" aria-live="polite"></ul>
      <div class="vg-hq-row-end"><button class="vg-hq-btn" data-colour-suggest>Suggest colours</button><button class="vg-hq-btn" data-colour-reset>Reset to default</button><button class="vg-hq-btn" data-colour-cancel>Cancel</button><button class="vg-hq-btn vg-hq-btn-primary" data-colour-save>Save</button></div></div>`;
    const list = box.querySelector(".vg-hq-colourchecks"), save = box.querySelector("[data-colour-save]");
    const preview = () => { VGShared.applyPalette(el, VGShared.customKey(cols)); const rows = VGShared.customChecks(cols);
      list.innerHTML = rows.map(c => `<li class="${c.ok ? "is-ok" : "is-bad"}"><b>${c.ok ? "✓" : "✗"}</b> ${esc(c.what)} <span>${c.ratio.toFixed(1)}:1</span></li>`).join("") + (rows.every(c => c.ok) ? "" : "<li class=\"is-note\">Needs 4.5:1 or more to be easy to read. Change the colours until every line has a tick.</li>");
      save.disabled = !rows.every(c => c.ok); };
    const close = openDialog(box, box.querySelector("input")), shut = () => { close(); };
    const restore = () => { VGShared.applyPalette(el, was); shut(); };
    const fill = () => box.querySelectorAll("[data-colour]").forEach((x, i) => { x.value = cols[i]; });
    const isDark = () => VGShared.contrast(cols[0], "#ffffff") > VGShared.contrast(cols[0], "#000000");
    box.addEventListener("input", e => { if (e.target.dataset && e.target.dataset.colourBase != null) { baseHue = VGShared.hueOfHex(e.target.value); cols = VGShared.suggestPalette(Math.floor(Math.random() * 4294967296), isDark(), baseHue); fill(); preview(); return; }
      const i = e.target.dataset && e.target.dataset.colour; if (i == null) return; cols = cols.map((c, j) => j === +i ? e.target.value.toLowerCase() : c); preview(); });
    // each press is a new set, dark or light to match the page the person has now
    box.querySelector("[data-colour-suggest]").onclick = () => { cols = VGShared.suggestPalette(Math.floor(Math.random() * 4294967296), isDark(), baseHue === null ? undefined : baseHue); fill(); preview(); };
    box.querySelector("[data-colour-reset]").onclick = () => { cols = VGShared.CUSTOM_DEFAULT.slice(); box.querySelectorAll("[data-colour]").forEach((x, i) => { x.value = cols[i]; }); preview(); };
    box.querySelector("[data-colour-cancel]").onclick = restore;
    save.onclick = () => { if (save.disabled) return; const next = VGShared.customKey(cols); shut(); if (next === paletteNow()) { applyPalette(); return; } hqPalette = next; if (opts.onPalette) opts.onPalette(next); render(); };
    box.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") restore(); });
    preview();
  }
  function setLayout(l) {
    if (!LAYOUTS.some(x => x[0] === l) || l === layoutNow()) return;
    layout = l; if (opts.onLayout) opts.onLayout(l);
    if (cur !== "today") setScreen("today"); else render();
  }
  function todayScreen() { return LAYOUTS.find(l => l[0] === layoutNow())[2](); }

  // ---- Workbench: one list, many lenses. Today, Needs you and each project are filters of the one list.
  function benchLenses() {
    const th = threads().filter(t => t.project && t.items.length);
    return [["today", "Today", ofGroup("today")], ["needs", "Needs you", ofGroup("needs")], ...th.map(t => ["p:" + t.project.path, t.project.title, t.items])];
  }
  function benchScreen() {
    const lenses = benchLenses(), at = lenses.find(l => l[0] === benchLens) || lenses[0], items = at[2];
    const nav = lenses.map(([k, name, xs]) => `<button class="vg-hq-lensbtn${k === at[0] ? " is-on" : ""}" data-benchlens="${esc(k)}" aria-pressed="${k === at[0]}">${esc(name)}<span>${xs.length}</span></button>`).join("");
    return `<h1 class="vg-hq-h1">${esc(at[1])}</h1>${captureBox()}<div class="vg-hq-bench"><nav class="vg-hq-lenses" aria-label="Lists">${nav}</nav><div class="vg-hq-benchlist">${items.length ? items.map(row).join("") : empty(`Nothing in ${at[1]}.`, [["Today", 'data-benchlens="today"']])}</div></div>`;
  }
  function pickLens(k) { benchLens = k; selKey = null; render(); }

  // ---- Day: the loop down one spine, and where you are in it is the screen
  function dayScreen() {
    const needs = ofGroup("needs").sort((a, b) => (b.age || 0) - (a.age || 0)), plan = focus(), next = doNext(), done = VGRules.doneToday(DATA, STATE.review, day());
    const brief = `<p>${needs.length ? `${plural(needs.length, "thing")} need${needs.length === 1 ? "s" : ""} a decision from you. The oldest has waited ${plural(needs[0].age || 0, "day")}: ${esc(needs[0].title)}.` : "Nothing is waiting on a decision from you."}</p><p>${plural(ofGroup("today").length, "item")} open today, ${done.length} done so far.</p>`;
    const phase = (n, name, sub, body, state) => `<section class="vg-hq-phase is-${state}"><span class="vg-hq-node" aria-hidden="true">${n}</span><h2>${name}<small>${sub}</small></h2>${body}</section>`;
    const wrap = done.length ? `<ul class="vg-hq-wraplist">${done.slice(0, 12).map(d => `<li>${esc(d.text)}</li>`).join("")}</ul><div class="vg-hq-row"><button class="vg-hq-btn" data-go="wrap">Wrap up</button></div>` : `<p class="vg-hq-lede">Finished items collect here. Next: finish one above.</p>`;
    return `<h1 class="vg-hq-h1">Today</h1>${captureBox()}<div class="vg-hq-spine">${phase("1", "Morning", "what the vault noticed", `<div class="vg-hq-brief">${brief}</div>`, "past")}${phase("2", "Plan", plural(plan.length, "item") + " in focus", plan.length ? plan.map(row).join("") : `<p class="vg-hq-lede">Nothing starred yet. Star an item to plan it.</p>`, plan.length ? "now" : "past")}${phase("3", "Do", "one at a time", nextBig(next) || `<p class="vg-hq-lede">Nothing left to do.</p>`, next ? "now" : "past")}${phase("4", "Wrap up", plural(done.length, "item") + " done", wrap, done.length ? "now" : "locked")}</div>`;
  }
