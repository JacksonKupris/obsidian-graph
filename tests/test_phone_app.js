// The phone app: the page plus what makes it installable (manifest, icons, an offline cache), built from the sample vault.
const assert = require("assert"), zlib = require("zlib"), fs = require("fs"), path = require("path");
const build = require("../build"), { phoneApp, iconPng, MANIFEST } = require("../scripts/phone_app");
const rules = build.loadRules(), data = JSON.parse(fs.readFileSync(path.join(build.ROOT, "fixtures", "sample-graph.json"), "utf8"));
const files = phoneApp(data, rules, "9.9.9");

assert.deepStrictEqual(Object.keys(files).sort(), ["icon-192.png", "icon-512.png", "index.html", "manifest.webmanifest", "sw.js"], "every file the install needs");
const page = files["index.html"];
assert(page.includes('rel="manifest" href="manifest.webmanifest"') && page.includes("serviceWorker.register"), "the page links its manifest and registers the cache");
assert(page.includes("mountVaultGraph"), "it is still the graph page");
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
