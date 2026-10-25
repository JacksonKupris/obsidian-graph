# How Vault Graph is built

One system, not bolted-on parts: one state, shared rules, one action path, shared helpers. Tests enforce most of what follows (`tests/test_rules.js`), so a change that breaks a rule fails the build instead of drifting.

## Layout

| Path | What it is |
|---|---|
| `src/rules.js` | The rulebook (`VGRules`): what's stale or a record, what's a map and which topic it claims, food-web levels, mention names, the Today list (`todayList`, `todayPick`) and when an item is done, scene-block words, search, the shared-state merge. Rule *data* (folder names, thresholds, patterns): the build puts in defaults; when the plugin loads, `loadRules` layers what the vault's Obsidian settings say (daily notes folder, new-note folder, where person notes live) and then the vault's rules file over them, and `VGRules.configure` rebuilds every rule. The settings tab shows each value and where it comes from, and writes a change into the rules file, which the analysis reads too. |
| `src/actions.js` | The one set of note actions (`VGActions`): Open, Focus, Link to…, Add to map, Still current, Add reference, Complete/Cancel tasks, Archive, Copy. |
| `src/view/*.js`, `src/view.css` | The renderer (`mountVaultGraph`): every view, lens, panel and the inspector, shared by the plugin and the standalone page. One closure in parts the build joins in name order (`00-core` … `70-shell`, listed at the top of `00-core.js`); tests read it through `build.viewSource()` / `viewParts()`. |
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
- Each action waits for Obsidian to re-index the change, re-merges the state once and redraws every surface (graphs, local pane, home cards, note embeds, sidebar) before it returns.
- A note in the inbox joins the graph once a topic note links to it, unless it's tagged `meta/*` or `type/report`. Links are written with `linkText()`, so same-name notes don't steal them.

## One state

- **Data is always live.** The plugin keeps one merged state (`graphData()`) that every surface redraws from: the analysis output plus Obsidian's own index (`liveMerge`), so links, tasks, tags, maps, new and deleted notes show at once. The desktop plugin re-runs the analysis 30 s after the last edit. There is no manual refresh step.
- **Shared state across devices** (review skips, today's three, XP, saved views) is one synced file. Each save merges with the file on disk (`VGRules.mergeShared`, three-way, against what this view last read or wrote), and each device also keeps a ledger of its marks (`ledgerAdd` / `applyLedgers`), so a device whose copy Sync dropped loses nothing.

## Shared parts, not per-surface copies

- `src/actions.js` is rendered by the inspector, the suggestions sidebar, every lens row's "⋯" menu and the Today panel; a test fails if a surface builds its own archive or close-all-tasks again.
- **One list of next steps.** `VGRules.todayList(data)` ranks every suggestion (link a pair, add a note to its map, write a wanted note, review a quiet relied-on note, give a topic a map, link an unlinked note); `VGActions.TODAY` does each one. The graph's Insights card, its game panel and the sidebar draw that list; today's three are its first three (`todayPick`), kept for the day for XP. It replaced the review queue, daily quests and missions, which were three overlapping lists. A test fails if a surface builds its own list again.
- Task lists stay open across redraws (`toggleTasks`); map labels stay inside the pane (`haloText` / `freeSpot` / `fitW`).
- Empty states point to a next step (`emptyNext`); the smoke test fails on a lens with nothing to click, on a 6-note vault and an empty one.

## Scenes

- **Scenes are components.** Each registers itself with `scene(key, {...})` (name, icon, layout, draw, legend, today strip, highlight, fit, `iso`, `press`). 3D goes through the shared iso kit (`isoKit(R, k, "iso" | "tilt")`: project, wall, slab, block, hit, depth sort).
- Scenes share helpers instead of their own copies (a test enforces it): `topicNotes`, `topicBusy`, `topicPair`, `topicsWithNotes`, `daylight`, `topicLabel`, `backdrop`, `scatter`, `byImportance` / `byInfluence`, the `walker` figure, `windowSprite`, `MOTION`, `gridDims` and `chance`. Colours that carry a meaning, timings and sizes are in the renderer's one `UI` settings object.
- **Scenes written in notes**: a ` ```vault-graph-scene ` block (YAML) in any note becomes a view. Its words are listed once in `src/rules.js` (`SCENE_WHEN`, `SCENE_PARTS`, `sceneSpec`); the renderer builds the scene from shared parts (`specScene`). A test fails if a word has no part.

## The analysis

`analysis/` is the Python analysis: `vault_graph.py` writes the graph data every device reads (topics, gaps, bridges, follow-through, the weekly State of the Vault note with `--state`); `vault_gaps.py` and `moc_align.py` are the gap and map analysis the vault's reports also use; `vault_graph_rules.py` reads the same rules file as `src/rules.js`. Deploy installs them into the vault's scripts folder, where the desktop plugin runs them (`files.analysis`) and Sync carries them to every PC; it refuses to overwrite a vault copy edited since the last deploy (`vault-graph-deployed.json` records what it installed).

They still use the vault's `_System/vault_lib.py` (file listing, link patterns, the cache folder), which the vault's other tools share. Making the analysis stand alone (that small core here, vault-specific choices as plugin settings) is what using the plugin in another vault needs next.
