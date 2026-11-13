// The phone server keeps the app current: a change in the vault is announced on /events and shows in data.json, a bad read keeps the
// last good data, and the app files are served. Runs on a copy of the sample vault in a temp folder.
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const build = require("../build"), { createServer } = require("../scripts/phone_server");
const rules = build.loadRules(), sleep = ms => new Promise(r => setTimeout(r, ms));

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "phone-vault-")), dataFile = path.join(vault, rules.files.data);
fs.mkdirSync(path.dirname(dataFile), { recursive: true }); fs.copyFileSync(path.join(build.ROOT, "fixtures", "sample-graph.json"), dataFile);
const journal = path.join(vault, "01-Daily", "2026", "11-November", "Journal", "2026-11-12.md");
fs.mkdirSync(path.dirname(journal), { recursive: true }); fs.writeFileSync(journal, "- [ ] first task\n");

const get = (port, p) => new Promise((res, rej) => http.get({ port, path: p }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res({ status: r.statusCode, type: r.headers["content-type"], body: b })); }).on("error", rej));
(async () => {
  const app = createServer({ vault, rules, version: "9.9.9", debounceMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r)); const port = app.server.address().port;
  try {
    // the vault is only read: a log inside it is refused, and serving the page and taking a phone report leaves every file as it was
    assert.throws(() => createServer({ vault, rules, version: "9.9.9", log: path.join(vault, "phone.log") }), /inside the vault/, "a log inside the vault is refused");
    const snap = dir => { const out = {}; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(vault, p)] = fs.readFileSync(p, "utf8"); } }; walk(dir); return out; };
    const before = snap(vault);
    await get(port, "/"); await get(port, "/data.json");
    await new Promise(r => { const q = http.request({ port, path: "/__report", method: "POST" }, x => { x.resume(); x.on("end", r); }); q.end(JSON.stringify({ kind: "app-open" })); });
    assert.deepStrictEqual(snap(vault), before, "serving and a phone report must not change the vault");
    const page = await get(port, "/");
    assert(page.status === 200 && page.body.includes("EventSource") && page.body.includes("manifest.webmanifest"), "the app page is served with its live updates");
    assert.strictEqual((await get(port, "/manifest.webmanifest")).type, "application/manifest+json");
    assert.strictEqual((await get(port, "/nope")).status, 404, "an unknown file is a 404");
    const first = JSON.parse((await get(port, "/data.json")).body);
    assert(first.data.journalHistory.length >= 1, "data.json carries the journals");

    // an open app hears about a change
    const heard = []; const req = http.get({ port, path: "/events" }, r => r.on("data", c => heard.push(String(c).trim())));
    await sleep(300); assert(heard.length === 1, "the app is told the current version when it connects");
    fs.writeFileSync(journal, "- [ ] first task\n- [ ] second task\n");
    for (let i = 0; i < 40 && heard.length < 2; i++) await sleep(100);
    assert(heard.length === 2 && heard[1] !== heard[0], "a change in the vault is announced");
    const second = JSON.parse((await get(port, "/data.json")).body);
    assert(second.stamp > first.stamp, "data.json is newer");
    const tasks = j => j.data.journalHistory.reduce((n, x) => n + x.tasks.length, 0);
    assert.strictEqual(tasks(second), tasks(first) + 1, "and has the new task in it");

    // a graph file caught half-written keeps the last good data and is not announced
    fs.writeFileSync(dataFile, "{ not json");
    await sleep(500); assert.strictEqual(heard.length, 2, "a bad read is not announced");
    assert.strictEqual(JSON.parse((await get(port, "/data.json")).body).stamp, second.stamp, "the last good data is kept");
    req.destroy();
    console.log("ok - phone server: serves the app, announces vault changes, keeps good data");
  } finally { app.server.close(); fs.rmSync(vault, { recursive: true, force: true }); }
})().catch(e => { console.error("FAIL -", e.message); process.exit(1); });
