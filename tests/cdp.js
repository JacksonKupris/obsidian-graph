// cdp.js - the one way the browser tests drive a page, in real time over the Chrome DevTools Protocol: headless Chrome
// on this PC (.out/ profile and a debug port), or Obsidian on a phone plugged in or paired over adb (its WebView's
// debug socket, forwarded to the port). Used by smoke_page.js and click_all.js.
//   const page = await open({ html, port, mobile, phone, fresh, onConsole, onClose })   null when there's no Chrome
//     html       the page to load (written temporarily under .out/); not with phone
//     mobile     a 420 x 900 touch phone in Chrome's device mode
//     phone      attach to Obsidian on the phone instead (adb: REA_ADB_PATH or adb on the PATH)
//     fresh      drop the page's earlier console lines before listening (a page that ran a probe before replays them)
//     onConsole  (firstArg) for each console.log in the page; onClose() if the connection drops
//   page.send(method, params) · page.ev(expr) -> value · page.waitFor(expr, limitMs) -> value | null · page.close()
const fs = require("fs"), path = require("path"), { spawn, execFileSync } = require("child_process");
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Chrome (or Chromium, or Edge, which speaks the same protocol) wherever this computer has it; CHROME_PATH overrides
const CHROME = [process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"]
  .find(p => p && fs.existsSync(p));
const OUT = path.join(__dirname, "..", ".out");   // inside the repo: a snap Chromium can't read the system temp folder

// Obsidian's page on the phone, forwarded to port. A phone that just reconnected says "unauthorized" for a moment
// while it re-checks this PC's key, so that's waited out.
function forwardPhone(port) {
  const adb = process.env.REA_ADB_PATH || "adb", run = (...a) => execFileSync(adb, a, { encoding: "utf8" }).trim();
  let pid = "";
  for (let i = 0; i < 15 && !pid; i++) { try { pid = run("shell", "pidof", "md.obsidian").split(/\s+/)[0]; } catch (e) {
    const msg = String(e.stderr || "").trim().split("\n")[0];
    if (!msg && e.status === 1) break;   // pidof found no Obsidian: the phone answered, the app isn't running
    if (!/unauthorized|offline/.test(msg) || i === 14) throw new Error("adb: " + msg + " (check the phone for the USB debugging prompt)");
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); } }
  if (!pid) throw new Error("Obsidian isn't running on the phone (or no phone: adb devices)");
  run("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
}

async function open(o) {
  const port = (o.port || 9334) + Number(process.env.VG_PORT_OFFSET || 0);   // VG_PORT_OFFSET: two runs side by side (two worktrees)
  let proc = null, tmp = null, prof = null;
  if (o.phone) forwardPhone(port);
  else {
    // here a test without Chrome skips (CI runs it before publishing); on CI that would publish it untested
    if (!CHROME) { if (process.env.CI) throw new Error("no Chrome on this CI runner, so the browser tests can't run"); return null; }
    fs.mkdirSync(OUT, { recursive: true });
    const runId = `${process.pid}-${port}-${Date.now()}`;
    tmp = path.join(OUT, `vg-page-${runId}.html`); fs.writeFileSync(tmp, o.html);
    prof = path.join(OUT, `vg-prof-${runId}`); fs.mkdirSync(prof);
  }
  // CI runners (Ubuntu) block the user namespaces Chrome's sandbox needs
  const ci = process.env.CI ? ["--no-sandbox"] : [];
  const launch = () => spawn(CHROME, ["--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader", ...ci, "--window-size=1400,900", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  const findPage = async () => { try { return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch (e) { return null; } };
  // a cold Chrome on a CI runner sometimes never opens its port (failed the 0.6.11 release), so one that exited or
  // hasn't answered in 20 s is started again, three tries in all
  // the old one has to have exited before the next starts: it holds the profile folder until then
  const stop = async () => { if (!proc || proc.exitCode !== null || proc.signalCode) return;
    const exited = new Promise(r => proc.once("exit", r)); try { proc.kill(); } catch (e) {} await Promise.race([exited, sleep(5000)]); };
  let target;
  for (let tries = 0; tries < (o.phone ? 1 : 3) && !target; tries++) {
    let dead = false;   // exited, or never started (a spawn error comes as an event, not an exit code)
    if (!o.phone) { await stop(); proc = launch(); proc.once("error", () => { dead = true; }); proc.once("exit", () => { dead = true; }); }
    for (let i = 0; i < 80 && !target; i++) { target = await findPage(); if (!target) { if (dead) break; await sleep(250); } }
  }
  if (!target) { await stop(); try { if (tmp) fs.unlinkSync(tmp); } catch (e) {}
    throw new Error(o.phone ? "the phone's Obsidian page isn't reachable" : "Chrome didn't start (3 tries)"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); let id = 0, closing = false, gone = ""; const pending = new Map();
  ws.onmessage = msg => { const d = JSON.parse(msg.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)[0](d); pending.delete(d.id); }
    if (d.method === "Inspector.targetCrashed") failAll((gone = "the page crashed"));   // its connection stays open
    if (d.method === "Runtime.consoleAPICalled" && o.onConsole) { const a = d.params.args[0]; o.onConsole(a && a.value); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("couldn't connect to the page")); });
  // every request still waiting fails, so a crashed page or dropped connection ends the test instead of hanging it
  const failAll = why => { for (const [, [, rej]] of pending) rej(new Error(why)); pending.clear(); };
  // a WebView takes one debugger at a time: another one attaching (DevTools, a second run) drops this one
  ws.onclose = () => { failAll((gone = gone || "the page's connection closed")); if (!closing && o.onClose) o.onClose(); };
  const send = (method, params, ms = 300000) => new Promise((res, rej) => {
    if (gone || ws.readyState !== WebSocket.OPEN) return rej(new Error(`${method}: ${gone || "the page's connection is closed"}`));
    const i = ++id, t = setTimeout(() => { pending.delete(i); rej(new Error(`${method}: no reply in ${ms / 1000} s`)); }, ms);
    pending.set(i, [d => { clearTimeout(t); res(d); }, e => { clearTimeout(t); rej(e); }]);
    ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  // an error in the page is an error here: quietly returning undefined made a broken expression look like "no result"
  const ev = async e => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }), x = r.result && r.result.exceptionDetails;
    if (x) throw new Error(`in the page: ${(x.exception && x.exception.description) || x.text}\n  while running: ${String(e).slice(0, 160)}`);
    return r.result && r.result.result && r.result.result.value; };
  if (o.fresh) await send("Runtime.discardConsoleEntries");
  await send("Runtime.enable");
  await send("Inspector.enable").catch(() => {});   // for targetCrashed
  if (o.mobile) { await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); }
  if (tmp) await send("Page.navigate", { url: "file:///" + tmp.replace(/\\/g, "/") });
  const waitFor = async (expr, limitMs) => { const t0 = Date.now(); let v = null;
    while (!v && Date.now() - t0 < limitMs) { await sleep(o.phone ? 2000 : 500); v = await ev(expr); } return v || null; };
  // Chrome holds files in its profile while it exits (Windows), so the profile goes once it has, with retries
  const close = async () => { closing = true; try { ws.close(); } catch (e) {}
    if (proc && proc.exitCode === null) { const gone = new Promise(r => proc.once("exit", r)); try { proc.kill(); } catch (e) {} await Promise.race([gone, sleep(5000)]); }
    try { if (tmp) fs.unlinkSync(tmp); } catch (e) {}
    try { if (prof) fs.rmSync(prof, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) {} };
  return { send, ev, waitFor, close };
}

module.exports = { open, CHROME };
