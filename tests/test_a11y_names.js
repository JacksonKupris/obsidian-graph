#!/usr/bin/env node
// Every control and dialog has a name a screen reader can say, and the graph can be reached by keyboard (persona pass 2026-11-21:
// two selects, the tour and the shortcut sheet had no label; the canvas was not focusable).
//   node tests/test_a11y_names.js        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
const NAMED = `(el) => !!((el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || el.textContent || "").trim() || (el.labels && el.labels.length) || (el.closest("label") && el.closest("label").textContent.trim()))`;
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await sleep(2500); await tab.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    const unnamed = await tab.ev(`[...document.querySelectorAll(".vg-root select, .vg-root input, .vg-root button")].filter(e => !e.hidden && e.offsetParent !== null).filter(e => !(${NAMED})(e)).map(e => e.className || e.tagName)`);
    check(unnamed.length === 0, "controls with no name: " + unnamed.slice(0, 8).join(", "));
    const cv = await tab.ev(`(() => { const c = document.querySelector(".vg-root canvas"); return c ? { tab: c.tabIndex, name: c.getAttribute("aria-label") || (c.getAttribute("aria-labelledby") && (document.getElementById(c.getAttribute("aria-labelledby")) || {}).textContent) || "", role: c.getAttribute("role") || "" } : null; })()`);
    check(!!cv, "the graph canvas exists");
    if (cv) check(cv.tab >= 0 && cv.name && cv.role, "the canvas needs tabindex, role and a label: " + JSON.stringify(cv));
    await tab.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }))`); await sleep(300);
    const dlg = await tab.ev(`[...document.querySelectorAll(".vg-root [role=dialog], .vg-root .vg-tour, .vg-root .vg-keys")].filter(e => !e.hidden && e.offsetParent !== null).map(e => ({ role: e.getAttribute("role"), name: e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") }))`);
    check(dlg.length > 0, "the shortcut sheet opens on ? (the test can't fail without it)");
    check(dlg.every(x => x.role === "dialog" && x.name), "every dialog has role=dialog and a name: " + JSON.stringify(dlg));
    // keyboard shortcuts keep working after a dialog closes: focus goes back to the graph, not to the page
    await tab.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.activeElement && document.activeElement.blur()`); await sleep(100);
    await tab.ev(`(() => { const b = document.querySelector(".vg-root button:not([hidden])"); b.focus(); b.blur(); b.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); })()   // a headless window has no page focus, so the event is sent by hand`); await sleep(200);
    const act = await tab.ev(`document.activeElement === document.body ? "body" : document.activeElement.className`);
    check(act !== "body", "focus fell to the page after a control lost it: " + act);
    // toasts: at most two at once, and a repeat is not stacked
    const n = await tab.ev(`(() => { for (const m of ["a", "b", "c", "c", "d"]) window.vaultGraph._debug.toast(m); return document.querySelectorAll(".vg-toast").length; })()`);
    check(n > 0 && n <= 2, "toasts pile up: " + n);
    // matrix cells show "0/2" or "15"; the name has to say which two topics and what the number is (persona round 2)
    await tab.ev(`${D}.openView("lens:matrix")`); await sleep(500);
    const cells = await tab.ev(`[...document.querySelectorAll(".vg-lens .vg-mx-cell")].map(c => c.getAttribute("aria-label") || "")`);
    check(cells.length > 0, "the matrix has cells (the test can't fail without them)");
    check(cells.every(t => t.length > 8), "matrix cells need a name saying which topics: " + JSON.stringify(cells.filter(t => t.length <= 8).slice(0, 3)));
    // opening a note from a control moves focus into the note's panel; closing it puts focus back where it was (persona round 2)
    await tab.ev(`${D}.openView("2d")`); await sleep(300); await tab.ev(`document.querySelectorAll(".vg-lens-close").forEach(b => b.click())`);
    const opener = await tab.ev(`(() => { const b = document.querySelector(".vg-side [data-id], .vg-sidebar [data-id], .vg-root [data-id]"); if (!b) return ""; b.id = b.id || "vg-test-opener"; b.focus(); b.click(); return b.id; })()`); await sleep(500);
    check(!!opener, "a control that opens a note exists (the test can't fail without it)");
    check(await tab.ev(`!!document.activeElement.closest(".vg-inspector")`), "after a note opens, focus should be inside its panel");
    await tab.ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(400);
    const back = await tab.ev(`(() => { const e = document.activeElement, r = e.getBoundingClientRect(); return { id: e.id, tag: e.tagName, onScreen: r.right > 0 && r.bottom > 0 && r.width > 0 }; })()`);
    check(back.tag !== "BODY" && back.onScreen, "after Escape focus should land on something visible: " + JSON.stringify(back));
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "controls and dialogs have names");
})();
