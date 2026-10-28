const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../src/view/50-cosmos.js"), "utf8");
const start = source.indexOf("  function cosmosCapture()");
const end = source.indexOf("  // ---- orbital mechanics", start);
function capture(bodies) {
  const ids = ["A", "B", "via", "nearB", "tie", "third", "fourth", "blocked", "planetOnly"];
  const nodes = ids.map(id => ({ id, x: 100, y: 100 }));
  const neighbours = { A: ["via", "tie", "blocked"], via: ["nearB"], B: ["nearB", "tie"], nearB: ["third"], third: ["fourth"] };
  const context = {
    cos: { bodies, auto: { nebula: false } }, active: nodes, nodes,
    GM_GAL: 1,
    special: () => false, graphNb: id => new Set(neighbours[id] || []),
    anchorNb: id => new Set(neighbours[id] || []), links: [], mocMembers: {},
    byId: Object.fromEntries(nodes.map(n => [n.id, n])),
    bhTest: () => n => n.id === "blocked",
    matchQuery: () => n => n.id === "planetOnly",
    initOrbit: (n, c) => { n.orb = { b: c.b.id, role: "orbit" }; },
  };
  vm.createContext(context);
  vm.runInContext(`let capture, repelled, bodyCaptured;\n${source.slice(start, end)}\ncosmosCapture(); result = [...capture].map(([id,c]) => [id, c.b.id, c.ring]);`, context);
  return new Map(context.result.map(([id, body, ring]) => [id, { body, ring }]));
}
const a = { id: "starA", type: "star", target: "A" };
const b = { id: "starB", type: "star", target: "B" };
const hole = { id: "hole", type: "blackhole" };
const planet = { id: "planet", type: "planet" };
const first = capture([a, b, hole, planet]), reversed = capture([b, a, hole, planet]);
assert.equal(first.get("nearB").body, "starB");
assert.equal(first.get("nearB").ring, 1);
assert.equal(first.get("tie").body, "starA");
assert.deepEqual([...first].sort(), [...reversed].sort());
assert.equal(first.get("blocked").body, "hole");
assert.equal(first.get("planetOnly").body, "planet");
assert.equal(first.get("fourth").ring, 3);
assert.ok(!first.has("A") && !first.has("B"));
const single = capture([a, hole, planet]);
assert.ok(!single.has("fourth"));
assert.equal(single.get("nearB").ring, 2);
console.log("ok - nearest star, deterministic ties, anchors, three-hop limit, black-hole priority and planets");
