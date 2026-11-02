#!/usr/bin/env node
// What a look at the real app found and no test had: counts that add up from one rule, HQ's list keeping up with the clock, long
// titles not veiled by hidden buttons, scripts kept out of search and Peek, statuses and code names in words, a Focus screen
// that can start something, and a header that stays put.
//   node tests/test_hq_polish.js [--vault [dir]]        exit 0 = pass
const assert = require("assert"), cdp = require("./cdp"), env = require("./env"), { VGRules: R } = env.notes();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// the counts: every kind of node lands in exactly one, and they add up
const mix = [{}, { isolated: true }, { moc: true }, { person: true }, { ghost: true }, { person: true, isolated: true }, { ghost: true, isolated: true }, { moc: true, isolated: true }];
const c = R.noteCounts(mix);
assert.deepStrictEqual(c, { notes: 2, linked: 1, unlinked: 1, maps: 2, people: 2, wanted: 2 });
assert.strictEqual(c.linked + c.unlinked, c.notes); assert.strictEqual(c.notes + c.maps + c.people + c.wanted, mix.length);
assert.strictEqual(R.noteCounts(undefined).notes, 0);
// on this vault's own data, whatever it holds
{ const nodes = env.data().nodes || [], k = R.noteCounts(nodes); assert.strictEqual(k.notes + k.maps + k.people + k.wanted, nodes.length, "a node was counted twice or not at all"); }

// snippets and scripts
assert.strictEqual(R.plainSnippet("- [x] Deployed it\n- [ ] Next"), "Deployed it Next", "a checkbox shows in a snippet");
assert.strictEqual(R.plainSnippet("see [x] here"), "see [x] here", "brackets mid-line are the note's");
const noted = "# T\n```dataviewjs\nconst secret = 1;\n```\n```js\nconst kept = 2;\n```\n```tasks\nnot done\n```\nA paragraph long enough to be its own chunk here.\n";
assert(!JSON.stringify(R.recallChunks(noted)).includes("secret"), "search indexes a script"); assert(!JSON.stringify(R.recallChunks(noted)).includes("not done"), "search indexes a query");
assert(JSON.stringify(R.recallChunks(noted)).includes("kept"), "search lost a real code block");
const pv = R.notePreview(noted); assert(!JSON.stringify(pv).includes("secret"), "Peek shows a script"); assert.deepStrictEqual(pv.blocks.filter(b => b.kind === "code").map(b => b.text), ["const kept = 2;"]);
assert(!JSON.stringify(R.notePreview("```dataview\nopen").blocks).includes("open"), "an unclosed script shows");
// words
assert.strictEqual(R.statusWords("in-progress"), "in progress"); assert.strictEqual(R.statusWords("pending-approval"), "pending approval"); assert.strictEqual(R.statusWords(""), "");
assert.strictEqual(R.codeNameWords("JK_LiveDriveTimes"), "Live Drive Times"); assert.strictEqual(R.codeNameWords("FIX-JK_TwilioResponse"), "Twilio Response");
assert.strictEqual(R.codeNameWords("Sticker Audit Page"), "Sticker Audit Page", "a real title changed"); assert.strictEqual(R.codeNameWords("Odoo 19_notes here"), "Odoo 19_notes here");
assert.strictEqual(R.hqNextStep({ list: [{ key: "j", group: "needs", kind: "job", title: "backup: late" }], day: "2026-11-04" }).label, "Check backup: late");

