# Vault Graph

An Obsidian plugin that maps your vault: it finds the topics your notes form, the notes that hold them together, and the places where they should connect but don't. Then it gives you one short list of things worth doing about it, each one click.

## What you get

- **Today**: one list of next steps, with today's three at the top. Link two notes that belong together, add a note to its topic's map, write a note other notes already link to, check that a note you rely on is still current, give a topic a map, link a note nothing points to. Each has its button and Undo. It's in the graph's Insights tab, its Today panel (the flag button, or G) and the sidebar.
- **Map**: the graph itself in 2D or 3D, coloured by topic, with the bridge notes and the gaps between topics.
- **Scenes**: the same notes as pictures (a city, a garden, a palace, the sky, a food web…), and scenes you write yourself in a note.
- **Lenses**: questions you can ask (what's important but stale, what to write next, which notes are duplicates, what a folder mixes).
- **Search**: finds what you half remember: misspellings, "last week", a person's name, "near" a note.

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

## Optional extras

- **Smart Connections**: if that plugin has indexed your vault, Vault Graph uses its note similarity too, for topics and for "these two notes mean the same thing" suggestions.
- **The analysis** (`analysis/`, Python 3 with PyYAML, desktop only): adds what Obsidian's index alone can't give, mostly from daily notes: which notes you mention together, timelines, follow-through on plans. Without it the plugin still finds the topics and suggestions itself.
- **Your own scenes**: a ```` ```vault-graph-scene ```` block in any note becomes a view. The **New scene** tile in Scenes writes one for you.

## Develop

How it's put together: [ARCHITECTURE.md](ARCHITECTURE.md). Where it's going: [ROADMAP.md](ROADMAP.md).

```sh
npm test                      # build + rules/code checks + every view and lens on the sample vault
npm run test:vault            # the same on a real vault (local.json's "vault", or --vault <dir>)
npm run build                 # dist/: main.js, styles.css, manifest.json, rules.js, engine.js (sample rules)
npm run deploy                # build with the vault's rules, test, install plugin and analysis into the vault, reload in Obsidian
npm run page -- --data <graph.json> [--rules <file>]   # the standalone graph page, in .out/
npm run sample -- --analyse   # regenerate fixtures/ with analysis/ (uses the vault's _System/vault_lib.py)
```

Slower checks, by hand: `node tests/click_all.js [--mobile]` (every control, about 5 minutes), `node tests/layout_random.js`, `node tests/shots.js [--mobile]`, `node tests/polish_loop.js [--full]`. Each takes `--vault` too. They need Chrome.

`local.json` (not committed) says where your vault is on this machine:

```json
{ "vault": "C:/Users/you/Documents/Vault" }
```

Optional: `"rules"`, the vault's rules file relative to the vault (default `_scripts/vault_graph_rules.json`).

Requirements for development: Node 22 or later; Python 3 with PyYAML for the analysis and its parity tests.
