// cdp.js - the one way the browser tests drive a page, in real time over the Chrome DevTools Protocol: headless Chrome
// on this PC (a temp profile and a debug port), or Obsidian on a phone plugged in or paired over adb (its WebView's
// debug socket, forwarded to the port). Used by smoke_page.js and click_all.js.
//   const page = await open({ html, port, mobile, phone, fresh, onConsole, onClose })   null when there's no Chrome
//     html       the page to load (a temp file); not with phone
//     mobile     a 420 x 900 touch phone in Chrome's device mode
//     phone      attach to Obsidian on the phone instead (adb: REA_ADB_PATH or adb on the PATH)
//     fresh      drop the page's earlier console lines before listening (a page that ran a probe before replays them)
//     onConsole  (firstArg) for each console.log in the page; onClose() if the connection drops
//   page.send(method, params) · page.ev(expr) -> value · page.waitFor(expr, limitMs) -> value | null · page.close()
const fs = require("fs"), os = require("os"), path = require("path"), { spawn, execFileSync } = require("child_process");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => fs.existsSync(p));

// Obsidian's page on the phone, forwarded to port. A phone that just reconnected says "unauthorized" for a moment
// while it re-checks this PC's key, so that's waited out.
function forwardPhone(port) {
  const adb = process.env.REA_ADB_PATH || "adb", run = (...a) => execFileSync(adb, a, { encoding: "utf8" }).trim();
  let pid = "";
  for (let i = 0; i < 15 && !pid; i++) { try { pid = run("shell", "pidof", "md.obsidian").split(/\s+/)[0]; } catch (e) {
    const msg = String(e.stderr || e.message).trim().split("\n")[0];
    if (!/unauthorized|offline/.test(msg) || i === 14) throw new Error("adb: " + msg + " (check the phone for the USB debugging prompt)");
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]); } }
  if (!pid) throw new Error("Obsidian isn't running on the phone (or no phone: adb devices)");
  run("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
}

async function open(o) {
  const port = o.port || 9334;
  let proc = null, tmp = null, prof = null;
  if (o.phone) forwardPhone(port);
  else {
    if (!CHROME) return null;
    tmp = path.join(os.tmpdir(), `vg-page-${process.pid}-${port}.html`); fs.writeFileSync(tmp, o.html);
    prof = fs.mkdtempSync(path.join(os.tmpdir(), "vg-prof-"));
    proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--window-size=1400,900", `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore" });
  }
  let target;
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch (e) {} if (!target) await sleep(250); }
  if (!target) throw new Error(o.phone ? "the phone's Obsidian page isn't reachable" : "Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl); let id = 0, closing = false; const pending = new Map();
  ws.onmessage = msg => { const d = JSON.parse(msg.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.consoleAPICalled" && o.onConsole) { const a = d.params.args[0]; o.onConsole(a && a.value); } };
  await new Promise(r => ws.onopen = r);
  // a WebView takes one debugger at a time: another one attaching (DevTools, a second run) drops this one
  ws.onclose = () => { if (!closing && o.onClose) o.onClose(); };
  const send = (method, params) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async e => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
  if (o.fresh) await send("Runtime.discardConsoleEntries");
  await send("Runtime.enable");
  if (o.mobile) { await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); }
  if (tmp) await send("Page.navigate", { url: "file:///" + tmp.replace(/\\/g, "/") });
  const waitFor = async (expr, limitMs) => { const t0 = Date.now(); let v = null;
    while (!v && Date.now() - t0 < limitMs) { await sleep(o.phone ? 2000 : 500); v = await ev(expr); } return v || null; };
  const close = () => { closing = true; try { ws.close(); } catch (e) {} try { if (proc) proc.kill(); } catch (e) {}
    try { if (tmp) fs.unlinkSync(tmp); if (prof) fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} };
  return { send, ev, waitFor, close };
}

module.exports = { open, CHROME };