(async () => {
  const tab = await cdp.open({ html: env.hqPage(""), port: 9391 });
  if (!tab) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
  const fails = [], check = (ok, what) => { if (!ok) fails.push(what); };
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(150);
    const job = (env.rules.hq.automations || [])[0]; assert(job, "these rules have no automation to test with");
    // the clock: a job goes late with no note changing, and the list, the header and the count follow
    const every = job.every_hours || 24, start = Date.parse("2026-11-04T12:00:00"), hours = 36e5;
    await tab.ev(`(() => { window.vaultHQ.destroy(); DATA.hq = { ...(DATA.hq || {}), runs: { ...((DATA.hq || {}).runs || {}), ${JSON.stringify(job.name)}: { last_run: new Date(${start - every * 1.5 * hours}).toISOString(), ok: true } } };
      window.__o = { now: new Date(${start}), api: { capture: async () => {}, hqFocus: async () => {}, hqMark: async () => {}, hqSession: () => {}, openNote() {}, searchNotes: async () => [] } }; window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, window.__o); })()`);
    const lateKey = `window.vaultHQ.items().some(i => i.kind === "job" && i.name === ${JSON.stringify(job.name)})`;
    check(await tab.ev(`!(${lateKey})`), "the job is late before its time");
    await tab.ev(`(() => { window.__o.now = new Date(${start + every * hours}); window.vaultHQ.tick(); })()`);
    check(await tab.ev(lateKey), "HQ's list didn't notice a job going late");
    check(await tab.ev(`document.querySelector(".vg-hq-nextchip b").textContent.startsWith("Check ")`), "the header didn't redraw when the list changed");
    await tab.ev(`(() => { window.__o.now = new Date(); window.vaultHQ.update(DATA); })()`);
    // a long title under hidden buttons
    await tab.ev(`window.vaultHQ.setScreen("today")`); await sleep(150);
    assert(await tab.ev(`matchMedia("(hover: hover)").matches`), "this browser has no hover, so the veil can't be tested");
    const veil = await tab.ev(`(() => { const acts = [...document.querySelectorAll(".vg-hq-sec .vg-hq-item[data-key] > .vg-hq-acts")].filter(a => getComputedStyle(a).position === "absolute" && !a.parentElement.matches(":hover, :focus-within, :focus, .is-sel")); return { n: acts.length, veiled: acts.filter(a => getComputedStyle(a).backgroundImage !== "none").length }; })()`);
    check(veil.n > 0, "no resting row to test"); check(veil.veiled === 0, `${veil.veiled} rows hide part of their title behind invisible buttons`);
    // the header stays put from screen to screen
    const x = async s => { await tab.ev(`window.vaultHQ.setScreen("${s}")`); await sleep(100); return tab.ev(`document.querySelector(".vg-hq-nextchip").getBoundingClientRect().left`); };
    const a = await x("home"), b = await x("review"), d = await x("today"); check(a === b && b === d, `the chip moves between screens: ${a}, ${b}, ${d}`);
    // today's date isn't the screen's loud thing; Add task isn't until there's something to add
    check(await tab.ev(`getComputedStyle(document.querySelector(".vg-hq-day.is-today")).backgroundColor !== getComputedStyle(document.querySelector(".vg-hq-nextdot")).backgroundColor`), "today's date is filled with the accent, like the next step");
    const add = `getComputedStyle(document.querySelector("[data-capture='task']")).backgroundColor`, quiet = await tab.ev(add);
    await tab.ev(`(() => { const i = document.querySelector(".vg-hq-captureinput"); i.value = "x"; })()`); await sleep(250);
    check(await tab.ev(add) !== quiet, "Add task doesn't light up with text in the box"); await tab.ev(`document.querySelector(".vg-hq-captureinput").value = ""`);
    // Focus with nothing running: says what, and starts it
    await tab.ev(`window.vaultHQ.setScreen("session")`); await sleep(100);
    const start1 = await tab.ev(`(() => { const b = document.querySelector(".vg-hq-session .vg-hq-btn-primary[data-session]"); return b ? b.textContent : null; })()`);
    check(start1 === "Start", "the Focus screen has no Start button"); check(await tab.ev(`!!document.querySelector(".vg-hq-session-title")`), "the Focus screen doesn't say what it's for");
    await tab.ev(`document.querySelector("[data-sesslen='45']").click()`); await sleep(60);
    check(await tab.ev(`document.querySelector(".vg-hq-timer b").textContent`) === "45:00", "picking a length doesn't show");
    await tab.ev(`document.querySelector(".vg-hq-session .vg-hq-btn-primary[data-session]").click()`); await sleep(60);
    check(await tab.ev(`!!window.vaultHQ.session() && window.vaultHQ.session().length === 45`), "Start didn't start a session of the picked length");
    await tab.ev(`document.querySelector("[data-sessionctl='end']").click()`); await sleep(60);
    // the calendar uses the width it has
    await tab.ev(`window.vaultHQ.setScreen("calendar")`); await sleep(100);
    check(await tab.ev(`(() => { const p = document.querySelector(".vg-hq-calpanel").getBoundingClientRect(), c = document.querySelector(".vg-hq-col").getBoundingClientRect(); return c.right - p.right < 40; })()`), "the calendar leaves the right of the screen empty");
    // nothing raw on the projects
    await tab.ev(`window.vaultHQ.setScreen("projects")`); await sleep(100);
    const raw = await tab.ev(`[...document.querySelectorAll(".vg-hq-pill")].map(p => p.textContent).filter(t => /-/.test(t))`); check(!raw.length, `raw statuses: ${[...new Set(raw)].join(", ")}`);
    // the graph: a tile's number sits over its label, and the status says what the total holds
    const g = await cdp.open({ html: env.page(), port: 9392 });
    await g.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await g.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(1200);
    await g.ev(`document.querySelectorAll(".vg-tour").forEach(x => x.remove())`);
    check(await g.ev(`getComputedStyle(document.querySelector(".vg-stat")).display`) === "block", "a stat tile isn't set to stack, so Obsidian's button styles run its number into its label");
    const words = await g.ev(`document.querySelector(".vg-status").textContent`), active = await g.ev(`window.vaultGraph._debug.active().length`), sum = (words.match(/\d+/g) || []).map(Number).reduce((s, n) => s + n, 0);
    check(sum === active, `the status "${words}" doesn't add up to the ${active} on screen`); check(!/persons/.test(words), `the status says "${words}"`);
    await g.close?.();
    console.log(fails.length ? fails.map(f => "  FAIL " + f).join("\n") : "ok - counts add up, the list keeps time, nothing veiled or raw");
  } finally { await tab.close(); }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
