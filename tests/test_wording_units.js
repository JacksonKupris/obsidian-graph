#!/usr/bin/env node
// Blind spots counts "daily notes", as the sidebar does (not "times"); Duplicates does not promise a merge loses nothing (persona round 3, skeptic).
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
(async () => {
  const tab = await openPage({ html: env.pageWith("", env.data()) }), ev = e => tab.ev(e);
  try {
    if (!await tab.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await ev(`document.querySelectorAll(".vg-tour, .vg-tour-card").forEach(x => x.remove())`);
    for (const [v, bad, why] of [["blind", /named \d+ times? without a link/, "Blind spots counts daily notes, the sidebar's unit"], ["duplicates", /nothing is lost/, "Duplicates should not promise nothing is lost"]]) {
      await ev(`${D}.openView("lens:${v}")`); await sleep(1200);
      const t = await ev(`(document.querySelector(".vg-lens") || {}).innerText || ""`);
      check(t.length > 40, `${v} opened`);
      check(!bad.test(t), why + " (" + (t.match(bad) || [""])[0] + ")");
    }
    check(!/nothing is lost/.test(require("fs").readFileSync(require("path").join(__dirname, "..", "src", "view", "60-lenses.js"), "utf8")), "Duplicates text must not claim a merge loses nothing");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "Counts and promises in Blind spots and Duplicates");
})();
