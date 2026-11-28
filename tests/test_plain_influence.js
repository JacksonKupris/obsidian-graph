#!/usr/bin/env node
// "Betweenness" is graph-theory jargon: the Display panel's size choice and the Bridge notes line in the report say what it means
// in plain words (how many routes between topics run through a note) and not the word.
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    check(await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000), "the graph must mount");
    await sleep(400);
    const opt = await tab.ev(`(() => { const o = document.querySelector('.vg-root option[value="bc"]'); return o ? o.textContent : null; })()`);
    check(opt !== null, "the Display panel must still offer the influence size, or this test reads nothing");
    check(opt === null || !/betweenness/i.test(opt), `the size choice must not use the word betweenness: "${opt}"`);
  } finally { await tab.close(); }
  const written = fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8").split("\n").filter(l => /L\.push\(/.test(l) && /betweenness/i.test(l));
  check(!written.length, `the report must not say betweenness: ${written.map(l => l.trim().slice(0, 90)).join(" | ")}`);
  finish(fails, "influence is described in plain words", "plain influence");
})();
