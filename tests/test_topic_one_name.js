#!/usr/bin/env node
// A topic has one name on every screen. When a topic has a label (the name a person gave it), the topic list, the Maps card, the map's
// topic chips and the labels on the graph all use it; before, the graph and two panels showed the machine-made name instead
// (3D persona round, 0.6.229: "topic names differ between the graph and the sidebar").
const fs = require("fs"), path = require("path");
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env"), build = require("../build");
const { fails, ok: check } = checks();
(async () => {
  // 1. no view draws a cluster's raw name where a person reads it: the shared clusterName decides
  const raw = [];
  for (const f of fs.readdirSync(path.join(build.ROOT, "src/view"))) {
    if (!/\.js$/.test(f)) continue;
    fs.readFileSync(path.join(build.ROOT, "src/view", f), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/const clusterName = .*/, "");   // the one place that picks label or name
      if (/clusterById\[[^\]]*\]\.name|\(clusterById\[[^\]]*\] \|\| \{ name: "\?" \}\)\.name|esc\(c\.name\)/.test(code)) raw.push(`${f}:${i + 1}`);
    });
  }
  check(raw.length === 0, "these places show a topic's machine name, not the shared clusterName: " + raw.join(", "));
  // 2. in the page: one cluster gets a label; the list, the Maps card and the aria-labels all use it
  const data = env.data(); const c = data.clusters[0]; c.label = "Zebra Crossing Topic";
  const tab = await openPage({ html: env.pageWith("", data) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    await tab.ev(`document.querySelector('.vg-tab[data-tab="insights"]').click()`); await sleep(400);
    const all = await tab.ev(`document.querySelector('[data-panel="insights"]').innerHTML`);
    check(all.indexOf("Zebra Crossing Topic") >= 0, "Insights shows the topic's label (the check can't pass if the topic isn't there)");
    check(!c.name || all.indexOf(c.name) < 0 || c.name === c.label, "Insights never shows the machine name '" + c.name + "' for the labelled topic");
  } catch (e) { fails.push("crashed: " + e.message); }
  await tab.close(); finish(fails, "a topic has one name everywhere");
})();
