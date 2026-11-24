#!/usr/bin/env node
// One word for the rank: "most connecting" (how many routes between other notes run through a note). The 3D persona round (0.6.229)
// found the sidebar saying "#1 influence" in one place and "#1 most connecting" in another for the same number, and a person can't tell
// they are the same. The word "influence" stays out of everything shown (code comments may use it).
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
(async () => {
  const dirs = ["src/view", "src/hq", "src"], seen = new Set(), hits = [];
  for (const d of dirs) for (const f of fs.readdirSync(path.join(build.ROOT, d))) {
    const p = path.join(d, f); if (!/\.js$/.test(f) || seen.has(p)) continue; seen.add(p);
    fs.readFileSync(path.join(build.ROOT, p), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");   // a comment may say influence
      if (/(?<![A-Za-z])influence(?![A-Za-z])/i.test(code)) hits.push(`${p}:${i + 1}`);
    });
  }
  check(seen.size > 10, "the scan read the source files (the check can't pass without them): " + seen.size);
  check(hits.length === 0, "the word 'influence' is shown to people in: " + hits.join(", "));
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`document.querySelector('.vg-tab[data-tab="insights"]').click()`); await sleep(400);
    const text = await tab.ev(`document.querySelector('[data-panel="insights"]').textContent`);
    check(/#\d+ most connecting/.test(text), "Insights ranks notes as '#N most connecting'");
    check(!/influence/i.test(text), "Insights doesn't say influence");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "the rank has one name everywhere");
})();
