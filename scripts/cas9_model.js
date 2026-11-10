#!/usr/bin/env node
// Writes src/view/14-cas9-model.js: the molecule the CRISPR view draws (src/scenes/cas9.js), from two public crystal structures.
//   5F9R  S. pyogenes Cas9 with its guide RNA on double-stranded DNA, primed to cut (Jiang et al., Science 351:867, 2016)
//   1BNA  the B-DNA dodecamer (Drew et al., PNAS 78:2179, 1981): one base pair and the step to the next one
// Protein Data Bank entries are public domain (CC0). Run it again only to change the model; the output is committed.
//   node scripts/cas9_model.js            downloads the two files to .out/pdb/ if they aren't there, then writes the model
//   node scripts/cas9_model.js --print    the numbers only, nothing written
// Offline: put 5F9R.pdb and 1BNA.pdb (https://files.rcsb.org/download/<ID>.pdb) in .out/pdb/ yourself.
// What it does: keeps the atoms that can be seen from outside, turns the complex so the DNA runs left to right, packs each
// atom into three bytes, and works out where the DNA carries on past both ends of the crystal (the frames the scene grows
// its two tails from). It stops, saying why, if the structure isn't what it expects.
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), OUT = path.join(ROOT, "src", "view", "14-cas9-model.js"), CACHE = path.join(ROOT, ".out", "pdb");
const PRINT = process.argv.includes("--print");
const stop = msg => { console.error("cas9_model: " + msg); process.exit(1); };
const need = (ok, msg) => { if (!ok) stop(msg); };

async function pdb(id) {
  const file = path.join(CACHE, id + ".pdb"), url = `https://files.rcsb.org/download/${id}.pdb`;
  if (!fs.existsSync(file)) {
    let res; try { res = await fetch(url); } catch (e) { stop(`couldn't reach ${url} (${e.message}). Download it by hand to ${file} and run this again.`); }
    if (!res.ok) stop(`${url} answered ${res.status}. Download it by hand to ${file} and run this again.`);
    fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(file, await res.text());
  }
  const atoms = fs.readFileSync(file, "utf8").split("\n")
    .filter(l => (l.startsWith("ATOM") || (l.startsWith("HETATM") && l.slice(17, 20) === "GTP")) && " A".includes(l[16]) && l.slice(76, 78).trim() !== "H")
    .map(l => ({ name: l.slice(12, 16).trim(), res: l.slice(17, 20).trim(), chain: l[21], seq: +l.slice(22, 26), p: [+l.slice(30, 38), +l.slice(38, 46), +l.slice(46, 54)] }));
  need(atoms.length > 100, `${file} has no atoms in it: delete it and run this again`);
  return atoms;
}

// ---- vectors, and the best turn-and-shift from one set of points onto another (Horn 1987, by quaternion)
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]), unit = a => mul(a, 1 / len(a)), dist = (a, b) => len(sub(a, b));
const mean = ps => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);
const apply = (R, v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)];
function topEigen4(A) {   // the eigenvector of a symmetric 4x4 with the largest eigenvalue (cyclic Jacobi)
  const a = A.map(r => r.slice()), V = [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => +(i === j)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) off += a[i][j] * a[i][j]; if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) { if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 4; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 4; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; } }
  }
  let best = 0; for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return V.map(r => r[best]);
}
function superpose(from, to) {   // { R, t, rmsd } with R·from + t as near to `to` as a rigid move gets
  const cf = mean(from), ct = mean(to), S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  from.forEach((p, n) => { const a = sub(p, cf), b = sub(to[n], ct); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += a[i] * b[j]; });
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const [w, x, y, z] = topEigen4([[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]]);
  const R = [[w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z]];
  const t = sub(ct, apply(R, cf));
  return { R, t, rmsd: Math.sqrt(from.reduce((s, p, n) => s + dist(add(apply(R, p), t), to[n]) ** 2, 0) / from.length) };
}
// a rigid move as a screw: turn `angle` about the line through `point` along `axis`, and slide `rise` along it
function screwOf({ R, t }) {
  const axis = unit([R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]]), angle = Math.acos(Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2)));
  const rise = dot(t, axis), flat = sub(t, mul(axis, rise));
  return { axis, angle, rise, point: add(mul(flat, 0.5), mul(cross(axis, flat), 0.5 / Math.tan(angle / 2))) };
}

