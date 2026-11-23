  // ---- layouts: the Today screen drawn many ways over the same list, the same rail and the same buttons.
  // Each layout is [key, name, draw]: only the arrangement differs, every row, button and rule is shared. 29-layouts-more.js adds the rest.
  const LAYOUTS = [["queue", "Queue", () => todayQueue()], ["bench", "Workbench", () => benchScreen()], ["day", "Day", () => dayScreen()]];
  let layout = opts.layout || "queue", benchLens = "today";
  const layoutNow = () => LAYOUTS.some(l => l[0] === layout) ? layout : "queue";   // a remembered choice from a newer build falls back
  const layoutSelect = () => cur !== "today" ? "" : `<label class="vg-hq-layoutlabel"><select class="vg-hq-layoutsel" data-layout aria-label="Layout" title="Layout of Today">${LAYOUTS.map(([k, name]) => `<option value="${k}"${layoutNow() === k ? " selected" : ""}>${name}</option>`).join("")}</select></label>`;
  let hqPalette = opts.palette;
  const paletteNow = () => VGShared.paletteOf(hqPalette);
  const applyPalette = () => VGShared.applyPalette(el, hqPalette);
  const paletteSelect = () => `<label class="vg-hq-layoutlabel"><select class="vg-hq-layoutsel" data-palette aria-label="Theme" title="Colour theme">${VGShared.PALETTES.map(([k, name]) => `<option value="${k}"${paletteNow() === k ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`;
  function setPalette(p) {
    if (!VGShared.PALETTES.some(x => x[0] === p) || p === paletteNow()) return;
    hqPalette = p; if (opts.onPalette) opts.onPalette(p);
    applyPalette();
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
