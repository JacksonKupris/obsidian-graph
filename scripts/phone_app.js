// phone_app.js - builds the graph page as an installable phone app (home-screen icon, full screen, works offline) into .out/phone/.
//   node scripts/phone_app.js [--vault <dir>] [--out <dir>]
// Without --vault it uses the sample vault, so it runs on any computer. Serve the folder over https to install it
// (docs/phone-app.md: the one command, the steps by hand, what each failure means).
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const build = require("../build");

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };

// A PNG with no image library: the app's icon is a few lines and dots (a small graph) on the page's dark background.
function iconPng(size) {
  const px = Buffer.alloc(size * size * 4), set = (x, y, c) => { if (x >= 0 && y >= 0 && x < size && y < size) px.set(c, (y * size + x) * 4); };
  const BG = [22, 22, 26, 255], LINE = [124, 102, 255, 255], DOT = [236, 236, 241, 255], s = size / 100;
  for (let i = 0; i < size * size; i++) px.set(BG, i * 4);
  const nodes = [[30, 66], [50, 30], [72, 62], [52, 78]].map(([x, y]) => [x * s, y * s]), links = [[0, 1], [1, 2], [0, 3], [3, 2], [1, 3]];
  for (const [a, b] of links) { const [x1, y1] = nodes[a], [x2, y2] = nodes[b], n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let i = 0; i <= n; i++) for (let w = -Math.ceil(s * 1.2); w <= Math.ceil(s * 1.2); w++) set(Math.round(x1 + (x2 - x1) * i / n + w), Math.round(y1 + (y2 - y1) * i / n), LINE); }
  for (const [cx, cy] of nodes) for (let y = -Math.ceil(s * 7); y <= Math.ceil(s * 7); y++) for (let x = -Math.ceil(s * 7); x <= Math.ceil(s * 7); x++) if (x * x + y * y <= (s * 7) ** 2) set(Math.round(cx + x), Math.round(cy + y), DOT);
  const raw = Buffer.alloc((size * 4 + 1) * size); for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const MANIFEST = { name: "Vault Graph", short_name: "Vault", start_url: "./", scope: "./", display: "standalone", orientation: "any", background_color: "#16161a", theme_color: "#16161a",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };

// The page first, from the network when there is one (so it shows the newest data), else the copy kept on the phone.
const sw = version => `// ${version}
const CACHE = "vault-graph-${version}", SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("./"))));
});
`;

const HEAD = `<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">
<meta name="theme-color" content="#16161a"><meta name="mobile-web-app-capable" content="yes">`;
const REGISTER = `<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});</script>`;

// What the phone tells the PC while the preview server runs (phone_preview.py's /__report): that it opened, and every error. Anywhere else the posts fail quietly.
const REPORT = `<script>(() => { const say = (kind, data) => { try { fetch("__report", { method: "POST", body: JSON.stringify({ kind, data, at: new Date().toISOString() }), keepalive: true }).catch(() => {}); } catch (e) {} };
say("app-open", { w: innerWidth, h: innerHeight, standalone: matchMedia("(display-mode: standalone)").matches });
addEventListener("error", e => say("error", String(e.message))); addEventListener("unhandledrejection", e => say("error", String(e.reason))); })();</script>`;

// What goes in the folder: file name -> text or bytes. Throws when the page is missing its mount point.
function phoneApp(data, rules, version) {
  const page = build.buildPage(data, rules);
  if (!page.includes("</head>") || !page.includes("</body>")) throw new Error("the graph page has no head or body to add the app parts to");
  return {
    "index.html": page.replace("</head>", HEAD + "</head>").replace("</body>", REGISTER + REPORT + "</body>"),
    "manifest.webmanifest": JSON.stringify(MANIFEST, null, 2), "sw.js": sw(version), "icon-192.png": iconPng(192), "icon-512.png": iconPng(512),
  };
}

if (require.main === module) {
  const rules = build.loadRules(), vault = arg("--vault"), out = arg("--out", path.join(build.ROOT, ".out", "phone"));
  const dataFile = vault ? path.join(vault, rules.files.data) : path.join(build.ROOT, "fixtures", "sample-graph.json");
  if (!fs.existsSync(dataFile)) { console.error(`FAIL - no graph data at ${dataFile}. Open the vault in Obsidian once so the plugin writes it, or leave out --vault to use the sample.`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (vault) Object.assign(data, require("./vault_hq").hqFromFolder(vault, rules));   // the page has no vault to read, so it carries the HQ notes and every journal's tasks
  const files = phoneApp(data, rules, require("../package.json").version);
  for (const [f, body] of Object.entries(files)) { const to = path.join(out, f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, body); }
  console.log(`Wrote ${path.relative(process.cwd(), out)}/ from ${vault ? "the vault" : "the sample vault"}. Serve it over https (docs/phone-app.md).`);
}
module.exports = { phoneApp, iconPng, MANIFEST };
