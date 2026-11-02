#!/usr/bin/env node
// Marks follow a note when it moves: a value, a key, or a part of a key; through device ledgers, which is how another
// device learns of a move (Sync shows it no rename); never onto a new note that took the old name. Then the real plugin
// code: a rename reaches the shared file, this device's ledger, the dismissals, the saved layout and every later read.
//   node tests/test_moves.js        exit 0 = pass
const assert = require("assert"), env = require("./env"), stub = require("./plugin_stub");
const { Plugin, VGRules: R, TFile } = stub.load(env.rules);

const OLD = "02-Projects/Old Name.md", NEW = "02-Systems/New Name.md", OTHER = "03-Resources/Other.md";
const moves = { [OLD]: { to: NEW, at: "2026-11-01T10:00:00Z" } }, none = () => false;

// every shape the state files hold
const state = { review: { skipped: { [`link|${OLD}|${OTHER}`]: "2026-10-01" }, done: { [`review|${OLD}`]: "2026-10-02" }, pinned: [OLD, OTHER], hq: { [`plan|${OLD}|2|Repeat | it`]: { date: "2026-10-03" } } },
  cosmos: { done: [{ id: `wormhole|${OLD}|${OTHER}`, at: 1 }], hidden: [`map|${OLD}|${OTHER}`], kept: [OLD], missions: [{ a: OLD, baseline: [OLD, OTHER], count: 2 }] }, layouts: { "2d": { [OLD]: { x: 1 } } }, untouched: [1, 1, "plain words", "Old Name.md"] };
const after = R.followMoves(state, moves, none);
assert.deepStrictEqual(after.review.skipped, { [`link|${NEW}|${OTHER}`]: "2026-10-01" }, "a key with two paths");
assert.deepStrictEqual(after.review.done, { [`review|${NEW}`]: "2026-10-02" }, "a key with one path");
assert.deepStrictEqual(after.review.pinned, [NEW, OTHER], "a list");
assert(`plan|${NEW}|2|Repeat | it` in after.review.hq, "a key whose text has its own bar");
assert.strictEqual(after.cosmos.done[0].id, `wormhole|${NEW}|${OTHER}`, "an id in a list of objects");
assert.strictEqual(after.cosmos.missions[0].a, NEW, "a field"); assert.strictEqual(after.cosmos.missions[0].count, 2, "a number");
assert.deepStrictEqual(after.layouts["2d"], { [NEW]: { x: 1 } }, "the saved layout");
assert.deepStrictEqual(after.untouched, [1, 1, "plain words", "Old Name.md"], "a plain name or repeated number isn't a path");
assert(!JSON.stringify(after).includes(OLD), "an old path was left behind");
assert.strictEqual(R.followMoves(state, {}, none), state, "no moves: the same state");

// same note twice: counted once, the newer date kept
const both = R.followMoves({ pinned: [OLD, NEW], done: [{ id: OLD }, { id: NEW }], dates: { [OLD]: "2026-10-05", [NEW]: "2026-10-01" } }, moves, none);
assert.deepStrictEqual(both.pinned, [NEW]); assert.strictEqual(both.done.length, 1); assert.deepStrictEqual(both.dates, { [NEW]: "2026-10-05" });

// chains, circles, a new note on the old path, names that look like object members
const chain = { "a.md": { to: "b.md", at: "1" }, "b.md": { to: "c.md", at: "2" } };
assert.strictEqual(R.movedPath(chain, "a.md", none), "c.md", "two moves in a row");
assert.strictEqual(R.movedPath(moves, OLD, p => p === OLD), OLD, "a new note on the old path took the marks");
assert.strictEqual(R.movedPath({ "x.md": { to: "y.md" }, "y.md": { to: "x.md" } }, "x.md", none), "x.md", "a circle stops");
assert.strictEqual(R.movedPath(moves, "constructor", none), "constructor"); assert.strictEqual(R.followMoves("constructor|toString", moves, none), "constructor|toString");
assert.strictEqual(R.ledgerMoves([{ moved: { "a.md": { to: "old.md", at: "2026-01-01" } } }, { moved: { "a.md": { to: "new.md", at: "2026-02-01" } } }, null])["a.md"].to, "new.md", "the latest move of a path wins");

// another device's ledger: its old marks arrive at the new path, and only moves are kept out of the state
const phone = { done: [{ id: `link|${OLD}|${OTHER}` }], hidden: [`map|${OLD}|${OTHER}`], review: { done: { [`review|${OLD}`]: "2026-10-09" } }, dismissed: [] };
const pc = R.ledgerMoved({ hidden: [OLD], done: [] }, { [OLD]: NEW, "same.md": "same.md" }, "2026-11-01T10:00:00Z", none);
assert.deepStrictEqual(pc.hidden, [NEW], "this device's own marks"); assert.strictEqual(pc.moved[OLD].to, NEW); assert(!("same.md" in pc.moved), "a move to the same path");
const read = R.followLedgers({ v: 1, review: { pinned: [OLD] } }, [phone, pc], none);
assert.deepStrictEqual(read.review.pinned, [NEW], "the shared file"); assert.strictEqual(read.cosmos.done[0].id, `link|${NEW}|${OTHER}`, "the other device's mark");
assert(read.cosmos.hidden.includes(`map|${NEW}|${OTHER}`) && read.review.done[`review|${NEW}`], "the other device's hidden and done");
assert(!JSON.stringify(read).includes(OLD), "an old path came back through a ledger");
assert(!("moved" in read), "the move record joined the shared state");
assert.strictEqual(R.followLedgers(null, [], none), null, "nothing yet stays nothing");
// a later save from a graph opened before the move can't undo it: every read follows again
const stale = R.mergeShared({ review: { pinned: [OLD] } }, { review: { pinned: [OLD] } }, read);
assert.deepStrictEqual(R.followLedgers(stale, [pc], none).review.pinned, [NEW], "an open graph's save restored the old path");
assert(R.isHubName("02-Systems/Kiosk/Kiosk README.md") && R.isHubName("README.md"), "a system's README is a hub, as README was");

