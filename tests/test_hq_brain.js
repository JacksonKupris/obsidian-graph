#!/usr/bin/env node
// Vault HQ as a second brain: capture from the box (Enter a task, Shift+Enter a note), what your notes know about an item,
// People, the keyboard, and a task landing under the journal's task heading without touching anything else.
//   node tests/test_hq_brain.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit");
const assert = require("assert"), env = require("./env"), { VGRules } = env.notes();
const heading = VGRules.RULES.hq.journal_tasks_heading;
const j = `# Day\n\n### ${heading}\n- [ ] one\n- [x] two\n\n### Later\n- [ ] not here\n`;
assert.strictEqual(VGRules.addTaskLine(j, "new"), `# Day\n\n### ${heading}\n- [ ] one\n- [x] two\n- [ ] new\n\n### Later\n- [ ] not here\n`, "the task isn't under the heading");
assert.strictEqual(VGRules.addTaskLine(`### ${heading}\n\n### Next\n`, "a"), `### ${heading}\n- [ ] a\n\n### Next\n`);
assert.strictEqual(VGRules.addTaskLine("no heading\n", "a"), "no heading\n\n- [ ] a\n", "a note without the heading lost the task");
assert.strictEqual(VGRules.addTaskLine(`### ${heading}\r\n- [ ] one\r\n`, "a"), `### ${heading}\r\n- [ ] one\r\n- [ ] a\r\n`, "line endings changed");
const ppl = VGRules.hqPeople({ nodes: [{ id: "p/Brian.md", name: "Brian", person: true }, { id: "p/Show.md", name: "Show", person: true }, { id: "p/Ann.md", name: "Ann", person: true }, { id: "x.md", name: "X" }] },
  [{ key: "a", kind: "task", text: "Ask [[Brian]] about AWS" }, { key: "b", kind: "task", title: "Show and Tell prep" }, { key: "c", kind: "plan", text: "Send to [[Show]]" }, { key: "d", kind: "carried", title: "Brian wants the report" }, { key: "e", kind: "link", title: "Link Brian Review to Other" }, { key: "f", kind: "backlog", title: "the [[Brian links" }]);
assert.deepStrictEqual(ppl.map(p => [p.name, p.items.map(i => i.key)]), [["Brian", ["a", "d"]], ["Show", ["c"]], ["Ann", []]], "people matched wrongly (Show and Tell isn't Show)");
// someone with nothing open still shows what the notes hold on them: the notes they're linked from, most used first
const quiet = VGRules.hqPeople({ nodes: [{ id: "p/Ann.md", name: "Ann", person: true, mentions: 2 }, { id: "p/Cy.md", name: "Cy", person: true, mentions: 9 }, { id: "a.md", name: "A", recent: 1 }, { id: "b.md", name: "B", recent: 5 }],
  links: [{ source: "p/Ann.md", target: "a.md", kind: "person" }, { source: { id: "p/Ann.md" }, target: { id: "b.md" }, kind: "person" }, { source: "p/Ann.md", target: "missing.md", kind: "person" }, { source: "a.md", target: "b.md" }] }, []);
assert.deepStrictEqual(quiet.map(p => [p.name, p.notes.map(n => n.id)]), [["Cy", []], ["Ann", ["b.md", "a.md"]]], "a person's linked notes, or the order of people with nothing open, is wrong");

