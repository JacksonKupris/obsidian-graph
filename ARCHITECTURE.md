# How Vault Graph is built

**Words.** To a person, everything they open is a **view**, grouped by what they want to know. In the code a view is a graph view or map (`GRAPH_INFO`, `MAPS`), a scene (`src/scenes/`, or a block in a note), or a lens (`LENSES`, a report beside the picture). Use "view" in anything a person reads.

One system, not bolted-on parts: one state, shared rules, one action path, shared helpers. Tests enforce most of what follows (`tests/test_rules.js`), so a change that breaks a rule fails the build instead of drifting.

## Layout

| Path | What it is |
|---|---|
| `src/rules.js` | The rulebook (`VGRules`): what's stale or a record, what's a map and which topic it claims, food-web levels, mention names, the Today list (`todayList`, `todayPick`) and when an item is done, scene-block words, search, the shared-state merge. Rule *data* (folder names, thresholds, patterns): the build puts in defaults; when the plugin loads, `loadRules` layers what the vault's Obsidian settings say (daily notes folder, new-note folder, where person notes live) and then the vault's rules file over them, and `VGRules.configure` rebuilds every rule. The settings tab shows each value and where it comes from, and writes a change into the rules file, which the analysis reads too. |
| `src/actions.js` | The one set of note actions (`VGActions`): Open, Focus, Link to…, Add to map, Still current, Add reference, Complete/Cancel tasks, Archive, Copy. |
| `src/hq.js`, `src/hq.css` | Vault HQ (`mountVaultHQ`): the vault's home screen (Home feed, Today, Needs you, Projects), plain DOM, mounted by the plugin's `vault-graph-hq` view and the HQ test page. Its lists are the Today list filtered by group; its buttons are `VGActions.runToday` / `runMore`. Calendar reads `doneToday`; the board's moves are the drawer's `setStatus`; selected rows use `runBatch`; a focus session's minutes go in the shared file (`review.sessions`). What it reads from notes is `VGRules.hqKind` / `hqGather` (the rules file's `hq` block); the plugin gathers it into `graphData().hq`. |
| `src/view/*.js`, `src/view.css` | The renderer (`mountVaultGraph`): every view, lens, panel and the inspector, shared by the plugin and the standalone page. One closure in parts the build joins in name order (`00-core` … `70-shell`, listed at the top of `00-core.js`); tests read it through `build.viewSource()` / `viewParts()`. |
| `src/science.js` | `VGScience`: the methods behind the science views and lenses (Kaplan-Meier, log-rank, SIR as percolation, Tarjan, Newman-Ziff, leaky integrate-and-fire, reservoirs, brain anatomy), with nothing about Obsidian or the screen in them. `tests/test_science.js` holds them to published or closed-form answers. A view computes here and only draws the result. |
| `src/view/12-gl.js` | The WebGL2 layer under the 2D canvas for the 3D graph and the 3D brain: a depth buffer, lit spheres, fog, shadows, the brain's mesh and its spiking network. No library. Positions come from `proj()`, so clicks land on what's drawn; labels and rings stay on the 2D canvas. No WebGL, a lost context, or a small pane: the 2D drawing as before. Everything else still draws in 2D; views marked 3D there lean back with CSS. |
| `src/scenes/*.js` | Map views as components; the build puts each in its own scope at the `/*@scenes*/` marker. |
| `src/plugin.js` | The Obsidian plugin shell: views, sidebar, settings, write actions, the live merge. |
| `config/rules.json` | Default rule data (the sample vault's). A vault keeps its own copy; deploy checks it has every key this one has. |
| `build.js` | Joins the sources into `main.js` (rules + actions + view + scenes + plugin), `styles.css`, `manifest.json`, and `rules.js` (the rulebook alone, for a vault's own checks). Also builds the standalone page. |
| `tests/` | `run.js` (fast: build, `test_rules.js`, `smoke_page.js`), plus `click_all.js`, `layout_random.js`, `shots.js`, `polish_loop.js`. All run on `fixtures/` by default, or a real vault with `--vault`. `env.js` decides which. |
| `fixtures/` | `make_sample.js` generates the sample vault and, with `--analyse`, its graph data (`sample-graph.json`). |
| `analysis/` | The Python analysis (graph data, map and gap analysis), installed into the vault by deploy. |
| `scripts/deploy.js` | Build with a vault's rules, test on its data, install, run the vault's own checks, reload in Obsidian. |

## Rules

- **Rules live in one place.** Rule data is a vault's rules file; rule code is `src/rules.js`. The analysis (`analysis/vault_graph_rules.py`) reads the same rules file. Change a rule there, never in a view.
- **Folder and file names** (inbox, daily, people, archive, skip, reports, scenes, cache, tooling folders, excluded folders; the data, analysis, dismissed and shared files) are in the rules file's `folders` and `files`. A test fails on a vault folder name in the code. Another vault edits that one block.

## One action path

- **Writes go through the plugin's `WRITE_ACTIONS`**, and those touch the vault only through `WRITE_PRIMITIVES` (`ioProcess`, `ioModify`, `ioFrontMatter`, `ioCreate`, `ioRename`…), which record each change. So every action can be undone: `VGActions.run` puts an Undo button on the message that confirms it (graph toast, sidebar notice), and an undo is refused if a file changed since. The undo list is this session's last 20 actions.
- Each action waits for Obsidian to re-index the change, re-merges the state once and redraws every surface (graphs, local pane, note embeds, sidebar) before it returns.
- A note in the inbox joins the graph once a topic note links to it, unless it's tagged `meta/*` or `type/report`. Links are written with `linkText()`, so same-name notes don't steal them.

## One state

- **Data is always live.** The plugin keeps one merged state (`graphData()`) that every surface redraws from: the analysis output plus Obsidian's own index (`liveMerge`), so links, tasks, tags, maps, new and deleted notes show at once. The desktop plugin re-runs the analysis 30 s after the last edit. There is no manual refresh step.
- **Shared state across devices** (review skips, today's three, XP, saved views) is one synced file. Each save merges with the file on disk (`VGRules.mergeShared`, three-way, against what this view last read or wrote), and each device also keeps a ledger of its marks (`ledgerAdd` / `applyLedgers`), so a device whose copy Sync dropped loses nothing. Marks are keyed by path, so they follow a note when it moves: a rename goes in this device's ledger (`recordMoves`, `moved`), and every read goes through `followLedgers`, since Sync shows another device a move as a delete and a create.

## Shared parts, not per-surface copies

- `src/actions.js` is rendered by the inspector, the suggestions sidebar, every lens row's "⋯" menu and the Today panel; a test fails if a surface builds its own archive or close-all-tasks again.
- **One list of next steps.** `VGRules.todayList(data)` ranks every suggestion (link a pair, add a note to its map, write a wanted note, review a quiet relied-on note, give a topic a map, link an unlinked note); `VGActions.TODAY` does each one. The graph's Insights card, its game panel and the sidebar draw that list; today's three are its first three (`todayPick`), kept for the day for XP. It replaced the review queue, daily quests and missions, which were three overlapping lists. A test fails if a surface builds its own list again. It also holds the vault's own work from `data.hq` (today's journal tasks, the last standup's plan, carried-over tasks, scopes waiting on approval, drafts to review, failed or late jobs, the vault backlog, reports to tick); each item has a group (`VGRules.todayGroup`: today, needs, upkeep) and each surface filters by it: the graph shows upkeep, HQ and the sidebar show all. HQ's Later and a plan item's Done are marks in the shared file (`review.hq`), kept out of the device ledgers so Undo can take them back.
- Task lists stay open across redraws (`toggleTasks`); map labels stay inside the pane (`haloText` / `freeSpot` / `fitW`).
- Empty states point to a next step (`emptyNext`); the smoke test fails on a lens with nothing to click, on a 6-note vault and an empty one.

## Scenes

- **Scenes are components.** Each registers itself with `scene(key, {...})` (name, icon, layout, draw, legend, today strip, highlight, fit, `iso`, `press`). 3D goes through the shared iso kit (`isoKit(R, k, "iso" | "tilt")`: project, wall, slab, block, hit, depth sort).
- Scenes share helpers instead of their own copies (a test enforces it): `topicNotes`, `topicBusy`, `topicPair`, `topicsWithNotes`, `daylight`, `topicLabel`, `backdrop`, `scatter`, `byImportance` / `byInfluence`, the `walker` figure, `windowSprite`, `MOTION`, `gridDims` and `chance`. Colours that carry a meaning, timings and sizes are in the renderer's one `UI` settings object.
- **A scene can be a game.** With `game: true`, `pointer`, `wheel` and `escape` it owns the canvas (`src/scenes/dungeon.js`: a raycaster, levels generated from topics, every note an enemy). A game reads the vault and writes nothing. The class `is-playing` gives it the whole pane while it's played.
- **Time-lapse is one control for every view.** The toolbar's clock (or T) plays the notes in birth order, the slider goes to any point, Close returns to now. `replay` holds the point; `baseVisible` filters by it, so a view that draws through `mapShown`/`visible` follows without code of its own, and `st.timeAt` gives the date to views that redraw their own history. `tests/test_timelapse.js` checks every view draws nothing from the future.
- **2D and 3D are one control for every view** (`setDim`, `syncDim`). The graph swaps its layouts, a scene drawn through the iso kit changes angle, Neural lies flat or turns, and any other view leans back with a CSS perspective on the canvas, whose hit tests read `offsetX/Y`, which the browser un-projects. `tests/test_dimensions.js` checks every view.
- **Scenes written in notes**: a ` ```vault-graph-scene ` block (YAML) in any note becomes a view. Its words are listed once in `src/rules.js` (`SCENE_WHEN`, `SCENE_PARTS`, `sceneSpec`); the renderer builds the scene from shared parts (`specScene`). A test fails if a word has no part.

## The analysis

**It's moving into the plugin** (`src/engine.js`; plan in the vault: `Vault Graph One System Plan 2026-11-03`). Today a vault with no analysis file gets the engine's whole graph (`graphData` → `engineData`), and a desktop with the analysis takes the parts its rules file lists in `engine_owns` over the file (`VGRules.applyEngineNotes`: mentions, tasks, people, series, follow, dupes); a phone keeps the desktop's file. The slow steps run in a worker (`VGEngine.run`). `tests/test_no_python.js` scores every view without the analysis and fails if the list of what's missing changes, in either direction. Topic counts move with ordinary edits (Louvain: removing one link moved 6 of 537 notes), so compare the engine with the analysis on the same graph, as the vault's `test_graph_vault.js` does, not on counts taken at different moments. Where the two read a link differently, Obsidian wins: the analysis accepts `[[Old Folder/Note]]` by its last part, Obsidian calls it unresolved; and a `[[Note|alias]]` in a table row with a raw pipe is no link to Obsidian, while the analysis counted it on every day the row was carried forward.

`analysis/` is the Python analysis: `vault_graph.py` writes the graph data every device reads (topics, gaps, bridges, follow-through, the weekly State of the Vault note with `--state`); `vault_gaps.py` and `moc_align.py` are the gap and map analysis the vault's reports also use; `vault_graph_rules.py` reads the same rules file as `src/rules.js`. Deploy installs them into the vault's scripts folder, where the desktop plugin runs them (`files.analysis`) and Sync carries them to every PC; it refuses to overwrite a vault copy edited since the last deploy (`vault-graph-deployed.json` records what it installed).

They still use the vault's `_System/vault_lib.py` (file listing, link patterns, the cache folder), which the vault's other tools share. Making the analysis stand alone (that small core here, vault-specific choices as plugin settings) is what using the plugin in another vault needs next.
