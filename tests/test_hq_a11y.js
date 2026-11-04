#!/usr/bin/env node
// Where a task goes, focus time per project, Needs you in bulk and one at a time, the tour, and what HQ owes someone on a
// keyboard or a screen reader: every control named, readable text in both themes, focus kept through a redraw, dialogs that hold it.
//   node tests/test_hq_a11y.js [--vault [dir]] [--shots dir]        exit 0 = pass
const { sleep, checks, openPage, tools } = require("./kit");
const assert = require("assert"), fs = require("fs"), path = require("path"), cdp = require("./cdp"), env = require("./env"), { VGRules: R } = env.notes();
const shotsAt = process.argv.indexOf("--shots"), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;

// a task in a project's note: under its task heading, or a section of its own, never inside a code block or the frontmatter
{ const add = (t, x = "New") => R.addProjectTask(t, x);
  assert.strictEqual(add("# P\n\n## Tasks\n- [ ] One\n- [x] Two\n\n## Notes\nx\n"), "# P\n\n## Tasks\n- [ ] One\n- [x] Two\n- [ ] New\n\n## Notes\nx\n", "after the tasks there");
  assert.strictEqual(add("# P\n\n## Next steps\n\n## Notes\n"), "# P\n\n## Next steps\n- [ ] New\n\n## Notes\n", "an empty task heading");
  assert.strictEqual(add("# P\n\nBody\n"), "# P\n\nBody\n\n## Tasks\n\n- [ ] New\n", "no heading: a section at the end");
  assert.strictEqual(add("# P\n\nBody\n\n## Related\n\n- [[X]]\n"), "# P\n\nBody\n\n## Tasks\n\n- [ ] New\n\n## Related\n\n- [[X]]\n", "ahead of Related");
  assert.strictEqual(add("# P\n\n```\n## Tasks\n```\n"), "# P\n\n```\n## Tasks\n```\n\n## Tasks\n\n- [ ] New\n", "a heading in a code block isn't one");
  assert.strictEqual(add("---\ntitle: x\n---\n# P\n"), "---\ntitle: x\n---\n# P\n\n## Tasks\n\n- [ ] New\n", "frontmatter stays first");
  assert.strictEqual(add("# P\r\n\r\n## Tasks\r\n- [ ] One\r\n"), "# P\r\n\r\n## Tasks\r\n- [ ] One\r\n- [ ] New\r\n", "line endings stay"); }
// the ranking behind the chart
{ const rows = R.focusByProject({ sessionFor: { "a.md": 30, "b.md": 90, "gone/old note.md": 15, "zero.md": 0 } }, [{ path: "a.md", title: "A" }, { path: "b.md", title: "B" }]);
  assert.deepStrictEqual(rows.map(r => [r.title, r.minutes, r.known]), [["B", 90, true], ["A", 30, true], ["old note", 15, false]], "most first, nothing empty, a gone note kept");
  assert.strictEqual(rows[0].share, 1); assert(Math.abs(rows[1].share - 1 / 3) < 1e-9); assert.deepStrictEqual(R.focusByProject({}, []), []); }
