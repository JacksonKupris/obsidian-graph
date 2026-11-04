#!/usr/bin/env node
// The shared interface parts (src/parts.js): what they write, cards opening what's behind them on a real page, Task survival built
// from them as the pattern, and no view writing its own again.
//   node tests/test_parts.js [--vault [dir]]        exit 0 = pass
const assert = require("assert"), fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const SRC = path.join(build.ROOT, "src");
const P = new Function(`${fs.readFileSync(path.join(SRC, "shared.js"), "utf8")}\n${fs.readFileSync(path.join(SRC, "parts.js"), "utf8")}; return VGParts;`)();
const { fails, ok: check } = checks();

// ---- what they write: anything with nothing behind it isn't a button, and text is escaped
assert(!P.cards([{ value: 3, label: "plain" }]).includes("<button"), "a card with nothing behind it shouldn't be a button");
assert(P.cards([{ value: 3, label: "x", open: "k" }]).includes('data-card="k"'), "a card with a key opens it");
assert(P.cards([{ value: 3, label: "x", hint: "why" }]).includes('data-card-hint="why"'), "a card with a hint opens that");
assert(P.cards([{ value: "<b>", label: "'" }]).includes("&lt;b&gt;") && P.row({ title: "<i>", open: `a"b` }).includes("a&quot;b"), "parts escape what they're given");
{ const rows = Array.from({ length: 7 }, (_, i) => P.row({ title: `r${i}` })), html = P.list(rows, { first: 5, word: "tasks" });
  assert(html.includes("r6") && html.includes("Show 2 tasks"), "the rest of a list goes behind a show more, not away"); assert(!P.list(rows.slice(0, 5)).includes("<details"), "a short list has no show more"); }

{ const Q = new Function(`${build.rulesSource(env.rules)}; return VGRules;`)(); assert.strictEqual(Q.plainTask("Fix the [[Kiosk|kiosk]] ✅ 2026-10-07"), "Fix the kiosk", "a task's words leave out its done date"); assert.strictEqual(Q.plainTask("See ✅ marks"), "See ✅ marks", "a tick with no date is the task's own"); }

