#!/usr/bin/env node
// Ticked rows of a map report, applied by the plugin: each kind of row does what it says through the write primitives, an unticked
// row is left alone, a row already done or no longer possible says so, and running it twice changes nothing.
//   node tests/test_map_apply.js        exit 0 = pass
const env = require("./env"), stub = require("./plugin_stub"), assert = require("assert");
const row = (mark, act) => `- [${mark}] x %%act:${JSON.stringify(act)}%%`;
(async () => {
  const { Plugin, TFile } = stub.load(env.rules);
  const files = new Map(), mk = (path, text) => { const f = Object.assign(new TFile(), { path, name: path.split("/").pop(), basename: path.split("/").pop().replace(/\.md$/, ""), extension: "md", stat: { mtime: 1 } }); files.set(path, f); f.text = text; return f; };
  mk("Sys/Map.md", "---\ntags:\n  - meta/moc\n---\n# Map\n- [[Have]]\n"); mk("Sys/Other Map.md", "# Other\n"); mk("Sys/Have.md", "h"); mk("Sys/New.md", "n"); mk("Sys/Tagged.md", "---\ntags:\n  - a\n---\nt"); mk("Stray.md", "s");
  const cores = ["Sys/T1.md", "Sys/T2.md", "Sys/T3.md"]; cores.forEach(p => mk(p, "c"));
  const fm = f => { const m = /^---\n([\s\S]*?)\n---/.exec(f.text); return m ? { tags: [...m[1].matchAll(/^\s+- (.+)$/gm)].map(x => x[1]) } : undefined; };
  const writes = [], app = { vault: { getAbstractFileByPath: p => files.get(p) || (p === "Sys" || p === "Dest" ? { path: p } : null), getMarkdownFiles: () => [...files.values()], read: async f => f.text, createFolder: async p => { writes.push(["folder", p]); }, create: async (p, t) => { writes.push(["create", p]); return mk(p, t); }, modify: async (f, t) => { writes.push(["modify", f.path]); f.text = t; }, process: async (f, fn) => { f.text = fn(f.text); }, cachedRead: async f => f.text, adapter: {} },
    metadataCache: { getFileCache: f => ({ frontmatter: fm(f) }) },
    fileManager: { renameFile: async (f, dest) => { writes.push(["rename", f.path, dest]); files.delete(f.path); f.path = dest; files.set(dest, f); }, processFrontMatter: async (f, fn) => { const o = fm(f) || {}; fn(o); writes.push(["tag", f.path, o.tags]); f.text = `---\ntags:\n${o.tags.map(t => `  - ${t}`).join("\n")}\n---\n${f.text.replace(/^---\n[\s\S]*?\n---\n/, "")}`; } } };
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: {} });
  p.graphData = async () => ({ nodes: cores.map(id => ({ id, cluster: 5, bc: 0.1 })), mocs: [] });
  const report = mk("Reports/MOC Alignment.md", [
    row("x", { op: "add", moc: "Sys/Map.md", note: "Sys/New.md" }), row("x", { op: "add", moc: "Sys/Map.md", note: "Sys/Have.md" }), row(" ", { op: "add", moc: "Sys/Map.md", note: "Sys/T1.md" }), row("-", { op: "add", moc: "Sys/Map.md", note: "Sys/T2.md" }),
    row("x", { op: "tag", path: "Sys/Tagged.md", tag: "meta/hub" }), row("x", { op: "tag", path: "Gone/Tagged.md", tag: "b" }), row("x", { op: "tag", path: "Gone/Nope.md", tag: "b" }),
    row("x", { op: "move", path: "Stray.md", to: "Dest" }), row("x", { op: "merge", path: "Sys/Other Map.md", into: "Sys/Map.md", links: ["Sys/Have.md", "Sys/T3.md"] }),
    row("x", { op: "create", cluster: 99, path: "Sys/Topic MOC.md", name: "Topic", core: cores }), row("x", { op: "create", cluster: 99, path: "Sys/Lost MOC.md", name: "Lost", core: ["Sys/None.md", "Sys/Nor.md"] }),
    row("x", { op: "bridge", a: 1, b: 2, moc_a: "Sys/Map.md", moc_b: null, name_a: "A", name_b: "B", core_a: ["Sys/T1.md"], core_b: ["Sys/T2.md"], suggest: [["Sys/T1.md", "Sys/T2.md"]] }), row("x", { op: "bridge", a: 1, b: 1, moc_a: null, moc_b: null, name_a: "A", name_b: "A", core_a: [], core_b: [], suggest: [] }),
    "- [x] broken %%act:{nope}%%", row("x", { op: "somethingNew" }) ].join("\n"));
  const first = await p.applyMapRows(report), map = files.get("Sys/Map.md").text, inbox = env.rules.folders.inbox;
  assert(/## Also in this topic \(added .*\)\n\n- \[\[New\]\]/.test(map), "a ticked note is added to its map"); assert.strictEqual((map.match(/\[\[Have\]\]/g) || []).length, 1, "a note the map lists isn't added again");
  assert(!map.includes("[[T1]]") && !map.includes("[[T2]]"), "unticked and skipped rows are left alone");
  assert(/- meta\/hub/.test(files.get("Sys/Tagged.md").text) && /- a\n/.test(files.get("Sys/Tagged.md").text), "a tag is added and the note keeps its tags");
  assert(/skipped tag on Gone\/Nope\.md/.test(first), "a note that's gone is reported"); assert(files.has("Dest/Stray.md") && !files.has("Stray.md"), "a move goes through the rename that updates links");
  assert(/Superseded by \[\[Map\]\]/.test(files.get("Sys/Other Map.md").text) && map.includes("[[T3]]"), "a merge marks the other map and carries its new links over");
  assert(files.has("Sys/Topic MOC.md") && /%% vault-graph:generated/.test(files.get("Sys/Topic MOC.md").text), "a topic with enough of its notes gets a map"); assert(/skipped create Sys\/Lost MOC\.md/.test(first) && !files.has("Sys/Lost MOC.md"), "a topic that's moved on isn't given a map");
  const bridge = `${inbox}/Bridge — A ↔ B.md`; assert(files.has(bridge) && /type: bridge/.test(files.get(bridge).text), "a bridge is drafted in the inbox"); assert(/skipped bridge A with itself/.test(first), "a topic isn't bridged to itself");
  assert(/can't be read/.test(first) && /unknown kind: somethingNew/.test(first), "a row it can't act on is reported, not guessed at"); assert(/2 unticked rows left alone/.test(first), `it counts what it left alone: ${first}`);
  const before = JSON.stringify([...files.values()].map(f => [f.path, f.text])), n = writes.length, second = await p.applyMapRows(report);
  assert.strictEqual(JSON.stringify([...files.values()].map(f => [f.path, f.text])), before, "applying twice changes nothing"); assert.strictEqual(writes.length, n); assert(/already done/.test(second));
  console.log("ok - map report: each kind of ticked row applies, unticked rows stay, the rest is reported, and twice changes nothing");
})().catch(e => { console.log("FAIL - map report: " + e.message); process.exit(1); });
