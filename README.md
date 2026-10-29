# Vault Graph

An Obsidian plugin that maps your vault: it finds the topics your notes form, the notes that hold them together, and the places where they should connect but don't. Then it gives you one short list of things worth doing about it, each one click.

## What you get

- **Today**: one list of next steps, with today's three at the top. Link two notes that belong together, add a note to its topic's map, write a note other notes already link to, check that a note you rely on is still current, give a topic a map, link a note nothing points to. Each has its button and Undo. It's in the graph's Insights tab, its Today panel (the flag button, or G) and the sidebar.
- **Map**: the graph itself in 2D or 3D, coloured by topic, with the bridge notes and the gaps between topics.
- **Scenes**: the same notes as pictures (a city, a garden, a palace, the sky, a food web…), and scenes you write yourself in a note.
- **Lenses**: questions you can ask (what's important but stale, what to write next, which notes are duplicates, what a folder mixes).
- **Search**: finds what you half remember: misspellings, "last week", a person's name, "near" a note.
- **Cosmos**: every body offers notes at a distance (black hole 0; a binary's or planet's notes 1; a star's rings 1-3, up to three links away) and each note goes to the nearest. Ties go to black hole, then binary, planet, star, then target-path order, independent of placement order. Saved stars must target existing notes after vault reorganizations.

It never changes a note without asking, and every change it makes can be undone.

## Install

With [BRAT](https://github.com/TfTHacker/obsidian42-brat): **Add beta plugin** → `JacksonKupris/obsidian-graph`, then enable **Vault Graph**. BRAT keeps it updated from the releases.

By hand:

1. Take a [release](https://github.com/JacksonKupris/obsidian-graph/releases)'s `main.js`, `styles.css` and `manifest.json`, or build them (`npm run build`, see below).
2. Put them in `<your vault>/.obsidian/plugins/jk-vault-graph/`.
3. In Obsidian: Settings → Community plugins → turn off Restricted mode if it's on, then enable **Vault Graph**.
4. Open it with the ribbon's **Open Vault Graph** button (a fork icon), or the command **Vault Graph: Open graph**. **Vault Graph: Open suggestions sidebar** opens the sidebar for the note you're on.

That's all it needs. The plugin reads your notes through Obsidian's own index, works out the topics itself, and works on phones too.

## Settings

Settings → Vault Graph → **This vault** shows the folders it uses (inbox, daily notes, people, archive, reports) and how many days until a note counts as stale, with where each value comes from: your Obsidian settings (the Daily notes folder, the folder new notes go in), the defaults, or the vault's rules file. Change one there and it's saved to the rules file.

Topic names lead with the system they're about ("AWS SES · Bounce Handling"), taken from the `technology/` or `project/` tag most of a topic's notes share. To name your own systems well, add them to the rules file's `stack` block: `words` for how a tag is spelled in a name (`"odoo": "Odoo"`), `platforms` for project tags that name a platform, and `skip` for tags too broad to name a topic.

## Optional extras

- **Smart Connections**: if that plugin has indexed your vault, Vault Graph uses its note similarity too, for topics and for "these two notes mean the same thing" suggestions.
- **The analysis** (`analysis/`, Python 3 with PyYAML, desktop only): adds what Obsidian's index alone can't give, mostly from daily notes: which notes you mention together, timelines, follow-through on plans. Without it the plugin still finds the topics and suggestions itself.
- **Your own scenes**: a ```` ```vault-graph-scene ```` block in any note becomes a view. The **New scene** tile in Scenes writes one for you.

## Develop

How it's put together: [ARCHITECTURE.md](ARCHITECTURE.md). Where it's going: [ROADMAP.md](ROADMAP.md).
Release prerequisites, manual steps and recovery: [RELEASING.md](RELEASING.md).

```sh
npm test                      # build + rules/code checks + every view and lens on the sample vault
npm run test:vault            # the same on a real vault (local.json's "vault", or --vault <dir>)
npm run build                 # dist/: main.js, styles.css, manifest.json, rules.js, engine.js (sample rules)
npm run deploy                # test on the vault, install the analysis and its check files there (--plugin: this build too, until the next release)
npm run release [-- minor]    # bump, test, tag and push; CI publishes the release, then BRAT installs it in a running Obsidian
npm run page -- --data <graph.json> [--rules <file>]   # the standalone graph page, in .out/
npm run sample -- --analyse   # regenerate fixtures/ with analysis/ (uses the vault's _System/vault_lib.py)
```

Slower checks, by hand: `node tests/click_all.js [--mobile]` (every control, about 5 minutes), `node tests/layout_random.js`, `node tests/shots.js [--mobile]`, `node tests/polish_loop.js [--full]`. Each takes `--vault` too. They need Chrome.

HQ's Automations shortcut opens every scheduled job, including healthy jobs; Needs you keeps the jobs that need attention. The navigation regression uses real pointer clicks between Needs you, Projects and Automations on desktop and phone layouts. Sample-vault notes regenerate when the local calendar day changes, so cached journals cannot silently remove today's test tasks.

HQ has a persistent search across Home, Today, Needs you, Projects and their subviews. It searches open HQ items, every project (independent of the Projects filters), and vault notes using the shared fuzzy scorer and Recall engine; matches include source paths and context, project results open their details, and note results open the source note. The query and keyboard focus survive screen changes and live refreshes; Clear returns to the current screen without changing its project filters. Labeled **Kind**, **System** and **Project status** dropdowns remain on Projects, retaining kind/status counts and the default **All kinds / All systems / In progress** selection. System options come from `project/` and `system/` tags or `system`/`project` frontmatter; **Compact list** and **Needs classification** remain available. Details show parent/related links and each task's source heading and parent task. The automated phone-sized browser check is not a physical-phone acceptance.

Today prioritizes daily work over old approvals. Repeated task wording is grouped for review, not merged: every source retains its own actions. Daily shortcuts prefer the matching year/month journal path and warn about other copies; they do not delete or merge notes or fix the daily-note creator's configuration.

HQ's week strip opens a date's **Journal / Standup** chooser on desktop and mobile. Each action says **Open** or **Create**; Cancel writes nothing. Creation uses the selected date, including another month or year, under `<daily folder>/YYYY/MM-Month/Journal/YYYY-MM-DD.md` or `Standups/Daily Standup YYYY-MM-DD.md`. The dock's journal shortcut uses the same action for today. Existing notes are opened unchanged (canonical copies take priority); rapid clicks do not create numbered duplicates.

Journal creation uses the enabled Periodic Notes daily template, then Core Daily Notes' template, then `<templates folder>/Daily Notes Template.md`. Standups use `<templates folder>/Daily Standup Template.md`. Without a template, HQ creates a minimal dated journal or standup. A configured but missing template is an error. Core `{{date}}` / `{{time}}` placeholders work; templates containing Templater commands require Templater enabled. Templater renders into a guarded new target with `tp.date.now()` scoped to the selected date (explicit reference dates remain unchanged), so the existing standup template can carry forward the previous standup's sections. If rendering fails, HQ trashes only its own still-empty placeholder and leaves existing or concurrently written content alone. Retry after correcting the template or enabling Templater. Templates should render content, not move/rename the target or create other files.

Focused regression: `node tests/test_hq_daily.js` exercises shared creation and real desktop/phone week-strip clicks; it requires Chrome, like the other HQ browser tests.

Pending `review-draft` reports in the reports folder appear in Needs you as review-only evidence, separate from gardener application rows. **Open for review** reads the evidence; **Mark reviewed** records `status: reviewed` after confirmation without applying suggestions or completing source tasks. Older pending reports stay visible. An automation's optional `review_report` filename prefix links its latest review-only report (distinct from the gardener's `report` prefix). Automation cards distinguish a recorded run result from unknown schedule/enabled state and strip terminal color codes. Home labels graph analysis coverage and freshness rather than claiming a whole-vault note count.

`local.json` (not committed) says where your vault is on this machine:

```json
{ "vault": "C:/Users/you/Documents/Vault" }
```

Optional: `"rules"`, the vault's rules file relative to the vault (default `_scripts/vault_graph_rules.json`).

HQ filter dropdowns use theme colors, a visible chevron, 14px text and a minimum 44px touch height. Search placeholders use the theme's muted text color; forced-colors mode retains the native select arrow.

Requirements for development: Node 22 or later; Python 3 with PyYAML for the analysis and its parity tests.
