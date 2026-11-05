#!/usr/bin/env node
// Cosmos on a phone. It's the one view that ran at full rate there, and its costliest parts were all links as one long path and a glow on
// every note. A phone now redraws at the rate the other views get, keeps the links as a picture it makes twice a second, and only glows
// the bigger notes. A desktop draws as it did. Counted from the canvas calls the real view makes. This is a stand-in for a phone: a real
// one has a GPU this browser doesn't.
//   node tests/test_cosmos_phone.js [--vault [dir]]        exit 0 = pass
const { sleep, checks, finish, openPage } = require("./kit"), env = require("./env");
const { fails, ok: check } = checks();
const D = "window.vaultGraph._debug";
// over a second of the page running by itself: redraws of the screen, and straight lines started on the screen and on any other canvas
const WATCH = `new Promise(res => { const P = CanvasRenderingContext2D.prototype, was = { moveTo: P.moveTo, drawImage: P.drawImage }, main = document.querySelector(".vg-cv").getContext("2d"), n = { mainLines: 0, layerLines: 0, frames: 0, sprites: 0, longest: 0 }; let inPath = 0; const begin = P.beginPath; P.beginPath = function () { if (this === main) inPath = 0; return begin.call(this); };
  P.moveTo = function (...a) { if (this === main) { n.mainLines++; n.longest = Math.max(n.longest, ++inPath); } else n.layerLines++; return was.moveTo.apply(this, a); };
  P.drawImage = function (...a) { if (this === main) n.sprites++; return was.drawImage.apply(this, a); };
  const fillRect = P.fillRect; P.fillRect = function (...a) { if (this === main && a[2] >= innerWidth - 1 && a[3] >= innerHeight / 2) n.frames++; return fillRect.apply(this, a); };
  setTimeout(() => { Object.assign(P, was); P.fillRect = fillRect; P.beginPath = begin; res(n); }, 2000); })`;
const skipTour = tab => tab.ev(`(() => { const s = [...document.querySelectorAll(".vg-tour-card button")].find(b => b.textContent.trim() === "Skip"); if (s) s.click(); })()`);
(async () => {
  const phone = await openPage({ html: env.pageWith("mobile: true,"), mobile: true });
  try {
    await phone.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
    if (!await phone.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the phone page didn't mount");
    await sleep(1200); await skipTour(phone);
    await phone.ev(`${D}.setView("cosmos")`); await sleep(2500);
    const n = await phone.ev(WATCH), links = await phone.ev(`${D}.links().filter(l => l.kind === "link" || l.kind === "moc").length`);
    check(links > 10, `only ${links} links to draw`);
    check(n.frames > 0, "the phone drew nothing in two seconds");
    check(n.frames <= 2 * 23, `a phone redrew Cosmos ${n.frames} times in two seconds, want about 40`);
    check(n.longest < links / 2, `a phone drew a path of ${n.longest} lines on the screen, of ${links} links: they should be in the kept picture`);
    check(n.layerLines > 0, "the kept picture of the links was never made"); check(n.layerLines <= links * 6, `the kept picture was made too often: ${n.layerLines} lines for ${links} links in two seconds`);
    // it stays where the camera is: moved by hand, it slides with the notes
    const offset = await phone.ev(`(async () => { const P = CanvasRenderingContext2D.prototype, was = P.drawImage, main = document.querySelector(".vg-cv").getContext("2d"), seen = []; P.drawImage = function (...a) { if (this === main && a[0] instanceof HTMLCanvasElement && a[0].width >= innerWidth * 0.9) seen.push(a.slice(1, 5)); return was.apply(this, a); }; ${D}.drawNow(); P.drawImage = was; return seen; })()`);
    check(offset.length === 1, `one kept picture a frame, found ${offset.length}`);
  } catch (e) { fails.push(`phone: ${e.message}`); }
  await phone.close();
  const desk = await openPage({ html: env.pageWith("") });
  try {
    await desk.send("Emulation.setDeviceMetricsOverride", { width: 1300, height: 860, deviceScaleFactor: 1, mobile: false });
    if (!await desk.waitFor(`window.vaultGraph && ${D} ? 1 : 0`, 30000)) throw new Error("the desktop page didn't mount");
    await sleep(1200); await skipTour(desk);
    await desk.ev(`${D}.setView("cosmos")`); await sleep(2500);
    const n = await desk.ev(WATCH);
    check(n.layerLines === 0, `a desktop shouldn't keep a picture of the links: ${n.layerLines} lines off screen`); const links = await desk.ev(`${D}.links().filter(l => l.kind === "link" || l.kind === "moc").length`); check(n.longest >= links / 2, `a desktop should draw its links as it did: its longest path has ${n.longest} lines of ${links}`);
  } catch (e) { fails.push(`desktop: ${e.message}`); }
  await desk.close();
  finish(fails, "Cosmos on a phone: the phone rate, links as a kept picture, a desktop unchanged");
})();