(async () => {
  const LEDGERS = R.files.device_ledgers, disk = {}, DEVICE = `${LEDGERS}/test-device.json`, PHONE = `${LEDGERS}/phone.json`, NOTE = Object.assign(new TFile(), { path: NEW });
  disk[R.files.shared] = JSON.stringify({ v: 1, review: { pinned: [OLD], done: { [`review|${OLD}`]: "2026-10-09" } }, cosmos: { hidden: [`map|${OLD}|${OTHER}`] } });
  disk[R.files.dismissed] = JSON.stringify({ version: 1, pairs: [{ a: OLD, b: OTHER, kind: "link" }] });
  disk[PHONE] = JSON.stringify({ v: 1, done: [{ id: `link|${OLD}|${OTHER}` }], dismissed: [{ a: OLD, b: "03-Resources/Third.md" }] });
  const listed = dir => Object.keys(disk).filter(p => p.startsWith(`${dir}/`));
  let saved = 0, redrawn = 0;
  const app = { vault: { getAbstractFileByPath: p => (p === NEW ? NOTE : null),
      adapter: { read: async p => { if (p in disk) return disk[p]; throw new Error("no file"); }, write: async (p, t) => { disk[p] = t; }, exists: async p => p in disk || p === LEDGERS, list: async d => ({ files: listed(d), folders: [] }), mkdir: async () => {} } },
    workspace: { getLeavesOfType: () => [{ view: { render() { redrawn++; } } }] }, loadLocalStorage: () => "test-device", saveLocalStorage() {} };
  const p = Object.assign(Object.create(Plugin.prototype), { app, settings: { sharedPath: R.files.shared, dismissedPath: R.files.dismissed, view: { v: 1, layouts: { "2d": { [OLD]: { x: 5 } }, "3d": {} } } }, saveSettings: async () => { saved++; } });

  p.noteMoved("Not Yet.md", "Middle.md"); p.noteMoved(NEW, OLD);   // two in one batch, as a folder move sends
  await p.flushMoves();
  const shared = JSON.parse(disk[R.files.shared]), ledger = JSON.parse(disk[DEVICE]);
  assert.strictEqual(ledger.moved[OLD].to, NEW, "the move isn't on record for other devices"); assert.strictEqual(ledger.moved["Middle.md"].to, "Not Yet.md", "a batch kept one move");
  assert.deepStrictEqual(shared.review.pinned, [NEW], "the shared file wasn't rewritten");
  assert(shared.review.done[`review|${NEW}`] && !shared.review.done[`review|${OLD}`], "a done mark didn't follow");
  assert(shared.cosmos.done.some(d => d.id === `link|${NEW}|${OTHER}`), "another device's mark didn't follow");
  const dismissed = JSON.parse(disk[R.files.dismissed]);
  assert.deepStrictEqual(dismissed, { version: 1, pairs: [{ a: NEW, b: OTHER, kind: "link" }] }, "the dismissals file wasn't rewritten");
  assert.deepStrictEqual(p.settings.view.layouts["2d"], { [NEW]: { x: 5 } }, "the saved layout didn't follow"); assert(saved > 0, "the layout wasn't saved");
  assert(redrawn > 0, "HQ wasn't redrawn");
  // a graph open during the move saves its old copy: it can't bring the old path back
  assert.deepStrictEqual(p.followSaved({ layouts: { "2d": { [OLD]: { x: 9 } } } }).layouts["2d"], { [NEW]: { x: 9 } }, "an open graph restored an old layout key");
  // the other device, which never heard a rename: it reads the ledger and the marks are on the note there too
  const other = Object.assign(Object.create(Plugin.prototype), { app, settings: { sharedPath: R.files.shared, dismissedPath: R.files.dismissed } });
  disk[R.files.shared] = JSON.stringify({ v: 1, review: { pinned: [OLD] } });
  assert.deepStrictEqual((await other.loadShared()).review.pinned, [NEW], "a device with an old file didn't follow");
  // a device with no state yet has nothing to rewrite and no error
  const empty = {}, fresh = Object.assign(Object.create(Plugin.prototype), { app: { ...app, vault: { ...app.vault, adapter: { read: async q => { if (q in empty) return empty[q]; throw new Error("no file"); }, write: async (q, t) => { empty[q] = t; }, exists: async q => q in empty, list: async () => ({ files: Object.keys(empty), folders: [] }), mkdir: async () => {} } } }, settings: { sharedPath: R.files.shared, dismissedPath: R.files.dismissed }, saveSettings: async () => {} });
  await fresh.recordMoves({ [OLD]: NEW });
  assert.strictEqual(JSON.parse(empty[DEVICE]).moved[OLD].to, NEW); assert(!(R.files.dismissed in empty), "a dismissals file was made from nothing");
  console.log("ok - marks follow a note when it moves");
})().catch(e => { console.error(e); process.exit(1); });
