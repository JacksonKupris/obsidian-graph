#!/usr/bin/env node
// Look at the views in the running Obsidian: opens each one through the real view picker, waits until it has drawn, saves a
// screenshot and says what it found. For checking a change (npm run deploy -- --plugin puts the local build in first).
//   npm run look                              every library view
//   npm run look -- "Load paths" "Cas9"       only these (the names in the picker)
//   npm run look -- --out some/folder         where the screenshots go (default: ./look-shots)
// Needs Obsidian running with this vault open and its command line on (Settings > General > Advanced). The CLI is
// `obsidian` on the PATH, or set OBSIDIAN_CLI to its file (Windows: the Obsidian.com next to Obsidian.exe).
// An Obsidian window that is minimised or behind another is not painted, so the page never gets an animation frame and a
// view stays half drawn (labels in the corner, an empty canvas). This script runs the frames on a timer instead, so what it
// photographs is what the window would show. The screenshot and the check use the same drawn page.
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");

const args = process.argv.slice(2), outAt = args.indexOf("--out");
const out = path.resolve(outAt >= 0 ? args.splice(outAt, 2)[1] : "look-shots");
const views = args.length ? args : ["Light cones", "Load paths", "Slime mould", "Normal modes", "Genome fold", "Cas9"];
const WIN_DEFAULT = "D:\\Obsidian\\Obsidian.com";
const bin = process.env.OBSIDIAN_CLI || (process.platform === "win32" && fs.existsSync(WIN_DEFAULT) ? WIN_DEFAULT : "obsidian");

function cli(...a) {
  const r = spawnSync(bin, a, { encoding: "utf8", timeout: 60e3 });
  if (r.error) fail(`Could not run the Obsidian command line (${bin}): ${r.error.message}\nTurn it on in Obsidian (Settings > General > Advanced), or set OBSIDIAN_CLI to its file.`);
  return (r.stdout || "").trim() + (r.status ? "\n" + (r.stderr || "") : "");
}
const fail = m => { console.error("look: " + m); process.exit(2); };
const ev = code => { const o = cli("eval", `code=${code}`); if (/^Error/m.test(o) && !o.startsWith("=>")) throw new Error(o.split("\n")[0]); return o.replace(/^=> ?/, ""); };
const sleep = ms => spawnSync(process.execPath, ["-e", `setTimeout(()=>{},${ms})`]);

// what the page says about the open view: the picker's name, whether the library's frame is up, and its labels
const STATE = `(()=>{const p=document.querySelector('.vg-pickbtn'),L=[...document.querySelectorAll('.vgv-labels > *')].filter(l=>l.style.display!=='none');return JSON.stringify({pill:p?p.textContent.replace('▾','').trim():null,frames:document.querySelectorAll('.vgv-frame').length,labels:L.length,unplaced:L.filter(l=>!l.style.transform).length,vis:document.visibilityState,w:(document.querySelector('.vg-lib canvas')||{}).width||0})})()`;
const state = () => JSON.parse(ev(STATE));
// the window's own paint, asked for now: dev:screenshot hands back the last frame a hidden window painted, one view behind
const capture = file => ev(`(async()=>{const w=window.require('electron').remote.getCurrentWindow();const i=await w.webContents.capturePage();window.require('fs').writeFileSync(${JSON.stringify(file)},i.toPNG());return 1})()`);
const pick = name => ev(`(()=>{const b=document.querySelector('.vg-pickbtn');if(!b)return 'no picker';if(!document.querySelector('.vg-tile'))b.click();const t=[...document.querySelectorAll('.vg-tile')].find(x=>x.textContent.startsWith(${JSON.stringify(name)}));if(!t)return 'no view called that';t.click();return 'ok'})()`);

if (!/^=>|^\{|\w/.test(cli("version"))) fail("Obsidian did not answer. Open the vault in Obsidian first.");
if (state().pill === null) { cli("command", "id=jk-vault-graph:open"); sleep(3000); }
if (state().pill === null) fail("The Vault Graph view is not open. Open it from Obsidian (command: Vault Graph: open) and run this again.");
// frames on a timer, once per page load (a reload of the plugin starts a fresh page state)
ev(`(()=>{if(!window.__lookRaf){window.__lookRaf=1;window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16)}return 1})()`);
fs.mkdirSync(out, { recursive: true });

let bad = 0;
for (const name of views) {
  const got = pick(name);
  if (got !== "ok") { console.log(`FAIL ${name}: ${got}`); bad++; continue; }
  let s = null;
  for (let i = 0; i < 25; i++) { sleep(400); s = state(); if (s.pill === name && s.unplaced === 0 && s.w > 0) break; }
  const shot = path.join(out, name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".png");
  sleep(700); capture(shot);   // a hidden window hands back the paint before the latest, so the first capture is thrown away
  sleep(300); capture(shot);
  const good = s && s.pill === name && s.unplaced === 0 && s.w > 0 && fs.existsSync(shot);
  if (!good) bad++;
  console.log(`${good ? "ok  " : "FAIL"} ${name}: ${s ? `${s.labels} labels, ${s.unplaced} unplaced, canvas ${s.w}px, window ${s.vis}` : "no state"} -> ${shot}`);
}
const errs = cli("dev:errors").split("\n").filter(l => /\S/.test(l) && !/isShown|app:\/\/obsidian|enhance\.js/.test(l));
if (errs.length) { console.log("errors:\n  " + errs.slice(0, 6).join("\n  ")); }
console.log(bad ? `${bad} of ${views.length} views did not draw. Open the screenshot, then check the console (Ctrl+Shift+I).` : `All ${views.length} views drew. Open the screenshots in ${out} and read them: a view can draw and still look wrong.`);
process.exit(bad ? 1 : 0);
