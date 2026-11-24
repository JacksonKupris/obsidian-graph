#!/usr/bin/env node
// Plain words in the graph's legend and note tooltip (3D persona round, 0.6.242): "co-mentioned", "similar" and "Map of content"
// were words only the author used. The legend names what a line means; a map note reads "Topic map".
//   node tests/test_plain_words.js        exit 0 = pass
const fs = require("fs"), path = require("path");
const { checks, finish } = require("./kit");
const { fails, ok: check } = checks();
const src = fs.readFileSync(path.join(__dirname, "..", "src", "view", "30-interact.js"), "utf8");
check(/class="vg-lg-line is-gap"/.test(src), "the legend still has the gap line (the test can't fail without it)");
check(!/is-gap"><\/i>co-mentioned/.test(src), "legend says co-mentioned");
check(!/is-sim"><\/i>similar</.test(src), "legend says just similar");
check(!/`Map of content ·/.test(src), "note tooltip says Map of content");
finish(fails, "legend and tooltip use plain words");
