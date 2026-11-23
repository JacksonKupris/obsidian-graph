#!/usr/bin/env node
// Persona rerun of Home (0.6.191), round A: cards you can act on come first, the order is stated, and each Open button names what it opens.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`);
    await sleep(500);
    const cards = await tab.ev(`JSON.stringify([...document.querySelectorAll(".vg-hq-feedcard")].map(c => ({
      title: (c.querySelector("h2") || {}).textContent || "",
      acts: +c.dataset.acts,
      opens: [...c.querySelectorAll("[data-open]")].map(b => ({ text: b.textContent.trim(), label: b.getAttribute("aria-label") || "" })) })))`);
    const list = JSON.parse(cards);
    check(list.length > 1, `Home shows several cards to order (got ${list.length})`);
    const firstReadOnly = list.findIndex(c => !c.acts);
    check(firstReadOnly < 0 || list.slice(firstReadOnly).every(c => !c.acts), "a card with actions sits below a read-only card");
    list.forEach(c => c.opens.forEach(o => check(o.label.length > o.text.length && o.label.startsWith(o.text) && o.label.includes(c.title.slice(0, 12)), `the Open button on "${c.title}" doesn't name what it opens (label "${o.label}")`)));
    const text = await tab.ev(`document.querySelector(".vg-hq").innerText`);
    check(/Cards you can act on come first/.test(text), "Home says how its cards are ordered");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Home cards: actions first, order stated, Open names its target", "home card order");
})();
