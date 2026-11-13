// phone_server.js - serves the phone app and keeps it current: when the vault changes, the app on the phone is told and takes the new data.
//   node scripts/phone_server.js --vault <dir> [--port 8765] [--log <file>]
// The app comes from scripts/phone_app.js; the data (graph, HQ notes, journals) is read from the vault again after each change.
// Personal devices only; reach it from the phone with Tailscale Serve (docs/phone-app.md). Without a vault it serves the sample.
const fs = require("fs"), path = require("path"), http = require("http");
const build = require("../build"), { phoneApp } = require("./phone_app"), { hqFromFolder } = require("./vault_hq");

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".js": "text/javascript", ".png": "image/png" };
const SKIP = /(^|[\\/])(\.obsidian|\.trash|\.git|\.cache|\.smart-env|node_modules)([\\/]|$)/;

// What the app needs from the vault right now: the graph file the plugin writes, plus the notes the page can't read itself.
function readData(vault, rules) {
  const file = path.join(vault, rules.files.data);
  if (!fs.existsSync(file)) throw new Error(`no graph data at ${file}. Open the vault in Obsidian once so the plugin writes it.`);
  return Object.assign(JSON.parse(fs.readFileSync(file, "utf8")), hqFromFolder(vault, rules));
}

// A server for one vault: app files built once, data built again on each change, every open app told through /events.
function createServer({ vault, rules, version, log, debounceMs = 1500 }) {
  // The server only reads the vault. Its one write is the log, so a log inside the vault is refused (it would add a file to the notes and be synced to every device).
  if (log) { const rel = path.relative(path.resolve(vault), path.resolve(log)); if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) throw new Error("the log file is inside the vault; put it outside (for example in a temp folder)"); }
  const files = {}, clients = new Set(); let data = null, stamp = 0, timer = null;
  const refresh = () => {   // a failed read (a note half-written) keeps the last good data and is tried again on the next change
    try { data = readData(vault, rules); stamp = Date.now(); Object.assign(files, phoneApp(data, rules, version)); files["data.json"] = JSON.stringify({ stamp, data }); return true; }
    catch (e) { console.error("data not refreshed:", e.message); return false; }
  };
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => { if (refresh()) clients.forEach(res => res.write(`data: ${stamp}\n\n`)); }, debounceMs); };
  if (!refresh()) throw new Error("the vault has no graph data to serve");
  const watchers = [];
  const watch = (dir, recursive) => { try { watchers.push(fs.watch(dir, { recursive }, (ev, name) => { if (!name || (!SKIP.test(name) && /\.(md|json)$/.test(name))) changed(); })); } catch (e) { console.error("not watching", dir, e.message); } };
  watch(vault, true);
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (req.method === "POST" && url === "/__report") {
      let body = ""; req.on("data", c => { body += c; if (body.length > 4000) req.destroy(); });
      req.on("end", () => { const line = body.replace(/\n/g, " "); if (log) fs.appendFileSync(log, line + "\n"); console.log("phone:", line.slice(0, 200)); res.writeHead(204).end(); }); return;
    }
    if (url === "/events") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }); res.write(`data: ${stamp}\n\n`); clients.add(res); req.on("close", () => clients.delete(res)); return; }
    const name = url === "/" ? "index.html" : url.slice(1);
    if (!Object.prototype.hasOwnProperty.call(files, name)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(name)] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(files[name]);
  });
  server.on("close", () => { clearTimeout(timer); watchers.forEach(w => w.close()); clients.forEach(c => c.end()); });
  return { server, changed, refresh, stamp: () => stamp };
}

if (require.main === module) {
  const rules = build.loadRules(), vault = arg("--vault"), port = +arg("--port", 8765), log = arg("--log");
  if (!vault || !fs.existsSync(vault)) { console.error("FAIL - give the vault folder: node scripts/phone_server.js --vault <folder>"); process.exit(1); }
  let s; try { s = createServer({ vault, rules, version: require("../package.json").version, log }); } catch (e) { console.error("FAIL -", e.message); process.exit(1); }
  s.server.on("error", e => { console.error(e.code === "EADDRINUSE" ? `FAIL - port ${port} is taken: stop the other server or use --port <another number>.` : "FAIL - " + e.message); process.exit(1); });
  s.server.listen(port, "0.0.0.0", () => console.log(`Phone app on http://127.0.0.1:${port}/ . Over https: tailscale serve --bg --https=443 http://127.0.0.1:${port}. Watching ${vault}. Ctrl+C stops.`));
}
module.exports = { createServer, readData };
