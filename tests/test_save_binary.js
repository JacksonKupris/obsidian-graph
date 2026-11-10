// saveBinary: a new file gets a numbered name when the path is taken, but { replace: true } trashes the old file first,
// so a re-run of the state snapshots overwrites "state-….png" instead of leaving "state-… 2.png" beside it.
// node tests/test_save_binary.js        exit 0 = pass
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const src = fs.readFileSync(require("node:path").join(__dirname, "../src/plugin/75-reports.js"), "utf8");
const a = src.indexOf("  async saveBinary("), b = src.indexOf("  // read by: dismissed pairs");
assert(a > 0 && b > a, "saveBinary is missing from 75-reports.js");

class TFile {}
const ctx = { TFile, normalizePath: p => p, Notice: class {}, Saver: null };
vm.createContext(ctx);
const Saver = vm.runInContext(`(class Saver {\n${src.slice(a, b)}\n})`, ctx);
const make = () => {
  const files = new Map(), trashed = [];
  const host = Object.assign(new Saver(), {
    pathTaken: p => files.has(p) || p === "Attachments",
    fileAt: p => files.get(p) || null,
    ioFolder: async () => {},
    ioTrash: async f => { trashed.push(f.path); files.delete(f.path); },
    ioCreateBinary: async (p, buf) => { const f = new TFile(); f.path = p; f.buf = buf; files.set(p, f); },
  });
  return { host, files, trashed };
};
(async () => {
  const plain = make();
  await plain.host.saveBinary("Attachments/state-a.png", 1);
  assert.equal(await plain.host.saveBinary("Attachments/state-a.png", 2), "Attachments/state-a 2.png", "without replace the name is numbered");

  const again = make();
  await again.host.saveBinary("Attachments/state-a.png", 1);
  const path = await again.host.saveBinary("Attachments/state-a.png", 2, { replace: true });
  assert.equal(path, "Attachments/state-a.png", "replace must keep the name");
  assert.deepEqual([...again.files.keys()], ["Attachments/state-a.png"], "replace left a second file behind");
  assert.equal(again.files.get(path).buf, 2, "replace kept the old content");
  assert.deepEqual(again.trashed, ["Attachments/state-a.png"], "the old file must go to the trash, not be deleted");
  const first = make();
  assert.equal(await first.host.saveBinary("Attachments/new.png", 1, { replace: true }), "Attachments/new.png", "replace with nothing there");
  assert.deepEqual(first.trashed, []);
  console.log("ok - saveBinary numbers a taken name; replace trashes the old file and keeps the name");
})().catch(e => { console.error(e); process.exitCode = 1; });
