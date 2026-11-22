#!/usr/bin/env node
// Random walk ("monkey"): opens views, clicks things, presses keys, at desktop and phone size. After every step nothing may have thrown,
// nothing may run off the page sideways, and a few Escapes must always close whatever is open (no stuck dialog, no lost way back).
// A failure prints the seed and the steps, so it can be replayed and pinned as its own plain test.
//   node tests/test_monkey.js [--seed N] [--steps N] [--mobile]     hunting: node tests/test_monkey.js --seed 77 --steps 300
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const STEPS = Number(arg("--steps", 40)), SEEDS = arg("--seed", "") ? [Number(arg("--seed"))] : [1, 2];
const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;   // small seeded generator: the same seed, the same walk

async function walk(seed, mobile) {
  const tab = await openPage({ html: env.pageWith("", env.data()), mobile }), ev = e => tab.ev(e), rand = rng(seed), steps = [];
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`window.__errs = []; addEventListener("error", e => __errs.push(e.message)); addEventListener("unhandledrejection", e => __errs.push(String(e.reason && e.reason.message || e.reason)));
      document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    const keys = await ev(`window.vaultGraph._debug.allViews().map(v => v.key)`);
    const pick = a => a[Math.floor(rand() * a.length)];
    for (let i = 0; i < STEPS; i++) {
      const r = rand(); let what;
      if (r < 0.3) { what = "open " + pick(keys); await ev(`window.vaultGraph._debug.openView(${JSON.stringify(what.slice(5))})`); }
      else if (r < 0.45) { what = "Escape"; await ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); }
      else if (r < 0.55) { what = "key " + (what = pick(["/", "?", "f", "t", "j", "k", "Tab", "Enter"])); await ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(what.slice(4))}, bubbles: true }))`); }
      else {   // press something that is on screen, but never a link that leaves the page
        const n = await ev(`(() => { const bs = [...document.querySelectorAll(".vg-root button:not([disabled]), .vg-root [role=button]")].filter(b => { const x = b.getBoundingClientRect(); return x.width > 0 && x.height > 0 && !b.closest("[hidden]") && !/vg-confirm-acts/.test(b.parentElement.className) && b.dataset.c !== "yes"; }); window.__bs = bs; return bs.length; })()`);
        const j = Math.floor(rand() * Math.max(n, 1)); what = "press #" + j + " of " + n;
        what += " " + await ev(`(() => { const b = window.__bs[${j}]; if (!b) return "-"; const t = (b.getAttribute("aria-label") || b.textContent || b.className).trim().slice(0, 30); b.click(); return JSON.stringify(t); })()`);
      }
      steps.push(what); await sleep(120);
      const errs = await ev(`window.__errs.splice(0)`);
      if (errs.length) return { bad: "threw: " + errs[0], steps };
      const measure = () => ev(`(() => { const r = document.querySelector(".vg-root"), w = r.clientWidth + 2; const o = [...r.querySelectorAll("*")].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > r.getBoundingClientRect().left + w && !e.closest("svg, canvas, [hidden], .vg-mx-wrap, .vg-tl-scroll") && getComputedStyle(e).position !== "fixed"; }).slice(0, 3).map(e => e.className.toString().slice(0, 30)); return r.scrollWidth - r.clientWidth > 2 ? r.scrollWidth - r.clientWidth + " px: " + o.join(", ") : ""; })()`);
      let wide = await measure(); if (wide) { await sleep(500); wide = await measure(); }   // a panel sliding in is not overflow
      if (wide) return { bad: "the page runs off to the side by " + wide, steps };
    }
    for (let i = 0; i < 8; i++) await ev(`document.querySelector(".vg-root").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`), await sleep(80);
    const open = await ev(`[...document.querySelectorAll(".vg-confirm, .vg-palette:not([hidden]), .vg-sheet-open")].map(x => x.className)`);
    if (open.length) return { bad: "eight Escapes left open: " + open.join(", "), steps };
    return { steps };
  } catch (e) { return { bad: "crashed: " + e.message, steps }; } finally { await tab.close(); }
}

(async () => {
  for (const mobile of process.argv.includes("--mobile") ? [true] : [false, true]) for (const seed of SEEDS) {
    const r = await walk(seed, mobile);
    check(!r.bad, `seed ${seed}${mobile ? " (phone)" : ""}: ${r.bad}\n    steps: ${(r.steps || []).slice(-12).join(" | ")}`);
  }
  finish(fails, "Random walks over every view end without errors, sideways overflow or a stuck dialog");
})();