// the capture's path through the real plugin
{ const stub = require("./plugin_stub"), { Plugin } = stub.load(env.rules), wrote = [];
  const note = { path: "Projects/P.md" }, p = Object.assign(Object.create(Plugin.prototype), { fileAt: x => (x === note.path ? note : null), ioProcess: async (f, fn) => { wrote.push([f.path, fn("# P\n")]); } });
  Promise.resolve().then(async () => { assert.strictEqual(await p.capture("Ship it", "task", note.path), note.path); assert.deepStrictEqual(wrote, [[note.path, "# P\n\n## Tasks\n\n- [ ] Ship it\n"]], "the task should go in the project's note");
    await assert.rejects(p.capture("Lost", "task", "gone.md"), /isn't there/, "a project that's gone should say so"); })
    .catch(e => { console.log(`FAIL - capture to a project: ${e.message}`); process.exit(1); }); }

const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// in the page: everything showing that a person reads or presses, with what it's named and how it reads
const AUDIT = `(() => {
  const col = s => { const c = document.createElement("canvas").getContext("2d"); c.fillStyle = "#000"; c.fillStyle = s; c.fillRect; const d = document.createElement("canvas"); d.width = d.height = 1; const x = d.getContext("2d"); x.fillStyle = s; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data]; };
  const over = (top, under) => { const a = top[3] / 255; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)); };
  const behind = e => { const stack = []; for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n); if (c.backgroundImage !== "none") return null; const b = col(c.backgroundColor); if (b[3]) { stack.push(b); if (b[3] === 255) break; } } let out = [255, 255, 255]; stack.reverse().forEach(b => { out = over(b, out); }); return out; };
  const seen = e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== "hidden" && +c.opacity > 0.05; };
  const root = document.querySelector(".vg-hq"), noName = [], low = [], ids = {}, small = [];
  root.querySelectorAll("button, input, select, a[href], [role=button]").forEach(e => { if (!seen(e) || e.disabled) return; const named = (e.getAttribute("aria-label") || e.textContent || e.title || "").trim() || (e.labels && e.labels.length) || (e.getAttribute("aria-labelledby")); if (!named) noName.push(e.outerHTML.slice(0, 90)); const r = e.getBoundingClientRect(); const inSentence = [...e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (Math.min(r.width, r.height) < 24 && e.type !== "checkbox" && !inSentence) small.push(e.parentElement.className + " > " + ((e.getAttribute("aria-label") || e.textContent || e.className) + "").trim().slice(0, 24) + " " + Math.round(r.width) + "x" + Math.round(r.height)); });
  root.querySelectorAll("[id]").forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
  root.querySelectorAll("*").forEach(e => { if (!seen(e) || e.closest("svg") || e.closest(".vg-hq-sr") || e.disabled) return; const own = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!own) return; const c = getComputedStyle(e), bg = behind(e); if (!bg) return; let o = 1; for (let n = e; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; const fg = over([...col(c.color).slice(0, 3), col(c.color)[3] * o], bg); low.push([e.parentElement.className.split(" ")[0] + " > " + e.tagName + "." + String(e.className).split(" ")[0], e.textContent.trim().slice(0, 28), fg, bg, parseFloat(c.fontSize), +c.fontWeight]); });
  return { noName, small, dup: Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k), text: low, h1: root.querySelectorAll("h1").length };
})()`;

(async () => {
  // the graph's tour runs on the same code as HQ's
  { const page = await cdp.open({ html: env.page() });
    if (page) { try {
      if (!await page.waitFor("window.vaultGraph ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
      if (!await page.waitFor("document.querySelector('.vg-tour-card') ? 1 : 0", 8000)) throw new Error("the graph's tour didn't start");
      const titles = []; for (let i = 0; i < 10 && await page.ev("!!document.querySelector('.vg-tour-card')"); i++) { titles.push(await page.ev("document.querySelector('.vg-tour-card b').textContent")); await page.ev("document.querySelector('.vg-tour [data-t=\"next\"]').click()"); await sleep(40); }
      if (titles.length < 3 || !titles.includes("Search")) throw new Error(`the graph's tour steps: ${titles}`);
      if (await page.ev("!!document.querySelector('.vg-tour')")) throw new Error("the graph's tour should end");
    } catch (e) { console.log(`FAIL - ${e.message}`); process.exit(1); } finally { await page.close(); } } }
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.__errs = []; addEventListener("error", e => __errs.push(String(e.message)))`);
    const size = async (width, mobile = false) => { await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile }); await sleep(100); };
    const shot = name => tools(tab, { shots: SHOTS }).shot(name);
    const screen = s => tools(tab, { wait: 50 }).screen(s);
    const click = sel => tools(tab).click(sel);
    const calls = () => tab.ev("window.__calls"), active = () => tab.ev(`(() => { const a = document.activeElement; return a ? (a.className || a.tagName) : ""; })()`);
    const key = (k, more = "") => tab.ev(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true${more} }))`);
    const mount = (state = "{}", extra = "") => tab.ev(`(() => { window.vaultHQ.destroy(); window.__calls = []; const rec = k => async (...a) => { window.__calls.push([k, ...a]); return true; }; const when = new Date(); when.setHours(12, 0, 0, 0); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: when, state: ${state}, ask: async () => true, api: { hqFocus: rec("hqFocus"), hqMark: rec("hqMark"), hqSession: rec("hqSession"), setTaskStatus: rec("setTaskStatus"), completeTask: rec("completeTask"), setTasksStatus: async (r, s) => { window.__calls.push(["setTasksStatus", r, s]); return r.length; }, capture: rec("capture"), openNote() {}, openDaily: rec("openDaily"), openStandup: rec("openStandup"), searchNotes: async () => [], setNoteStatus: rec("setNoteStatus"), moveNote: rec("moveNote"), ${extra} } }); })()`);
    await mount(); await size(1500);
    const hasProjects = await tab.ev(`(DATA.hq.projects || []).filter(p => VGRules.statusGroup(p.status) !== "closed").length > 0`);

    // ---- where a task goes
    await screen("today"); await tab.ev(`(() => { const i = document.querySelector(".vg-hq-captureinput"); i.value = "Call the vendor"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    if (hasProjects) {
      await click("[data-captureto]"); await sleep(40);
      check(await tab.ev(`document.querySelector(".vg-hq-dialog [data-to]").textContent`) === "Today's journal", "the first choice should be today's journal");
      check(await tab.ev(`document.activeElement.matches(".vg-hq-dialog input")`), "the filter should have the focus"); await shot("capture-to");
      const p = await tab.ev(`(() => { const list = VGRules.hqProjects(DATA).filter(p => p.group !== "closed"); return list[0]; })()`);
      await tab.ev(`(() => { const i = document.querySelector(".vg-hq-dialog input"); i.value = ${JSON.stringify(p.title)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      check(!(await tab.ev(`[...document.querySelectorAll(".vg-hq-dialog [data-to]")].some(b => b.textContent === "Today's journal")`)), "the filter should narrow the list");
      await key("Enter"); await sleep(50);
      const c = (await calls()).find(x => x[0] === "capture"); check(c && c[1] === "Call the vendor" && c[2] === "task" && c[3] === p.path, `the task should go to the project: ${JSON.stringify(c)}`);
      check(/^Added to /.test(await tab.ev(`document.querySelector(".vg-hq-toast span").textContent`)), "the toast should name where it went");
      check(await tab.ev(`document.querySelector(".vg-hq-captureinput").value`) === "", "the box should be clear"); check(await tab.ev(`document.activeElement.matches(".vg-hq-captureinput")`), "the box should have the focus back");
      // Ctrl Enter, cancelled: nothing written, the words still there
      await tab.ev(`(() => { const i = document.querySelector(".vg-hq-captureinput"); i.value = "Keep me"; i.dispatchEvent(new Event("input", { bubbles: true })); i.focus(); window.__calls = []; })()`);
      await key("Enter", ", ctrlKey: true"); await sleep(40); check(await tab.ev(`!!document.querySelector(".vg-hq-dialog")`), "Ctrl Enter should open the choice"); await key("Escape"); await sleep(30);
      check(!(await calls()).length, "cancelling should write nothing"); check(await tab.ev(`document.querySelector(".vg-hq-captureinput").value`) === "Keep me", "cancelling should keep the words");
      // Today's journal from the menu: the plain path, with no project
      await click("[data-captureto]"); await sleep(30); await click('.vg-hq-dialog [data-to]'); await sleep(40); const t = (await calls()).find(x => x[0] === "capture"); check(t && t[1] === "Keep me" && t[3] === undefined, `today's journal: ${JSON.stringify(t)}`);
    } else check(!(await tab.ev(`!!document.querySelector("[data-captureto]")`)), "with no projects there's nothing to choose");

    // ---- focus time per project
    await screen("projects"); check(!(await tab.ev(`!!document.querySelector(".vg-hq-focuschart")`)), "no time yet: no chart");
    const projects = await tab.ev(`(DATA.hq.projects || []).map(p => p.path)`);
    if (projects.length) {
      const times = Object.fromEntries(projects.slice(0, 7).map((p, i) => [p, 100 - i * 10])); times["gone/Old project.md"] = 5;
      await mount(`{ review: { sessionFor: ${JSON.stringify(times)} } }`); await screen("projects"); await sleep(30); await shot("focus-chart");
      const rows = await tab.ev(`[...document.querySelectorAll(".vg-hq-focusrow")].map(r => ({ w: r.querySelector("i").style.width, t: r.querySelector("b").textContent, btn: r.tagName }))`);
      check(rows.length === Math.min(5, projects.length + 1), `five rows at first: ${rows.length}`); check(rows[0].w === "100%", "the biggest fills the bar"); check(await tab.ev(`new Set([...document.querySelectorAll(".vg-hq-focusbar")].map(b => Math.round(b.getBoundingClientRect().left))).size === 1`), "every bar should start at the same place"); check(rows[0].t === R.minutesWords(100), `the words: ${rows[0].t}`); check(parseInt(rows[1].w, 10) < 100, "the next is shorter");
      if (projects.length >= 5) { await click("[data-focusall]"); await sleep(30); check(await tab.ev(`document.querySelectorAll(".vg-hq-focusrow").length`) > 5, "All should show the rest"); check(await tab.ev(`document.querySelector("div.vg-hq-focusrow") && document.querySelector("div.vg-hq-focusrow").textContent.includes("Old project")`), "a gone note is a row with no button"); }
      await click("button.vg-hq-focusrow"); await sleep(40); check(await tab.ev(`!!document.querySelector(".vg-hq-drawer")`), "a row should open its project");
      await tab.ev(`document.querySelector(".vg-hq-drawer .vg-hq-x").click()`); await sleep(30);
      await click("[data-board]"); await sleep(30); check(await tab.ev(`!!document.querySelector(".vg-hq-focuschart")`), "the chart stays with the board");
    }

    // ---- Needs you: tick several, or one at a time
    await mount(); await screen("needs");
    const needs = await tab.ev(`window.vaultHQ.items().filter(i => i.group === "needs").map(i => ({ key: i.key, kind: i.kind, title: i.title }))`);
    if (needs.length) {
      check(await tab.ev(`document.querySelectorAll(".vg-hq-sec [data-pick]").length`) === Math.min(needs.length, await tab.ev(`document.querySelectorAll(".vg-hq-sec .vg-hq-item[data-key]").length`)), "every item should have a box");
      await click("[data-pick]"); await sleep(30); const bar = await tab.ev(`[...document.querySelectorAll(".vg-hq-bulk button")].map(b => b.dataset.bulk)`);
      check(bar.includes("later") && bar.includes("clear"), `the bar: ${bar}`); if (needs.length > 1 && !needs.every(n => ["task", "carried", "plan"].includes(n.kind))) check(!bar.includes("x") && !bar.includes("-") && !bar.includes("nextweek"), `a decision can only be put off in bulk: ${bar}`);
      await click('[data-bulk="clear"]'); await sleep(20);
    }
    if (needs.length > 1) {
      await click("[data-pickall]"); await sleep(30); check(await tab.ev(`document.querySelector(".vg-hq-bulk b").textContent`) === `${needs.length} items`, "Select all should pick them all");
      await tab.ev(`window.__calls = []`); await click('[data-bulk="later"]'); await sleep(50); const marks = (await calls()).filter(x => x[0] === "hqMark"); check(marks.length === needs.length && marks.every(m => m[2] === "later"), `Later on all: ${marks.length} of ${needs.length}`); check(/items/.test(await tab.ev(`document.querySelector(".vg-hq-toast span").textContent`)), "the toast should say items");
      await mount(); await screen("needs"); await click('[data-walk="on"]'); await sleep(30); await shot("needs-walk");
      check(await tab.ev(`document.querySelector(".vg-hq-walk h2").textContent`) === needs[0].title || await tab.ev(`!!document.querySelector(".vg-hq-walk h2")`), "one at a time should show one"); check(await tab.ev(`document.querySelectorAll(".vg-hq-walk").length`) === 1 && await tab.ev(`document.querySelectorAll(".vg-hq-sec .vg-hq-item").length`) === 0, "and only one"); check(await tab.ev(`/1 of ${needs.length}/.test(document.querySelector(".vg-hq-walk .vg-hq-eyebrow").textContent)`), "it should say how far");
      const first = await tab.ev(`document.querySelector(".vg-hq-walk").dataset.key`); await click('[data-walk="skip"]'); await sleep(30); check(await tab.ev(`document.querySelector(".vg-hq-walk").dataset.key`) !== first, "Skip should move on"); check(await tab.ev(`/2 of/.test(document.querySelector(".vg-hq-walk .vg-hq-eyebrow").textContent)`), "the count should move");
      const second = await tab.ev(`document.querySelector(".vg-hq-walk").dataset.key`); await tab.ev(`window.__calls = []`); await click('.vg-hq-walk [data-act="later"]'); await sleep(50); check((await calls()).some(c => c[0] === "hqMark" && c[1] === second), "acting on one should write it"); check(await tab.ev(`(document.querySelector(".vg-hq-walk") || { dataset: {} }).dataset.key`) !== second, "and bring the next");
      for (let i = 0; i < needs.length + 1 && await tab.ev(`!!document.querySelector('[data-walk="skip"]')`); i++) { await click('[data-walk="skip"]'); await sleep(10); }
      check(await tab.ev(`!!document.querySelector('[data-walk="again"]')`), "at the end: a way on, not a dead end"); await click('[data-walk="off"]'); await sleep(20); check(await tab.ev(`!document.querySelector(".vg-hq-walk")`), "Back to the list");
    }

    // ---- the tour: once on a first open, and it saves that; never in a test's mount or for someone who's seen it
    await mount(`{ review: {} }`, `hqTourSeen: async () => { window.__calls.push(["seen"]); },`); await sleep(1700);
    check(await tab.ev(`!!document.querySelector(".vg-tour")`), "a first open should show the tour"); check(/1 \//.test(await tab.ev(`document.querySelector(".vg-tour-card span").textContent`)), "from its first step");
    check(await tab.ev(`document.activeElement.dataset.t`) === "next", "Next should have the focus"); check(await tab.ev(`document.querySelector(".vg-tour").getAttribute("role")`) === "dialog", "it's a dialog"); await shot("tour-1");
    const seenTitles = []; for (let i = 0; i < 12 && await tab.ev(`!!document.querySelector(".vg-tour")`); i++) { seenTitles.push(await tab.ev(`document.querySelector(".vg-tour-card b").textContent`)); const r = await tab.ev(`(() => { const r = document.querySelector(".vg-tour-ring"); if (!r) return null; const c = document.querySelector(".vg-tour-card").getBoundingClientRect(), h = document.querySelector(".vg-hq").getBoundingClientRect(); return c.left >= h.left && c.right <= h.right && c.top >= h.top && c.bottom <= h.bottom; })()`); check(r !== false, `the card for ${seenTitles[seenTitles.length - 1]} runs off the pane`); await click('.vg-tour [data-t="next"]'); await sleep(40); }
    check(seenTitles[0] === "The next step" && seenTitles.includes("Capture") && seenTitles.includes("Needs you") && seenTitles.includes("Calendar"), `the steps: ${seenTitles}`); check(!(await tab.ev(`!!document.querySelector(".vg-tour")`)), "it should end");
    check((await calls()).filter(c => c[0] === "seen").length === 1, "the end should be saved once");
    await mount(`{ review: { hqTour: true } }`, `hqTourSeen: async () => { window.__calls.push(["seen"]); },`); await sleep(1700); check(!(await tab.ev(`!!document.querySelector(".vg-tour")`)), "seen once: not again");
    await tab.ev(`window.vaultHQ.tour()`); await sleep(40); check(await tab.ev(`!!document.querySelector(".vg-tour")`), "but it's there on request");
    await tab.ev(`window.vaultHQ.update(DATA)`); await sleep(40); check(await tab.ev(`!!document.querySelector(".vg-tour")`), "a data update shouldn't end it"); await key("Escape"); await sleep(30); check(!(await tab.ev(`!!document.querySelector(".vg-tour")`)), "Escape should end it");

    // ---- focus: a redraw keeps it, a dialog holds it and gives it back, an update doesn't take either away
    await mount(); await screen("today");
    await tab.ev(`document.querySelector('.vg-hq-dockbtn[data-go="people"]').focus()`); await tab.ev(`document.querySelector('.vg-hq-dockbtn[data-go="people"]').click()`); await sleep(40);
    check(await tab.ev(`document.activeElement.dataset.go`) === "people", `after pressing a dock button: ${await active()}`);
    check(await tab.ev(`document.querySelector(".vg-hq-sr").textContent`) === "People", "the new screen should be said"); check(await tab.ev(`document.querySelector(".vg-hq-sr").getAttribute("role")`) === "status", "in a live region");
    await screen("today"); await tab.ev(`(() => { const i = document.querySelector(".vg-hq-captureinput"); i.focus(); i.value = "half typed"; i.setSelectionRange(4, 4); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await tab.ev(`window.vaultHQ.update(DATA)`); await sleep(40);
    check(await tab.ev(`document.activeElement.matches(".vg-hq-captureinput") && document.activeElement.value === "half typed" && document.activeElement.selectionStart === 4`), "an update while typing should leave the box, the words and the cursor");
    await tab.ev(`document.querySelector(".vg-hq-captureinput").focus()`); await screen("people"); check(await tab.ev(`document.activeElement.matches(".vg-hq-main")`), `going to another screen should move the focus off the old one: ${await active()}`); await screen("today");
    await tab.ev(`document.querySelector('[data-keys]').focus(); document.querySelector('[data-keys]').click()`); await sleep(30);
    check(await tab.ev(`document.querySelector(".vg-hq-dialog").getAttribute("aria-modal")`) === "true", "a dialog should be modal");
    const inDialog = () => tab.ev(`!!document.activeElement.closest(".vg-hq-dialog")`);
    for (let i = 0; i < 4; i++) { await key("Tab"); check(await inDialog(), "Tab should stay in the dialog"); } await key("Tab", ", shiftKey: true"); check(await inDialog(), "Shift Tab should stay in the dialog");
    await tab.ev(`window.vaultHQ.update(DATA)`); await sleep(40); check(await tab.ev(`!!document.querySelector(".vg-hq-dialog")`) && await inDialog(), "an update shouldn't close a dialog or take its focus");
    await key("Escape"); await sleep(30); check(await tab.ev(`document.activeElement.hasAttribute("data-keys")`), `closing should give the focus back: ${await active()}`);
    await tab.ev(`window.vaultHQ.palette()`); await sleep(30); await tab.ev(`document.querySelector(".vg-hq-palinput").focus()`); await key("Tab"); check(await tab.ev(`!!document.activeElement.closest(".vg-hq-palette")`), "Tab should stay in the palette"); await key("Escape"); await sleep(20);
    // a row that's just gone: the focus lands on the next one, not on nothing
    const hasRows = await tab.ev(`document.querySelectorAll(".vg-hq-sec .vg-hq-item[data-key]").length > 1`);
    if (hasRows) { await tab.ev(`document.querySelector('.vg-hq-sec .vg-hq-item[data-key] [data-act="later"]').focus()`); await tab.ev(`document.activeElement.click()`); await sleep(60); check(await tab.ev(`document.activeElement !== document.body && document.querySelector(".vg-hq").contains(document.activeElement)`), "after acting on a row the focus should stay in HQ"); }

    // ---- the audit, every screen, both themes
    const bad = new Map(), named = new Set(), dup = new Set(), small = new Set(), heads = new Set();
    // names and targets on the page's plain theme too; contrast on the vault's palette (the values vault-design.css gives Obsidian), since a button's ink on its accent belongs to the theme
    const FLEXOKI = { light: { "--background-primary": "#FFFCF0", "--background-secondary": "#F2F0E5", "--background-modifier-border": "#E6E4D9", "--text-normal": "#100F0F", "--text-muted": "#6F6E69", "--text-faint": "#878580", "--interactive-accent": "#BC5215", "--text-on-accent": "#FFFCF0", "--text-accent": "#BC5215" }, dark: { "--background-primary": "#100F0F", "--background-secondary": "#1C1B1A", "--background-modifier-border": "#282726", "--text-normal": "#CECDC3", "--text-muted": "#878580", "--text-faint": "#6F6E69", "--interactive-accent": "#DA702C", "--text-on-accent": "#100F0F", "--text-accent": "#F9AE77" } };
    for (const [theme, dark, vars] of [["plain", false, {}], ["vault light", false, FLEXOKI.light], ["vault dark", true, FLEXOKI.dark]]) {
      await tab.ev(`(() => { const r = document.documentElement.style; Object.keys(${JSON.stringify(FLEXOKI.light)}).forEach(k => r.removeProperty(k)); Object.entries(${JSON.stringify(vars)}).forEach(([k, v]) => r.setProperty(k, v)); document.body.classList.toggle("theme-dark", ${dark}); document.querySelector(".vg-hq").classList.toggle("theme-dark", ${dark}); })()`);
      await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }] });   // an entrance in flight would read as faint text
      for (const s of ["home", "today", "needs", "people", "projects", "calendar", "wrap", "review", "threads", "automations"]) {
        await screen(s); await sleep(30); await tab.ev(`document.querySelector(".vg-hq").classList.toggle("theme-dark", ${dark})`); const a = await tab.ev(AUDIT);
        a.noName.forEach(x => named.add(`${s}: ${x}`)); a.dup.forEach(x => dup.add(`${s}: ${x}`)); if (!dark) a.small.forEach(x => small.add(x));
        if (a.h1 !== 1 && s !== "home") heads.add(`${s}: ${a.h1} h1`);
        a.text.forEach(([what, words, fg, bg, fs, w]) => { const r = ratio(fg, bg), large = fs >= 24 || (fs >= 18.66 && w >= 700); if (theme !== "plain" && r < (large ? 3 : 4.5)) { const k = `${theme} ${what}`; if (!bad.has(k) || r < bad.get(k)[0]) bad.set(k, [r, words]); } });
      }
    }
    await tab.ev(`document.body.classList.remove("theme-dark"); document.querySelector(".vg-hq").classList.remove("theme-dark")`); await tab.send("Emulation.setEmulatedMedia", { features: [] });
    check(!named.size, `controls with no name:\n    ${[...named].slice(0, 12).join("\n    ")}`); check(!dup.size, `repeated ids: ${[...dup].slice(0, 8)}`); check(!heads.size, `headings: ${[...heads]}`);
    check(!bad.size, `text below AA (${bad.size}):\n    ${[...bad].sort().map(([k, [r, w]]) => `${k} ${r.toFixed(2)} "${w}"`).slice(0, 70).join("\n    ")}`);
    if (process.env.A11Y_VERBOSE) console.log("small targets:", [...small].join(" | "));
    check(!small.size, `targets under 24px (${small.size}):\n    ${[...small].slice(0, 30).join("\n    ")}`);
    const errs = await tab.ev("window.__errs"); check(!errs.length, "page errors: " + errs.join("; "));
  } catch (e) { fails.push(e.stack || e.message); } finally { await tab.close(); }
  if (fails.length) { console.log("FAIL - HQ accessibility and new features:\n  " + fails.join("\n  ")); process.exit(1); }
  console.log("ok - where a task goes, focus chart, Needs you in bulk and one at a time, tour; names, contrast, targets and focus on every screen in both themes");
  process.exit(0);
})();