// ---- no view writes its own. The cap only comes down: lower it when a view moves over.
{ const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".js") ? [path.join(d, e.name)] : []);
  const js = walk(SRC).filter(f => path.basename(f) !== "parts.js").map(f => [path.relative(SRC, f), fs.readFileSync(f, "utf8")]);
  js.forEach(([f, t]) => check(!/class="ds-(card|cards|more|section|row|rows|detail)\b/.test(t), `${f} writes a shared part by hand: use VGParts`));
  const count = rx => js.reduce((n, [, t]) => n + (t.match(rx) || []).length, 0);
  const DETAILS_CAP = 20; check(count(/<details\b/g) <= DETAILS_CAP, `${count(/<details\b/g)} hand-written <details>, more than ${DETAILS_CAP}: use VGParts.more`);
  check(!/sciFacts = [^\n]*<div/.test(build.viewSource()) && !/sciRead = [^\n]*<p/.test(build.viewSource()), "the science views' cards and notes should come from VGParts"); }

// ---- on a real page: Task survival's cards open what's behind them. 80 tasks: half finished over time, half still open.
(async () => {
  const history = [], day = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < 80; i++) { const age = 10 + i * 3, done = i % 2 === 0, t = `Part test task number ${i} ${i % 3 ? "" : "[[A note]]"}`;
    history.push({ date: day(age), path: `Daily/${day(age)}.md`, tasks: [{ mark: done ? "x" : " ", text: `${t}${done ? ` ✅ ${day(Math.max(0, age - (i % 25) - 1))}` : ""}`, line: 1 }] }); }
  const OPEN = "openNote: path => { location.href"; let html = env.pageWith(`taskHistory: async () => ${env.inlineJson(history)},`); assert(html.includes(OPEN), "the page doesn't open notes the way this test expects"); html = html.replace(OPEN, "openNote: path => { (window.__opened = window.__opened || []).push(path); return; location.href");
  const tab = await openPage({ html });
  try {
    await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000); await sleep(600);
    await tab.ev(`window.vaultGraph._debug.openLens("survival")`);
    const body = `document.querySelector(".vg-lens:not([hidden]) .vg-lens-body")`;
    check(await tab.waitFor(`${body} && ${body}.querySelector(".ds-card") ? 1 : 0`, 15000), "Task survival drew no cards");
    const ev = f => tab.ev(`(() => { const B = ${body}; ${f} })()`);
    const first = await ev(`const c = B.querySelector("button.ds-card"); c.click(); const d = B.querySelector(".ds-detail"); return { label: c.dataset.cardLabel, open: !!d, rows: d ? d.querySelectorAll(".ds-row").length : 0, exp: c.getAttribute("aria-expanded"), hint: !!(d && d.querySelector("p")) };`);
    check(first.open && first.exp === "true", `pressing a card opens its panel (${JSON.stringify(first)})`); check(first.rows > 0, `the median's panel lists tasks (${first.rows})`); check(first.hint, "the panel says what the number means");
    const second = await ev(`const cs = [...B.querySelectorAll("button.ds-card")], c = cs[1]; c.click(); return { panels: B.querySelectorAll(".ds-detail").length, firstClosed: cs[0].getAttribute("aria-expanded") === "false" };`);
    check(second.panels === 1 && second.firstClosed, `one panel at a time (${JSON.stringify(second)})`);
    check(await ev(`B.querySelector(".ds-detail-close").click(); return B.querySelectorAll(".ds-detail").length === 0 && B.querySelectorAll('[aria-expanded="true"]').length === 0;`), "the close button closes it");
    check(await ev(`const c = B.querySelectorAll("button.ds-card")[0]; c.click(); c.click(); return B.querySelectorAll(".ds-detail").length === 0;`), "pressing the card again closes it");
    const age = await ev(`const c = B.querySelector(".ds-cards.is-small button.ds-card"); if (!c) return null; c.click(); const d = c.closest(".ds-cards").nextElementSibling; const out = { label: c.dataset.cardLabel, rows: d && d.classList.contains("ds-detail") ? d.querySelectorAll(".ds-row").length : -1 }; const go = d && d.querySelector("button.ds-row"); if (go) go.click(); return out;`);
    check(age && age.rows > 0, `an age's card lists the tasks at that age (${JSON.stringify(age)})`);
    check((await tab.ev("(window.__opened || []).length")) === 1, "a task in a panel opens its note");
    const shape = await ev(`const text = B.innerText, more = [...B.querySelectorAll("details.ds-more")]; return { closed: more.every(d => !d.open), labels: more.map(d => d.querySelector("summary").textContent), visibleMethod: /log-rank|Kaplan-Meier curves/.test(text), full: /Kaplan-Meier/.test(B.textContent), rowsShown: [...B.querySelectorAll(":scope .ds-section .ds-rows")][0] ? [...B.querySelectorAll(".ds-section")].pop().querySelector(".ds-rows").children.length : 0 };`);
    check(shape.closed, "long text starts collapsed"); check(!shape.visibleMethod, "the method's wording stays behind a show more"); check(shape.full, "the method's wording is still there");
    check(shape.labels.includes("How to read this"), `there's a how-to-read (${shape.labels})`); check(shape.rowsShown > 0 && shape.rowsShown <= 5, `a long list starts with its first few (${shape.rowsShown})`);
    // a re-render (changing what's compared) keeps it all working
    await ev(`B.querySelectorAll("[data-survival-split]")[1].click();`); await sleep(200);
    check(await ev(`const c = B.querySelector("button.ds-card"); c.click(); return !!B.querySelector(".ds-detail");`), "cards still open after the lens redraws");
    // phone width: nothing wider than the screen
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 800, deviceScaleFactor: 2, mobile: true }); await sleep(400);
    const wide = await ev(`return [...B.querySelectorAll(".ds-card, .ds-detail, .ds-more, .ds-row")].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length;`); check(wide === 0, `${wide} parts run off a phone's screen`);
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "parts: cards open what's behind them, long text starts collapsed, no view writes its own", "parts");
})().catch(e => { console.log(`FAIL - parts: ${e.message}`); process.exit(1); });
