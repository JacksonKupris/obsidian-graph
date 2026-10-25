#!/usr/bin/env node
// A vault with no analysis file: the plugin builds its graph itself (engineData over Obsidian's index; liveMerge on
// top). Drives the built plugin over the sample vault's notes with a stand-in Obsidian, and checks the engine's topics
// against the Python analysis's for the same notes (fixtures/sample-graph.json).
//   node tests/test_engine_data.js        exit 0 = pass
const env = require("./env"), stub = require("./plugin_stub");
const fails = [], check = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
(async () => {
  const { Plugin, TFile } = stub.load(env.rules);
  const app = stub.fakeVault(env.dir(), TFile);
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { dataPath: "_scripts/out/vault-graph.json", script: "_scripts/vault_graph.py", rulesPath: "_scripts/vault_graph_rules.json" } });
  p.saveSettings = async () => {}; p.writeLiveDiag = () => {}; p.sceneBlocks = async () => [];
  const data = await p.graphData();
  check("no analysis file: the graph comes from the engine", !!(data && data.engine), true);
  if (data) {
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
