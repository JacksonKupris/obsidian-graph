#!/usr/bin/env node
// Who looks at which view. Reads the page's own view list, so a view added later is assigned without anyone editing a list.
// Every view goes to the personas below by its kind; `--check` exits 1 if any view has fewer than 3 personas.
//   node scripts/persona_plan.js [--check] [--out .out/persona/plan.md]
const fs = require("fs"), path = require("path");
const { openPage } = require("../tests/kit"), env = require("../tests/env");

// Every view: the two personas who test what every view must do. Then by kind, who adds a different angle.
// the sense-making group asks whether a screen makes sense (what is it, is it worth my time, could I explain and trust it); each runs on every view
const SENSE = ["persona-bewildered", "persona-returning", "persona-explainer"];
const ALL = ["persona-phone", "persona-keyboard", ...SENSE];
const BY_KIND = {
  scene: ["persona-first-timer", "persona-design-motion-feel", "persona-design-first-impression"],
  lens: ["persona-skeptic", "persona-findability", "persona-architect", "persona-power-user", "persona-design-hierarchy"],
  default: ["persona-first-timer", "persona-skeptic", "persona-design-hierarchy"],
};
const forKind = k => [...new Set([...ALL, ...(BY_KIND[k] || BY_KIND.default)])];

async function views() {
  const tab = await openPage({ html: env.pageWith("", env.data()) });
  try {
    if (!await tab.waitFor(`window.vaultGraph && window.vaultGraph._debug ? 1 : 0`, 30000)) throw new Error("the graph didn't mount");
    return await tab.ev(`window.vaultGraph._debug.allViews().map(v => ({ key: v.key, kind: v.kind || "view", name: v.name }))`);
  } finally { await tab.close(); }
}
function plan(vs) {
  const by = {};
  vs.forEach(v => forKind(v.kind).forEach(p => (by[p] = by[p] || []).push(v)));
  return { by, thin: vs.filter(v => forKind(v.kind).length < 3) };
}
module.exports = { forKind, plan, views };
if (require.main === module) (async () => {
  const vs = await views(), { by, thin } = plan(vs);
  const md = ["# Persona plan", "", `${vs.length} views, assigned by kind from the page's own registry.`, "", ...Object.entries(by).map(([p, l]) => `## ${p} (${l.length})\n${l.map(v => `${v.key} (${v.name || v.kind})`).join(", ")}`)].join("\n");
  const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : env.out("persona-plan.md");
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, md + "\n");
  console.log(`${vs.length} views assigned: ${out}`);
  if (thin.length) { console.log("fewer than 3 personas: " + thin.map(v => v.key).join(", ")); process.exit(1); }
})().catch(e => { console.error(e.message); process.exit(1); });
