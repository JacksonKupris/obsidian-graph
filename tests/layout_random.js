#!/usr/bin/env node
// Randomize / Reset layout in every view, in headless Chrome: randomizing moves the notes, resetting brings back
// the exact default layout (2D/3D: the arrangement you had). Cosmos is skipped (you place its bodies yourself).
//   node tests/layout_random.js [--vault [dir]]        exit 0 = pass
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const page = require("./env").page();
const probe = `<script>
setTimeout(async () => {
  const D = window.vaultGraph._debug, sleep = ms => new Promise(r => setTimeout(r, ms)), res = [], errs = [];
  addEventListener("error", e => errs.push(String(e.message)));
  // the layout itself, not the animated frame: scene targets, neural brain positions, or the 2D/3D positions
  const ids = D.nodes.filter(n => !n.ghost && !n.person).slice(0, 400).map(n => n.id), byId = new Map(D.nodes.map(n => [n.id, n]));
  const snap = v => ids.map(id => { const n = byId.get(id);
    if (v === "neural") return [Math.round(n.bx || 0), Math.round(n.by || 0)];
    if (v === "2d" || v === "3d") return [Math.round(n.x), Math.round(n.y)];
    const p = D.maps()[v] && D.maps()[v].pos.get(id); return p ? [Math.round(p[0]), Math.round(p[1])] : [0, 0]; });
  const settle = async () => { for (let i = 0; i < 60 && D.alpha() > 0.01; i++) await sleep(250); };
  const moved = (a, b) => a.filter((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > 20).length / a.length;
  for (const v of D.views()) {
    if (v === "cosmos") continue;
    try {
      D.setView(v); await sleep(1300); await settle();
      const a = snap(v);
      document.querySelector(".vg-randlayout").click(); await sleep(1300); await settle();
      const b = snap(v), resetShown = !document.querySelector(".vg-resetlayout").hidden;
      document.querySelector(".vg-resetlayout").click(); await sleep(300);
      const c = v === "2d" || v === "3d" ? a.map((_, i) => { const L = D.layouts[v === "3d" ? "3d" : "2d"][ids[i]]; return L ? [Math.round(L[0]), Math.round(L[1])] : [0, 0]; }) : snap(v);
      res.push({ v, changed: +moved(a, b).toFixed(2), back: +moved(a, c).toFixed(2), resetShown, resetHidden: document.querySelector(".vg-resetlayout").hidden });
    } catch (e) { errs.push(v + ": " + e.message); }
  }
  const o = document.createElement("pre"); o.id = "probe"; o.textContent = JSON.stringify({ res, errs }); document.body.appendChild(o);
}, 1500);
</script>`;
const tmp = path.join(os.tmpdir(), `vg-layout-${process.pid}.html`);
fs.writeFileSync(tmp, page.replace("</body>", probe + "</body>"));
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => fs.existsSync(p));
if (!chrome) { console.log("  (skipped: no Chrome found)"); process.exit(0); }
const dom = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--window-size=1280,900", "--virtual-time-budget=200000", "--dump-dom", "file:///" + tmp.replace(/\\/g, "/")],
  { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
fs.unlinkSync(tmp);
const m = dom.match(/<pre id="probe">([^<]*)<\/pre>/);
if (!m) { console.log("FAIL - the probe never reported"); process.exit(1); }
const { res, errs } = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
const bad = res.filter(r => r.changed < 0.2 || r.back > 0.05 || !r.resetShown || !r.resetHidden);
res.forEach(r => console.log(`  ${bad.includes(r) ? "FAIL" : "ok  "}  ${r.v.padEnd(9)} randomize moved ${Math.round(r.changed * 100)}%, reset left ${Math.round(r.back * 100)}% moved`));
errs.forEach(e => console.log("  error: " + e));
process.exit(bad.length || errs.length ? 1 : 0);
