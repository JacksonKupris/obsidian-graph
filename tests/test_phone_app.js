// The phone app: the page plus what makes it installable (manifest, icons, an offline cache), built from the sample vault.
const assert = require("assert"), zlib = require("zlib"), fs = require("fs"), path = require("path");
const build = require("../build"), { phoneApp, iconPng, MANIFEST } = require("../scripts/phone_app");
const rules = build.loadRules(), data = JSON.parse(fs.readFileSync(path.join(build.ROOT, "fixtures", "sample-graph.json"), "utf8"));
const files = phoneApp(data, rules, "9.9.9");

assert.deepStrictEqual(Object.keys(files).sort(), ["icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "sw.js"], "every file the install needs");
const page = files["index.html"];
assert(page.includes('rel="manifest" href="manifest.webmanifest"') && page.includes("serviceWorker.register"), "the page links its manifest and registers the cache");
assert(page.includes("mountVaultGraph"), "it is still the graph page");
assert(page.includes("popstate") && page.includes("g.back()"), "the back gesture closes what is open");
assert(page.includes("app-open") && page.includes("unhandledrejection"), "the page reports that it opened and every error");
// installable: Chrome wants a name, start page, standalone display and 192 and 512 px PNG icons that exist
const m = JSON.parse(files["manifest.webmanifest"]);
assert(m.name && m.start_url && m.display === "standalone", "manifest basics");
for (const need of ["192x192", "512x512"]) { const ic = m.icons.find(i => i.sizes === need); assert(ic && ic.type === "image/png" && files[ic.src], "icon " + need + " is listed and built"); }
// the icons are real PNGs of the right size, not blank
for (const [f, size] of [["icon-192.png", 192], ["icon-512.png", 512]]) {
  const png = files[f]; assert.strictEqual(png.subarray(1, 4).toString(), "PNG", f + " is a PNG"); assert.strictEqual(png.readUInt32BE(16), size, f + " width");
  const raw = zlib.inflateSync(png.subarray(png.indexOf("IDAT") + 4, png.indexOf("IEND") - 8)); assert(new Set(raw).size > 3, f + " has a drawing in it");
}
assert(files["sw.js"].includes("vault-graph-9.9.9") && files["sw.js"].includes("fetch"), "the cache is named by version, so an update replaces it");
// a page with nowhere to put the app parts fails loudly
assert.throws(() => { const real = build.buildPage; build.buildPage = () => "<html>"; try { phoneApp(data, rules, "1") } finally { build.buildPage = real; } }, /no head or body/);
console.log("ok - phone app: installable manifest, real icons, offline cache");
// the command itself writes the icons byte for byte (a text write would corrupt them)
const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "phone-app-"));
require("child_process").execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "phone_app.js"), "--out", tmp]);
assert(fs.readFileSync(path.join(tmp, "icon-192.png")).equals(iconPng(192)), "icon on disk is the icon built");
console.log("ok - phone app: command writes icons intact");
// a phone page has no vault to read: the journals and HQ notes ride inside it, and Task survival reads them there
const { hqFromFolder } = require("../scripts/vault_hq"), env = require("./env");
const got = hqFromFolder(env.dir(), rules);
assert(got.journalHistory.length >= 5 && got.hq.journals.length > 0, "the test vault's journals are read");
assert(fs.readFileSync(path.join(__dirname, "..", "src", "view", "62-science.js"), "utf8").includes("DATA.journalHistory"), "the lenses read the carried journals");
console.log("ok - phone app: journals and HQ notes travel with the page");
// waking the app (unlock, back from another app) catches it up: run the page's live script against stand-ins and watch what it does
(async () => {
  const vm = require("vm"), script = files["index.html"].match(/<script>\(\(\) => \{ let have[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, "");
  let stamp = 1, applied = [], reloads = 0, applyResult = true; const listeners = {};
  const sandbox = { window: { EventSource: function () {}, vaultGraph: { applyLive: d => { applied.push(d); return applyResult; } } }, document: { visibilityState: "visible" },
    addEventListener: (k, f) => { listeners[k] = f; }, location: { reload: () => reloads++ }, fetch: async () => ({ json: async () => ({ stamp, data: { s: stamp } }) }), EventSource: function () { this.set = f => f; } };
  sandbox.window.EventSource = sandbox.EventSource; vm.runInNewContext(script, sandbox);
  const tick = () => new Promise(r => setTimeout(r, 20));
  await tick(); listeners.visibilitychange(); await tick();
  assert.strictEqual(applied.length, 0, "waking to the same data changes nothing");
  stamp = 2; listeners.visibilitychange(); await tick();
  assert.deepStrictEqual(applied, [{ s: 2 }], "waking to newer data patches the page");
  listeners.pageshow(); await tick(); assert.strictEqual(applied.length, 1, "the same stamp is not applied twice");
  stamp = 3; applyResult = false; listeners.pageshow(); await tick();
  assert.strictEqual(reloads, 1, "when the page cannot patch itself (notes added or removed) it reloads");
  console.log("ok - phone app: waking catches up to the newest data, patching in place or reloading");
})().catch(e => { console.error(e); process.exit(1); });
