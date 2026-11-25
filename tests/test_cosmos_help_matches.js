#!/usr/bin/env node
// What Cosmos says matches what it does (explainer persona, 2026-11-25): orbits precess and decay so they aren't "true ellipses",
// a star reaches three links, the first visit places bodies for you, Arrange avoids resonance and bodies don't tug on each other.
const { sleep, checks, finish, openPage } = require("./kit");
const env = require("./env");
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  const { fails, ok: check } = checks();
  try {
    if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`window.__said = []; new MutationObserver(() => document.querySelectorAll(".vg-toast").forEach(t => window.__said.push(t.textContent))).observe(document.body, { subtree: true, childList: true, characterData: true })`);
    await tab.ev(`window.vaultGraph._debug.openView("cosmos")`); await sleep(1500);
    await tab.ev(`document.querySelector(".vg-viewhelp").click()`); await sleep(300);
    const help = await tab.ev(`[...document.querySelectorAll(".vg-viewcard dt, .vg-viewcard dd")].map(e => e.textContent).join(" | ")`);
    check(/Stars, planets, black holes/.test(help), "the Cosmos help card is open (the test can't fail without it): " + help.slice(0, 120));
    check(!/laws hold|true ellipses/i.test(help), "orbits turn and decay, so the help cannot promise that Kepler holds or that they are true ellipses");
    check(/three links/i.test(help), "a star reaches notes up to three links away, and the help says so");
    check(!/You place these/.test(help) && /first visit/i.test(help), "the help says the first stars and the black hole are placed for you");
    check(/180/.test(help), "the help says how old stale is");
    const titles = await tab.ev(`[document.querySelector(".vg-arrangebtn"), document.querySelector('[data-auto="motion"]')].map(b => b ? b.title : "").join(" | ")`);
    check(titles.length > 3, "the Arrange and Orbits buttons have hints");
    check(!/resonant|tug/i.test(titles), "the button hints match the code: " + titles);
    const said = await tab.ev(`window.__said.join(" | ")`);
    check(/Cosmos/.test(said), "the Cosmos message was seen: " + said.slice(0, 120));
    check(!/your maps are stars/i.test(said), "not every map is a star, so the message can't say so");
  } catch (e) { fails.push(e.message); }
  await tab.close();
  finish(fails, "what Cosmos says matches what it does", "cosmos help");
})();
