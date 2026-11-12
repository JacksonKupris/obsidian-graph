#!/usr/bin/env node
// The plugin's self-update: when a release is newer, what is written, and that a bad or partial download changes nothing.
// Runs the real src/release.js and src/plugin/85-update.js against stand-ins for Obsidian's requestUrl, vault adapter and plugin manager.
const assert = require("assert"), vm = require("vm"), fs = require("fs"), path = require("path");
const build = require("../build"), rules = build.loadRules();
const src = build.releaseSource() + "\n" + fs.readFileSync(path.join(__dirname, "../src/plugin/85-update.js"), "utf8") + "\nthis.VGRelease = VGRelease; this.VaultGraphUpdater = VaultGraphUpdater;";

// --- the rules on their own
const R = new Function(build.releaseSource() + "\nreturn VGRelease;")();
assert.ok(R.newer("0.6.86", "0.6.85") && R.newer("0.7.0", "0.6.99") && R.newer("1.0.0", "0.99.99"));
assert.ok(!R.newer("0.6.85", "0.6.85") && !R.newer("0.6.84", "0.6.85"), "same or older is not an update");
assert.ok(!R.newer("0.6.86-beta", "0.6.85") && !R.newer("nightly", "0.6.85"), "only plain x.y.z counts");
assert.ok(R.newer("0.6.10", "0.6.9"), "compared as numbers, not text");
const manifest = v => JSON.stringify({ id: "jk-vault-graph", version: v });
const good = v => ({ "main.js": "module.exports = class {};", "manifest.json": manifest(v), "styles.css": ".a{}" });
assert.strictEqual(R.problem({ tag_name: "0.6.86" }, good("0.6.86"), "jk-vault-graph"), null);
assert.match(R.problem({ tag_name: "0.6.86" }, good("0.6.85")), /carries manifest 0.6.85/);
assert.match(R.problem({ tag_name: "0.6.86" }, { ...good("0.6.86"), "styles.css": "" }), /no styles.css/);
assert.match(R.problem({ tag_name: "0.6.86" }, { ...good("0.6.86"), "main.js": "<html>404</html>" }), /isn't a plugin/);
assert.match(R.problem({ tag_name: "0.6.86" }, good("0.6.86"), "other-plugin"), /not "other-plugin"/);

// --- the updater, with the app stood in
function world({ running = "0.6.85", latest = "0.6.86", serve = good, failOn, auto, release } = {}) {
  const disk = { "p/main.js": "OLD", "p/manifest.json": manifest(running), "p/styles.css": "OLD" }, notices = [], calls = [], settings = auto === undefined ? {} : { autoUpdate: auto };
  const rel = release || { tag_name: latest, assets: R.FILES.map(f => ({ name: f, browser_download_url: "u/" + f })) };
  const ctx = {
    window: { setInterval: () => 1 }, setTimeout: fn => fn(), Date, console,
    Notice: class { constructor(m) { notices.push(m); } },
    requestUrl: async ({ url }) => {
      if (failOn && url.includes(failOn)) throw new Error("Request failed, status 500");
      return url.includes("releases/latest") ? { json: rel } : { text: serve(rel.tag_name)[url.slice(2)] };
    },
  };
  vm.runInNewContext(src, ctx);
  const plugin = {
    manifest: { id: "jk-vault-graph", version: running, dir: "p" }, settings, saveSettings: async () => calls.push("saved"),
    app: { vault: { adapter: {
      write: async (p, t) => { disk[p] = t; }, exists: async p => p in disk, remove: async p => { delete disk[p]; },
      rename: async (a, b) => { disk[b] = disk[a]; delete disk[a]; } } },
      plugins: { loadManifests: async () => calls.push("manifests"), disablePlugin: async () => calls.push("off"), enablePlugin: async () => calls.push("on") },
      workspace: { onLayoutReady: fn => fn() } },
    addCommand: c => calls.push("command:" + c.id), registerInterval: () => calls.push("interval"),
  };
  return { up: new ctx.VaultGraphUpdater(plugin), plugin, disk, notices, calls };
}
(async () => {
  // a newer release: all three files replaced, reloaded in order, the settings file untouched
  let w = world();
  assert.strictEqual(await w.up.check(), "updated");
  assert.strictEqual(w.disk["p/main.js"], good("0.6.86")["main.js"]);
  assert.strictEqual(JSON.parse(w.disk["p/manifest.json"]).version, "0.6.86");
  assert.ok(!Object.keys(w.disk).some(k => k.endsWith(".new")), "no half-written file is left");
  assert.deepStrictEqual(w.calls.filter(c => c !== "saved"), ["manifests", "off", "on"], "the manifest is read again before the reload");
  assert.match(w.notices[0], /updated 0\.6\.85 to 0\.6\.86/);
  // the same version: nothing is written, and the automatic check stays quiet
  w = world({ latest: "0.6.85" });
  assert.strictEqual(await w.up.check(), "current");
  assert.strictEqual(w.disk["p/main.js"], "OLD"); assert.strictEqual(w.notices.length, 0);
  // a download that fails partway: the running files stay whole
  w = world({ failOn: "styles.css" });
  assert.strictEqual(await w.up.check({ manual: true }), "failed");
  assert.deepStrictEqual([w.disk["p/main.js"], w.disk["p/styles.css"]], ["OLD", "OLD"]);
  assert.match(w.notices.join(), /couldn't update/);
  // a release whose manifest isn't its tag, or isn't this plugin: nothing written
  for (const serve of [() => good("0.6.99"), v => ({ ...good(v), "manifest.json": JSON.stringify({ id: "x", version: v }) })]) {
    w = world({ serve }); assert.strictEqual(await w.up.check(), "failed"); assert.strictEqual(w.disk["p/main.js"], "OLD");
  }
  // a release missing a file
  w = world({ release: { tag_name: "0.6.86", assets: [{ name: "main.js", browser_download_url: "u/main.js" }] } });
  assert.strictEqual(await w.up.check(), "failed"); assert.strictEqual(w.disk["p/main.js"], "OLD");
  // auto-update off: it says one is out and installs nothing; the command still installs
  w = world({ auto: false });
  assert.strictEqual(await w.up.check(), "found"); assert.strictEqual(w.disk["p/main.js"], "OLD"); assert.match(w.notices[0], /0\.6\.86 is out/);
  assert.strictEqual(await w.up.check({ manual: true }), "updated");
  // offline on a background check says nothing; by hand it says why
  w = world({ failOn: "releases/latest" });
  assert.strictEqual(await w.up.check(), "failed"); assert.strictEqual(w.notices.length, 0);
  // start() registers the command and the interval
  w = world(); w.up.start(); assert.ok(w.calls.includes("command:update") && w.calls.includes("interval"));

  // the wiring: the built plugin carries the rules and the updater, starts it in onload, and shows the setting
  const main = build.buildPlugin(rules)["main.js"];
  assert.ok(main.includes("const VGRelease =") && main.includes("class VaultGraphUpdater"), "main.js must bundle both");
  assert.ok(main.indexOf("const VGRelease =") < main.indexOf("class VaultGraphUpdater"), "the rules come before the updater");
  assert.ok(/this\.updater = new VaultGraphUpdater\(this\); this\.updater\.start\(\)/.test(main), "onload must start the updater");
  assert.ok(main.includes('setName("Update automatically")'), "the setting must be shown");
  assert.ok(/requestUrl \} = require\("obsidian"\)/.test(main), "requestUrl must be imported");
  console.log("ok - self-update: newer releases install whole, bad or partial downloads change nothing, the setting and wiring are in main.js");
})().catch(e => { console.error(e); process.exit(1); });
