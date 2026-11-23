#!/usr/bin/env node
// Every card in Home's carousel has a button that opens what it is about, and its heading says what it is in plain words (not "Weather" or "Keystones").
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.hqPage("") });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultHQ ? 1 : 0", 20000)) throw new Error("HQ didn't mount");
    await tab.ev(`window.vaultHQ.setScreen("home")`);   // the page's own mount: it has the note actions the headless remount lacks
    await sleep(300);
    const cards = await tab.ev(`[...document.querySelectorAll(".vg-hq-feed article, .vg-hq-feedcard")].map(a => ({ eyebrow: (a.querySelector(".vg-hq-eyebrow")||{}).innerText || "", buttons: a.querySelectorAll("button").length, opens: [...a.querySelectorAll("button")].filter(b => /^open$/i.test(b.innerText.trim())).length }))`);
    check(cards.length >= 3, `Home has carousel cards to check: ${cards.length}`);
    for (const c of cards) {
      check(c.buttons > 0, `"${c.eyebrow.replace(/\s+/g, " ").trim()}" has no button to open what it is about`);
      check(c.opens <= 1, `"${c.eyebrow.trim()}" has ${c.opens} Open buttons`);
      check(!/^(weather|keystones)\b/i.test(c.eyebrow.trim()), `"${c.eyebrow.replace(/\s+/g, " ").trim()}" is an author's word, not a plain description`);
    }
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "Home's carousel cards have plain headings and something to open", "home cards plain");
})();
