// select.js - which steps of tests/run.js a run needs (run.js --only, --changed). Pure: no git, no files, so
// test_select.js can check it. Nothing here is a list of tests: what a test depends on is read from its own source.
//
// An area is a part of the source that some tests load and others don't. A changed file belongs to an area (files),
// and a test uses an area when its source names one of the area's loaders (uses). A changed file in no area is shared
// by everything (the rules, the shared parts, the build, the test kit, the fixtures), and every test runs.
const AREAS = [
  { name: "hq", files: /^src\/hq(\/|\.css$)/, uses: /\bhq(Page|Data)\b|buildHQPage/ },
  { name: "graph", files: /^src\/(view\/|scenes\/|view\.css$|tour\.js$)/, uses: /\benv\.page\b|\bpageWith\b|\bviewSource\b|\bviewParts\b|\bbuildPage\b|src\/view\b/ },
  { name: "plugin", files: /^src\/(plugin\/|actions\.js$)/, uses: /\bplugin_stub\b|\bpluginSource\b|\bactionsSource\b/ },
  { name: "analysis", files: /^src\/(engine|science)\.js$/, uses: /\bengineSource\b|\bscienceSource\b|src\/(engine|science)\b/ },
  { name: "scripts", files: /^(scripts|\.github)\//, uses: /\bscripts\/|\.github\b/ },
];
const DOCS = /\.md$|^docs\/|^LICENSE$|^\.gitignore$/;   // read by people, loaded by no test
const ALWAYS = ["main.js", "rules.js", "test_rules.js"];   // the build parses, and the code keeps its rules: seconds, on every run

const bare = s => String(s).trim().replace(/^tests[\\/]/, "").replace(/\.js$/, "").replace(/^test_/, "");

// --only a,b: the named steps ("lens_load", "test_lens_load", "test_lens_load.js" all name one). A name that matches
// nothing is an error, so a typo can't pass as "0 failed".
function pickOnly(wanted, steps) {
  const by = new Map(steps.map(s => [bare(s), s])), names = [], unknown = [];
  wanted.map(w => w.trim()).filter(Boolean).forEach(w => { const s = by.get(bare(w)); if (s) names.push(s); else unknown.push(w); });
  return { names: [...new Set(names)], unknown };
}

// --changed: the steps a set of changed files needs. sourceOf(step) gives a test's source ("" for a step that isn't a
// test file). Returns { names, why }: names is every step when a shared file changed.
function pickChanged(files, steps, sourceOf) {
  const norm = files.map(f => f.replace(/\\/g, "/")).filter(Boolean), touched = new Set(), direct = new Set();
  for (const f of norm) {
    if (DOCS.test(f)) continue;
    const own = /^tests\/([^/]+\.js)$/.exec(f);
    if (own && steps.includes(own[1])) { direct.add(own[1]); continue; }
    const a = AREAS.find(x => x.files.test(f));
    if (!a) return { names: [...steps], why: `${f} is shared by every test` };
    touched.add(a.name);
  }
  const areas = AREAS.filter(a => touched.has(a.name));
  const names = steps.filter(s => { if (ALWAYS.includes(s) || direct.has(s)) return true; if (!areas.length) return false;
    const src = sourceOf(s) || "", used = AREAS.filter(a => a.uses.test(src));
    return !used.length || used.some(a => touched.has(a.name)); });   // a test that names no area could depend on any
  const why = [areas.length ? "changed: " + areas.map(a => a.name).join(", ") : "", direct.size ? "changed tests: " + [...direct].join(", ") : ""].filter(Boolean).join("; ") || "nothing a test loads changed";
  return { names, why };
}

module.exports = { AREAS, ALWAYS, pickOnly, pickChanged };