const residues = (atoms, chain) => { const m = new Map(); atoms.filter(a => a.chain === chain).forEach(a => { if (!m.has(a.seq)) m.set(a.seq, { seq: a.seq, res: a.res, atoms: {} }); m.get(a.seq).atoms[a.name] = a.p; }); return m; };
// the atoms a DNA and an RNA backbone both have: what one base pair is laid over another by
const BACKBONE = ["P", "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "C1'"];
const spine = (r, skip = []) => BACKBONE.filter(n => !skip.includes(n)).map(n => { need(r.atoms[n], `residue ${r.res}${r.seq} has no ${n} atom`); return r.atoms[n]; });

(async () => {
  const complex = await pdb("5F9R"), bdna = await pdb("1BNA");
  const B = { protein: "B", rna: "A", target: "C", other: "D" };
  const rna = residues(complex, B.rna), tgt = residues(complex, B.target), oth = residues(complex, B.other);
  need(complex.filter(a => a.chain === B.protein).length > 9000 && rna.size >= 110 && tgt.size === 30 && oth.size === 19, "5F9R doesn't hold the chains this expects (B Cas9, A guide RNA, C target strand, D the other strand)");
  // ---- one B-DNA base pair, and the step to the next one, from the middle of 1BNA
  const sA = residues(bdna, "A"), sB = residues(bdna, "B"), pairOf = i => [sA.get(i), sB.get(25 - i)];   // strand A's base i pairs with B's 25 - i
  // the helix's own step: the one rigid move that lays pairs 3 to 8 over pairs 4 to 9 (single steps vary with the letters)
  const both = i => [...spine(pairOf(i)[0]), ...spine(pairOf(i)[1])], span = [3, 4, 5, 6, 7, 8];
  const whole = superpose(span.flatMap(both), span.flatMap(i => both(i + 1))), DEG = 180 / Math.PI, moved = p => add(apply(whole.R, p), whole.t);
  const miss = i => { const from = both(i).map(moved), to = both(i + 1); return Math.sqrt(from.reduce((t, p, n) => t + dist(p, to[n]) ** 2, 0) / from.length); };
  const step = { ...screwOf(whole), i: span.slice().sort((p, q) => miss(p) - miss(q))[0] };   // the template is the pair the step carries best
  need(step.rise > 3.1 && step.rise < 3.6 && step.angle * DEG > 33 && step.angle * DEG < 39, `1BNA's step isn't B-DNA: turn ${(step.angle * DEG).toFixed(1)}°, rise ${step.rise.toFixed(2)} Å`);
  // the pair in the helix's own frame: z along the axis, the origin on it level with the pair's middle
  const [tA, tB] = pairOf(step.i), tAll = [...Object.values(tA.atoms), ...Object.values(tB.atoms)], mid = mean(tAll);
  const o0 = add(step.point, mul(step.axis, dot(sub(mid, step.point), step.axis))), ex0 = unit(sub(sub(tA.atoms.P, o0), mul(step.axis, dot(sub(tA.atoms.P, o0), step.axis)))), ey0 = cross(step.axis, ex0);
  const local = p => { const d = sub(p, o0); return [dot(d, ex0), dot(d, ey0), dot(d, step.axis)]; };
  const BASE = n => !n.includes("'") && !/^(P|OP\d)$/.test(n);
  const template = [tA, tB].flatMap((r, strand) => Object.entries(r.atoms).map(([name, p]) => ({ name, strand, base: BASE(name), p: local(p) })));
  // pair k of an ideal helix: the template turned k steps and slid k rises
  const ideal = (p, k) => { const c = Math.cos(k * step.angle), s = Math.sin(k * step.angle); return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2] + k * step.rise]; };
  const next = [...spine(pairOf(step.i + 1)[0]), ...spine(pairOf(step.i + 1)[1])], made = [...spine(tA), ...spine(tB)].map(p => ideal(local(p), 1));
  const back = { rmsd: Math.sqrt(made.reduce((t, p, n) => t + dist(add(o0, add(add(mul(ex0, p[0]), mul(ey0, p[1])), mul(step.axis, p[2]))), next[n]) ** 2, 0) / made.length) }; need(back.rmsd < 0.9, `the step doesn't carry 1BNA's pair ${step.i} onto pair ${step.i + 1} (off by ${back.rmsd.toFixed(2)} Å)`);
  const radiusP = Math.hypot(...local(tA.atoms.P).slice(0, 2));

  // ---- where the DNA carries on past the crystal. A tail's frame: an ideal helix laid over the last pairs of the crystal,
  // strand A of the template on the strand that runs outward 5' to 3'. `from` lists those pairs outward, [outward strand, partner].
  const tplSpine = (skip) => [0, 1].flatMap(s => BACKBONE.filter(n => !skip.includes(n)).map(n => template.find(a => a.strand === s && a.name === n).p));
  function tail(from, skip, extra) {
    const m = from.length, there = from.flatMap(([a, b]) => [...spine(a, skip), ...spine(b, skip)]), here = from.flatMap((_, k) => tplSpine(skip).map(p => ideal(p, k)));
    const fit = superpose(here, there), col = j => fit.R.map(r => r[j]);
    // the first new pair is `m + extra` steps along (extra: pairs the crystal doesn't show before the tail starts)
    return { o: add(fit.t, mul(col(2), (m + extra) * step.rise)), x: col(0), y: col(1), z: col(2), phase: (m + extra) * step.angle, rmsd: fit.rmsd };
  }
  // PAM side: the duplex ends at target 1 : other 30, and outward is the other strand's 3' direction
  const near = tail([[oth.get(28), tgt.get(3)], [oth.get(29), tgt.get(2)], [oth.get(30), tgt.get(1)]], ["P"], 0);   // target 1 starts its chain: no phosphate
  // far side: the target strand leaves the RNA at its 3' end (target 29 pairs with RNA 2; 30 with RNA 1, which has no full backbone)
  const P1 = ["P", "O5'"];   // RNA 1 is a triphosphate start: the first two backbone atoms aren't where a chain's would be
  const far = tail([[tgt.get(28), rna.get(3)], [tgt.get(29), rna.get(2)]], P1, 1);
  need(near.rmsd < 2.2 && far.rmsd < 3, `the tails don't sit on the crystal's ends (off by ${near.rmsd.toFixed(2)} and ${far.rmsd.toFixed(2)} Å)`);

  // ---- the atoms that can be seen: one with any point of its surface free of its neighbours (a small probe, so cracks stay closed)
  const kept = complex.filter(a => Object.values(B).includes(a.chain)), RAD = 1.8, PROBE = 0.6, reach = RAD + PROBE, CELL = 2 * reach, grid = new Map();
  const key = p => `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)},${Math.floor(p[2] / CELL)}`;
  kept.forEach(a => { const k = key(a.p); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(a); });
  const dirs = Array.from({ length: 60 }, (_, i) => { const z = 1 - 2 * (i + 0.5) / 60, r = Math.sqrt(1 - z * z), t = i * Math.PI * (3 - Math.sqrt(5)); return [r * Math.cos(t), r * Math.sin(t), z]; });
  const nucleic = a => a.chain !== B.protein;
  const seen = kept.filter(a => { const c = a.p.map(v => Math.floor(v / CELL)), nb = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (const b of grid.get(`${c[0] + i},${c[1] + j},${c[2] + k}`) || []) if (b !== a && dist(a.p, b.p) < 2 * reach) nb.push(b.p);
    return nucleic(a) && a.name === "P" || dirs.some(d => { const q = add(a.p, mul(d, reach)); return !nb.some(p => dist(p, q) < reach); }); });

  // ---- turn it: x along the DNA (far end to PAM end), the nucleic acids toward the viewer (-z), the origin at the middle
  const centre = mean(seen.map(a => a.p)), ax = unit(sub(near.o, far.o)), nc = sub(mean(seen.filter(nucleic).map(a => a.p)), mean(seen.filter(a => !nucleic(a)).map(a => a.p)));
  const az = unit(mul(sub(nc, mul(ax, dot(nc, ax))), -1)), ay = cross(az, ax), turn = p => { const d = sub(p, centre); return [dot(d, ax), dot(d, ay), dot(d, az)]; }, turnV = v => [dot(v, ax), dot(v, ay), dot(v, az)];
  const order = [B.protein, B.rna, B.target, B.other], atoms = order.flatMap(c => seen.filter(a => a.chain === c)), pts = atoms.map(a => turn(a.p));
  const lo = [0, 1, 2].map(i => Math.min(...pts.map(p => p[i]))), hi = [0, 1, 2].map(i => Math.max(...pts.map(p => p[i]))), q = Math.max(...hi.map((h, i) => h - lo[i])) / 255;
  const bytes = Buffer.alloc(atoms.length * 3); pts.forEach((p, n) => { for (let i = 0; i < 3; i++) bytes[n * 3 + i] = Math.round((p[i] - lo[i]) / q); });
  // each nucleic acid residue's atoms, in order: [residue number, how many atoms]
  const table = c => { const out = []; atoms.filter(a => a.chain === c).forEach(a => { const l = out[out.length - 1]; if (l && l[0] === a.seq) l[1]++; else out.push([a.seq, 1]); }); return out; };
  const tables = { rna: table(B.rna), target: table(B.target), other: table(B.other) };
  need(tables.rna.length === rna.size && tables.target.length === 30 && tables.other.length === 19, "a nucleic acid residue was lost: every one has to keep an atom");
  const r3 = v => v.map(n => +n.toFixed(3)), frame = t => ({ o: r3(turn(t.o)), x: r3(turnV(t.x).map(n => n)), y: r3(turnV(t.y)), z: r3(turnV(t.z)), phase: +t.phase.toFixed(4) });
  const model = {
    source: "PDB 5F9R (Jiang et al., Science 351:867, 2016) and 1BNA (Drew et al., PNAS 78:2179, 1981); public domain",
    q: +q.toFixed(5), lo: r3(lo), radius: RAD,
    protein: atoms.filter(a => a.chain === B.protein).length, ...tables,
    // what pairs with what, by residue number. spacer: guide letter i (RNA i + 1) pairs with target 30 - i. pam: the three
    // pairs the enzyme reads before it opens the DNA. flank: the duplex pairs past the PAM, nearest first, [target, other].
    spacer: 20, pam: [[10, 21], [9, 22], [8, 23]], flank: [[7, 24], [6, 25], [5, 26], [4, 27], [3, 28], [2, 29], [1, 30]],
    step: { turn: +step.angle.toFixed(5), rise: +step.rise.toFixed(4) },
    pair: template.map(a => [...r3(a.p), a.strand, +a.base]),
    tails: { near: frame(near), far: frame(far) },
    atoms: bytes.toString("base64"),
  };
  const report = `atoms ${atoms.length} of ${kept.length} (protein ${model.protein}) · ${(q).toFixed(3)} Å a step · B-DNA step from 1BNA pair ${step.i}: turn ${(step.angle * DEG).toFixed(1)}°, rise ${step.rise.toFixed(2)} Å, P at ${radiusP.toFixed(1)} Å, carried over within ${back.rmsd.toFixed(2)} Å · tails sit on the crystal within ${near.rmsd.toFixed(2)} Å (PAM side) and ${far.rmsd.toFixed(2)} Å (far side)`;
  console.log(report);
  if (PRINT) return;
  const js = `  // ---------------------------------------------------------------- the Cas9 model's data
  // GENERATED by scripts/cas9_model.js; do not edit. ${model.source}.
  // ${report}
  const CAS9_MODEL = ${JSON.stringify(model)};
`;
  fs.writeFileSync(OUT, js); console.log(`wrote ${path.relative(ROOT, OUT)} (${(js.length / 1024).toFixed(0)} KB)`);
})();
