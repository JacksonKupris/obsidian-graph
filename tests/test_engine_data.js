#!/usr/bin/env node
// A vault with no analysis file: the plugin builds its graph itself (engineData over Obsidian's index; liveMerge on
// top). Drives the built plugin over the sample vault's notes with a stand-in Obsidian, and checks the engine's topics
// against the Python analysis's for the same notes (fixtures/sample-graph.json).
//   node tests/test_engine_data.js        exit 0 = pass
const env = require("./env"), stub = require("./plugin_stub");
const cdp = require("./cdp"), fs = require("fs"), path = require("path");
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
(async () => {
  const { Plugin, TFile, VGEngine } = stub.load(env.rules);
  const app = stub.fakeVault(env.dir(), TFile);
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { dataPath: "_scripts/out/vault-graph.json", script: "_scripts/vault_graph.py", rulesPath: "_scripts/vault_graph_rules.json" } });
  p.saveSettings = async () => {}; p.writeLiveDiag = () => {}; p.sceneBlocks = async () => [];
  const realRun = VGEngine.run; VGEngine.run = (name, input) => { p.lastJob = input; return realRun(name, input); };   // keeps what the plugin handed the job, for the worker check below
  const data = await p.graphData();
  VGEngine.run = realRun;
  check("no analysis file: the graph comes from the engine", !!(data && data.engine), true);
  if (data) {
    // the slow step really runs off the main thread in a browser, and gives the same answer as running it here
    if (p.lastJob) { const source = fs.readFileSync(path.join(__dirname, "..", "src", "engine.js"), "utf8");
      const tab = await cdp.open({ html: `<!doctype html><script>${source.replace(/<\/script/gi, "<\\/script")}</script>`, port: 9353 });
      if (tab) { const r = await tab.ev(`(async () => { const input = ${env.inlineJson(p.lastJob)}, here = VGEngine.topicsJob(input), there = await VGEngine.run("topicsJob", input); return JSON.stringify({ via: VGEngine.stats.via, same: JSON.stringify(here) === JSON.stringify(there), topics: there.topics.length }); })()`);
        await tab.close(); const R = JSON.parse(r);
        check("the topics job ran in a worker", R.via, "worker"); check("the worker's answer is the same as running it here", R.same, true); check("the worker found topics", R.topics > 0, true); } }
    else fails.push("the plugin never asked for the topics job");
    const py = env.data(), pyNotes = py.nodes.filter(n => !n.ghost && !n.person && !n.moc), notes = data.nodes.filter(n => !n.ghost && !n.person && !n.moc);
    check("the engine's notes are the analysis's", notes.map(n => n.id).sort(), pyNotes.map(n => n.id).sort());
    check("every note in a topic is in one the data lists", notes.filter(n => n.cluster >= 0 && !data.clusters.some(c => c.id === n.cluster)).map(n => n.id), []);
    check("topics found", data.clusters.length > 0, true);
    check("links between notes", data.links.filter(l => l.kind === "link").length > 0, true);
    // the topics split the notes as the analysis does: for each engine topic, the share of its notes in its commonest
    // analysis topic (Obsidian resolves links a little differently from the analysis, so a few notes may move)
    const pyOf = new Map(pyNotes.map(n => [n.id, n.cluster])), groups = new Map();
    notes.filter(n => n.cluster >= 0).forEach(n => { if (!groups.has(n.cluster)) groups.set(n.cluster, []); groups.get(n.cluster).push(pyOf.get(n.id)); });
    let agree = 0, total = 0;
    groups.forEach(cs => { const c = {}; cs.forEach(x => { c[x] = (c[x] || 0) + 1; }); agree += Math.max(...Object.values(c)); total += cs.length; });
    const share = total ? agree / total : 0;
    if (share < 0.9) fails.push(`topics agree with the analysis on ${Math.round(share * 100)}% of notes, want 90%+`);
    console.log(fails.length ? "FAIL - " + fails.join("\n  ") : `ok - no analysis file: the plugin's own graph (${notes.length} notes, ${data.clusters.length} topics, ${Math.round(share * 100)}% as the analysis)`);
  } else console.log("FAIL - " + fails.join("\n  "));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log("FAIL - " + (e && e.stack || e)); process.exit(1); });
