#!/usr/bin/env node
// inkOn(colour, background): the colour moved toward black or white only as far as needed to be readable text on that background (4.5:1),
// and left alone when it already is. Property: for any colour and either background, the result passes.
const assert = require("assert"), fs = require("fs"), path = require("path"), build = require("../build");
const S = new Function(`${fs.readFileSync(path.join(build.ROOT, "src", "shared.js"), "utf8")}; return VGShared;`)();
assert.strictEqual(typeof S.inkOn, "function", "VGShared.inkOn must exist");
const light = "#ffffff", dark = "#16161a";
// the colours the design critic measured: teal 2.85:1, olive 3.13:1, orange 3.31:1 on white
for (const c of ["#3AA99F", "#879A39", "#DA702C", "#4385BE", "#D14D41", "#8B7EC8"]) {
  for (const bg of [light, dark]) assert(S.contrast(S.inkOn(c, bg), bg) >= 4.5, `${c} on ${bg} gives ${S.inkOn(c, bg)} at ${S.contrast(S.inkOn(c, bg), bg).toFixed(2)}`);
}
assert.strictEqual(S.inkOn("#000000", light), "#000000", "a colour that already reads is left alone");
assert.strictEqual(S.inkOn("#3AA99F", dark), "#3AA99F", "teal already reads on dark");
assert.strictEqual(S.inkOn("not a colour", light), "not a colour", "an unreadable value passes through");
assert.strictEqual(S.inkOn("#3AA99F", "rgb(255, 255, 255)").length, 7, "rgb() backgrounds work");
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = 0; i < 500; i++) { const hex = "#" + [0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join(""); for (const bg of [light, dark]) assert(S.contrast(S.inkOn(hex, bg), bg) >= 4.5, `random ${hex} on ${bg}`); }
console.log("ok - topic ink reads on light and dark");
