#!/usr/bin/env node
// The scoreboard for leaving Python: every view in a vault with no analysis file, on the real plugin path (graphData:
// engineData, then liveMerge), against the same view with the analysis's data. What reads Obsidian directly (task
// history, written links, version drift, the guide scan) comes from the real plugin methods on both sides.
//
// EXPECT is a ratchet: it fails if a view gets worse, and also if one gets better without the list being updated, so
// the list is always the honest state. When a stage moves data into the engine, shorten it.
//   node tests/test_no_python.js [--list]        exit 0 = pass; --list prints every view
const { sleep, finish, openPage } = require("./kit");
const env = require("./env"), stub = require("./plugin_stub");
const EXPECT = {
  missing: ["code"],                                                  // needs git, and the analysis's list of repositories
  blank: [],
  thinner: [],
};
const THINNER = 0.8;   // under this share of the text the analysis's version has
// read Obsidian directly (the same on both sides), and the sample has nothing for them to show
const NOT_COMPARED = { control: "needs six weeks of dated tasks", drift: "the sample names no old versions" };

// every lens's state: what it says, whether it's an empty state, and how much is in it. Async lenses settle first.
async function readLenses(data, hooks) {
  const tab = await openPage({ html: env.pageWith(hooks, data) });
  if (!await tab.waitFor("window.vaultGraph && window.vaultGraph._debug ? 1 : 0", 30000)) throw new Error("the page did not mount"); await sleep(800);
  const out = await tab.ev(`(async () => { const D = window.vaultGraph._debug, o = {}, wait = ms => new Promise(r => setTimeout(r, ms));
    for (const k of D.lenses()) { let error = null; try { D.openLens(k); } catch (e) { error = e.message; }
      const body = () => document.querySelector(".vg-lens:not([hidden]) .vg-lens-body");
      for (let i = 0; i < 60; i++) { await wait(100); const b = body(); if (b && b.innerText.trim() && !/^Loading/.test(b.innerText.trim())) break; }
      const b = body(), first = b && b.firstElementChild;
      o[k] = { error, len: b ? b.innerText.length : 0, empty: !!(first && first.classList.contains("vg-empty")), text: b ? b.innerText.replace(/\\s+/g, " ").slice(0, 2000) : "" }; }
    return JSON.stringify(o); })()`);
  await tab.close();
  return JSON.parse(out);
}

(async () => {
  const fails = [], { Plugin, TFile } = stub.load(env.rules), app = stub.fakeVault(env.dir(), TFile);
  app.metadataCache.getCache = p => app.metadataCache.getFileCache({ path: p });
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { dataPath: "_scripts/out/vault-graph.json", script: "_scripts/vault_graph.py", rulesPath: "_scripts/vault_graph_rules.json" } });
  p.saveSettings = async () => {}; p.writeLiveDiag = () => {}; p.sceneBlocks = async () => [];
  const engine = await p.graphData();
  if (!engine || !engine.engine) { console.log("FAIL - no-Python: the plugin didn't build its own graph"); process.exit(1); }
  const hq = env.hqData(), history = await p.taskHistory(), written = p.writtenLinks(), drift = await p.driftScan();
  if (!history.length || !Object.keys(written).length) fails.push(`the sample has no journals (${history.length}) or written links, so views reading them compare nothing`);
  const hooks = `taskHistory: async () => ${env.inlineJson(history)}, writtenLinks: () => (${env.inlineJson(written)}), driftScan: async () => ${env.inlineJson(drift)}, guideScan: async () => (${env.inlineJson(await p.guideScan({ seq: "" }))}),`;
  const q = Object.assign(Object.create(Plugin.prototype), { app, base: env.data(), settings: p.settings }); q.saveSettings = p.saveSettings; q.writeLiveDiag = p.writeLiveDiag; q.sceneBlocks = p.sceneBlocks;
  const full = await readLenses({ ...await q.graphData(), hq }, hooks);
  const own = await readLenses({ ...engine, hq }, hooks);
  const got = { missing: [], blank: [], thinner: [] }, rows = [];
  for (const k of Object.keys(full)) { const a = full[k], b = own[k];
    if (a.error || (b && b.error)) fails.push(`${k} threw: ${a.error || b.error}`);
    const state = !b ? "missing" : b.empty && !a.empty ? "blank" : !a.empty && b.len < a.len * THINNER ? "thinner" : NOT_COMPARED[k] ? "not compared" : a.empty ? "sample too small" : "same";
    if (got[state]) got[state].push(k);
    rows.push(`  ${state.padEnd(17)}${k.padEnd(11)}${String(a.len).padStart(6)}${String(b ? b.len : "-").padStart(6)}  ${b ? b.text.slice(0, 120) : ""}`); if (process.argv.includes("--show") && process.argv.includes(k)) console.log(`--- ${k} with the analysis:\n${a.text}\n--- without:\n${b && b.text}`); }
  for (const k of Object.keys(own)) if (!full[k]) fails.push(`${k} shows only without the analysis`);
  // the analysis's side has to show something, or "same" means nothing here
  const tooSmall = Object.keys(full).filter(k => full[k].empty && !NOT_COMPARED[k]);
  for (const k of Object.keys(NOT_COMPARED)) if (!full[k]) fails.push(`NOT_COMPARED lists ${k}, which no longer exists`); else if (!full[k].empty && full[k].len > 200) fails.push(`${k} can be compared now: take it off NOT_COMPARED`);
  if (tooSmall.length) fails.push(`the sample vault is too small to compare: ${tooSmall.join(", ")}`);
  for (const s of Object.keys(EXPECT)) { const want = [...EXPECT[s]].sort().join(", "), have = got[s].sort().join(", ");
    if (want !== have) fails.push(`${s}: expected [${want}], found [${have}]. A view got worse, or a stage finished and this list needs shortening`); }
  // a view that needs the analysis says that, not something untrue about the vault
  for (const k of got.blank) if (!/needs the analysis/.test(own[k].text)) fails.push(`${k} is blank and says: "${own[k].text}"`);
  if (process.argv.includes("--list") || fails.length) console.log(rows.join("\n"));
  const n = Object.keys(full).length;
  finish(fails, `no-Python scoreboard: of ${n} views, ${got.missing.length + got.blank.length} blank or missing and ${got.thinner.length} thinner without the analysis`, "no-Python");
})().catch(e => { console.log("FAIL - no-Python: " + e.message); process.exit(1); });
