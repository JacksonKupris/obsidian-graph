# Vault Graph: visual direction

How the plugin should look, so every view, scene, lens and panel looks like it belongs with the others. Change this file when a change needs a new decision.

## Feel

A calm, living map of someone's notes that they open every day. It should look like a well-made toy model: clean solid shapes, soft colour, a little life (a flicker, a walker), never noisy. It's a tool before it's a game, so what each shape *means* has to read at a glance.

Avoid: shapes that float or don't touch (a roof hovering over its walls, a flag in mid-air), hairline gaps between faces, flat cut-out shapes standing in a 3D scene, a scene drawn small in a big empty frame, labels sitting on top of the thing they name, overlays covering each other, one-off colours and line weights.

## Colour

- **Topic colours** (`PALETTE`, `colorOf`) carry the topic everywhere: node, room, bed, column, flag. Scenes tint toward their own ground (`hexMix(colorOf(c), ground, t)`) instead of inventing a new colour per topic.
- **Meaning colours** live once in `UI.colour` (selected = yellow, open tasks = red, skin) and the CSS tokens (`--vg-gap`, `--vg-ok`, `--vg-warn`, `--vg-task`). A scene that needs a colour with a meaning adds it there, not a literal.
- **Stale** is always a desaturated, greyed version of the topic colour; **active** is warm light (yellow glow); **gaps** are red (dashed or cracked).
- Backgrounds are a two-stop gradient (`backdrop`), dark for night-ish scenes, soft sky for daylight ones. Light and dark themes: the HTML follows Obsidian's variables; canvas scenes keep their own ground but must stay readable in both.

## Form

- **Everything solid joins.** Roofs sit on walls, domes sit on roofs, flags stand on the roof line, paths end at nodes. A 3D object is one extruded shape (`prism`), not a front picture plus a separate top.
- 3D goes through the iso kit (`isoKit`): `prism` is the one way to give a shape depth; `block` (a note's box) and `slab` (a floor or board) are built on it. The palace front uses the same `prism` with its oblique depth.
- Faces are sealed: opaque faces get a hairline stroke in their own fill so anti-aliasing never shows a seam. Outlines (edges) go on the top/front face only, about 0.7–1.5 px, darker or lighter than the fill, never black.
- Corner radius in canvas scenes: beds, plaques and cards use 8 px at zoom 1 (scaled by zoom); HTML uses `--vg-r` (10), `--vg-r-sm` (7), `--vg-r-xs` (5).
- Detail follows zoom: names and small marks appear only when there's room (`fitW`, `freeSpot`, `k` thresholds); a far view shows shapes and colour.
- A scene's board or ground is sized to what's on it, and the scene declares its outline (`bounds` in its layout) so the camera frames the whole picture with the usual padding.

## Light and depth

- **One light, from the upper left**, for every 3D scene. Faces turned up take the base colour, faces turned left are darkened by `UI.light.left`, faces turned right by `UI.light.right`; a top face that leans right (a roof slope) by `UI.light.slope`. `prism` picks the shade from each face's direction, so scenes don't choose their own.
- Shadows are soft ellipses on the ground, below and slightly right of the object.
- Glows (activity) are radial gradients of warm yellow, drawn under the object.

## Motion

- Slow and small. Shared motions only (`MOTION`: roam, patrol, drift, orbit...), each note out of phase with the others (seeded by its id).
- Camera moves ease (`animateTo`, ~500 ms); HTML transitions use `--vg-dur` (.18 s) and `--vg-ease`.
- Everything stops under reduced motion.

## Type and spacing (HTML)

- Obsidian's variables first (`--vg-font` from `--font-interface`); sizes from the `--vg-fs-*` scale (11/12/13/15/18).
- Overlays over the canvas (today strip, status pill, floor bar, focus bar) are translucent raised pills with a hairline border and blur. They all start on one line just under the toolbar (`--vg-under-bar`: 52px, 56px in a narrow pane, 58px on a phone) and never overlap: when the today strip spans the pane, the overlays beside it move below it (`--vg-under-today`, the bar line plus the strip). No overlay sets its own top.
- Labels on the canvas use `haloText` / `topicLabel` (a halo in the ground colour), never a box.
- Note names never sit on a shape: `noteLabels` puts a name below its shape, else beside it, else shortened, and leaves it out when there's no room. Every solid or figure a scene draws through `iso.hit` counts as a shape.