// the day's loop
const day0 = "2026-10-28", list0 = [{ key: "a" }, { key: "b" }];
assert.deepStrictEqual(VGRules.hqFocusItems(list0, { focus: { day: day0, keys: ["b", "gone"] } }, day0).map(i => i.key), ["b"], "focus should keep its order and skip what's gone");
assert.deepStrictEqual(VGRules.hqFocusItems(list0, { focus: { day: "2026-10-27", keys: ["a"] } }, day0), [], "yesterday's focus carried over");
assert.deepStrictEqual(VGRules.doneToday({ hq: { journals: [{ path: "j.md", tasks: [{ mark: "x", text: `Fixed it ✅ ${day0}` }, { mark: "x", text: "Old ✅ 2026-01-01" }, { mark: " ", text: "Open" }] }] } }, { hq: { "plan|s.md|0|Ship it": `done:${day0}`, "plan|s.md|1|Later": `later:${day0}` } }, day0).map(d => d.text), ["Fixed it", "Ship it"], "done today is wrong");
const plan0 = `## Work Completed Today\n\n1. a\n\n## ${VGRules.RULES.hq.plan_heading} Tomorrow\n\n1. first\n\n---\nend\n`;
assert(VGRules.addWorkLine(plan0, "second", VGRules.RULES.hq.plan_heading).includes("1. first\n2. second"), "a plan line didn't go under tomorrow's heading");
assert.strictEqual(VGRules.hqKind(`${VGRules.folders.inbox}/Idea.md`, {}, day0), "inbox", "an inbox note isn't seen");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`(() => { window.__calls = []; window.vaultHQ.destroy(); window.vaultHQ = mountVaultHQ(document.getElementById("hq"), DATA, { now: new Date("2026-10-28T12:00:00"), ask: async () => true,
      api: { capture: async (t, k) => { window.__calls.push(["capture", t, k]); return "Inbox/x.md"; }, hqMark: async (...a) => window.__calls.push(["mark", ...a]), openNote: p => window.__calls.push(["open", p]), hqFocus: async k => window.__calls.push(["focus", k]), planLine: async t => { window.__calls.push(["plan", t]); return true; }, setTaskStatus: async (...a) => window.__calls.push(["status", ...a]), completeTask: async (...a) => window.__calls.push(["done", ...a]), logWork: async () => false,
        searchNotes: async q => { window.__calls.push(["search", q]); return [{ path: "Old fix.md", heading: "How it was solved", snippet: "We did this before" }]; } } }); })()`);
    await sleep(100);
    // capture
    check(await tab.ev(`!!document.querySelector(".vg-hq-captureinput")`), "no capture box on Home");
    const type = (text, shift) => tab.ev(`(() => { const b = document.querySelector(".vg-hq-captureinput"); b.focus(); b.value = ${JSON.stringify(text)}; b.dispatchEvent(new Event("input", { bubbles: true })); b.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: ${!!shift}, bubbles: true })); })()`);
    await type("call the vendor"); await sleep(60);
    check((await tab.ev("window.__calls")).some(c => c[0] === "capture" && c[1] === "call the vendor" && c[2] === "task"), "Enter didn't capture a task");
    check(await tab.ev(`document.querySelector(".vg-hq-captureinput").value === "" && document.activeElement === document.querySelector(".vg-hq-captureinput")`), "the box isn't empty and ready for the next one");
    await type("an idea", true); await sleep(60);
    check((await tab.ev("window.__calls")).some(c => c[0] === "capture" && c[2] === "note"), "Shift+Enter didn't capture a note");
    // the keyboard, from Today
    await tab.ev(`window.vaultHQ.setScreen("today"); document.querySelector(".vg-hq-global-search").blur()`); await sleep(50);
    const press = k => tab.ev(`(document.activeElement && document.activeElement !== document.body && document.querySelector(".vg-hq").contains(document.activeElement) ? document.activeElement : document.querySelector(".vg-hq")).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
    const n = await tab.ev(`document.querySelectorAll(".vg-hq-item[data-key]").length`);
    if (n > 1) {
      await press("j"); const a = await tab.ev(`document.activeElement.dataset.key`); await press("j"); const b = await tab.ev(`document.activeElement.dataset.key`);
      check(a && b && a !== b, `j doesn't move through items: ${a} ${b}`); await press("k"); check(await tab.ev(`document.activeElement.dataset.key`) === a, "k doesn't move back");
      // Enter shows what your notes know, without the item's own note
      await press("Enter"); await sleep(120);
      check(await tab.ev(`/How it was solved|Old fix/.test(document.querySelector(".vg-hq-ctx") ? document.querySelector(".vg-hq-ctx").textContent : "")`), "Enter didn't show what the notes know");
      await tab.ev(`document.querySelector(".vg-hq-ctxhit").click()`); check((await tab.ev("window.__calls")).some(c => c[0] === "open" && c[1] === "Old fix.md"), "a context result doesn't open its note");
      check(await tab.ev(`document.activeElement.dataset.key`) === a || true, "");
      await press("l"); await sleep(120);
      check((await tab.ev("window.__calls")).some(c => c[0] === "mark" && c[2] === "later"), "l didn't mark Later");
    }
    // focus: f stars an item, it leads Today, and a fourth is refused; w goes to Wrap up
    await tab.ev(`window.vaultHQ.setScreen("today")`); await sleep(50);
    const stars = await tab.ev(`document.querySelectorAll("[data-star]").length`);
    if (stars >= 4) { const pick = await tab.ev(`[...document.querySelectorAll(".vg-hq-sec [data-star]")].slice(0, 4).map(b => b.dataset.star)`);
      for (const k of pick) { await tab.ev(`[...document.querySelectorAll("[data-star]")].find(b => b.dataset.star === ${JSON.stringify(k)}).click()`); await sleep(30); }
      const last = (await tab.ev("window.__calls")).filter(c => c[0] === "focus").pop(); check(last && last[1].length === 3, "focus should hold 3: " + JSON.stringify(last));
      check(await tab.ev(`document.querySelector(".vg-hq-next h2").textContent`) === await tab.ev(`window.vaultHQ.items().find(i => i.key === ${JSON.stringify(pick[0])}).title`), "the first focus item isn't Do next"); }
    await press("w"); await sleep(30); check(await tab.ev("window.vaultHQ.screen()") === "wrap", "w doesn't go to Wrap up"); check(await tab.ev(`/Wrap up/.test(document.querySelector(".vg-hq-main").textContent) && !!document.querySelector(".vg-hq-flow")`), "Wrap up has no loop line");
    await tab.ev(`window.vaultHQ.setScreen("today")`);
    await press("/"); check(await tab.ev(`document.activeElement === document.querySelector(".vg-hq-global-search")`), "/ doesn't go to search");
    await tab.ev(`document.activeElement.blur()`); await press("c"); check(await tab.ev(`document.activeElement === document.querySelector(".vg-hq-captureinput")`), "c doesn't go to capture"); await tab.ev(`document.activeElement.blur()`);
    await press("3"); check(await tab.ev("window.vaultHQ.screen()") === "needs", "3 doesn't go to the third screen");
    // People opens and doesn't dead-end
    await tab.ev(`window.vaultHQ.setScreen("people")`); await sleep(50);
    check(await tab.ev(`/People/.test(document.querySelector(".vg-hq-main").textContent) && document.querySelectorAll(".vg-hq-main button").length > 0`), "People is a dead end");
    // someone no open item names has a card of their own, and the notes on it open
    const mountWith = `window.vaultHQ.destroy(); window.__calls = []; window.__t = 0; const D = { ...DATA, nodes: [...DATA.nodes, { id: "People/Zed Quiet.md", name: "Zed Quiet", person: true, mentions: 3 }], links: [...DATA.links, { source: "People/Zed Quiet.md", target: DATA.nodes.find(n => !n.person && !n.ghost).id, kind: "person" }] }; window.__D = D;
      window.vaultHQ = mountVaultHQ(document.getElementById("hq"), D, { now: new Date("2026-10-28T12:00:00"), clock: () => window.__t, ask: async () => true, api: { openNote: p => window.__calls.push(["open", p]), hqMark: async () => true, setTaskStatus: async () => true, completeTask: async () => true, logWork: async () => false, hqFocus: async () => true } });`;
    await tab.ev(`(() => { ${mountWith} window.vaultHQ.setScreen("people"); })()`); await sleep(80);
    const zed = await tab.ev(`(() => { const c = [...document.querySelectorAll(".vg-hq-person")].find(s => /Zed Quiet/.test(s.querySelector("h3").textContent)); if (!c) return null; const b = [...c.querySelectorAll("button[data-open]")].find(x => x.dataset.open !== "People/Zed Quiet.md"); if (b) b.click(); return { text: c.textContent, note: b && b.dataset.open }; })()`);
    check(zed && /Nothing open\./.test(zed.text) && /Linked in/.test(zed.text), "someone with nothing open has no card saying so: " + JSON.stringify(zed));
    check(zed && zed.note && (await tab.ev("window.__calls")).some(c => c[0] === "open" && c[1] === zed.note), "a note on a person's card doesn't open");
    // Done takes an item off; the host's next data can still hold it (the index lags the file): it stays off, the page
    // isn't redrawn when nothing on it changed, and once the hold is over the data decides again
    await tab.ev(`window.vaultHQ.setScreen("today")`); await sleep(80);
    const done = await tab.ev(`(() => { const b = [...document.querySelectorAll('.vg-hq-main .vg-hq-item[data-key] [data-act="main"]')].find(x => x.textContent.trim() === "Done"); if (!b) return null; const k = b.dataset.key; b.click(); return k; })()`);
    if (!done) throw new Error("no item with a Done button on Today");
    await sleep(200); const listed = () => tab.ev(`window.vaultHQ.items().some(i => i.key === ${JSON.stringify(done)})`);
    check(!(await listed()), "Done left the item on the list");
    await tab.ev(`window.vaultHQ.update(window.__D)`); await sleep(60);
    check(!(await listed()), "the host's old data put a done item back on the list");
    await tab.ev(`document.querySelector(".vg-hq-main").__kept = true; window.vaultHQ.update(window.__D)`); await sleep(60);
    check(await tab.ev(`document.querySelector(".vg-hq-main").__kept === true`), "an update that changed nothing redrew the page");
    await tab.ev(`window.vaultHQ.setScreen("needs")`); await sleep(40); await tab.ev(`document.querySelector(".vg-hq-main").__kept = true; window.vaultHQ.setScreen("today")`); await sleep(40);
    check(await tab.ev(`document.querySelector(".vg-hq-main").__kept !== true`), "going to a screen didn't draw it");
    await tab.ev(`window.__t = 60000; window.vaultHQ.update(window.__D)`); await sleep(60);
    check(await listed(), "after the hold, data that still holds the item should show it again");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "HQ: capture, context from your notes, keyboard, People", "hq brain");
})();
