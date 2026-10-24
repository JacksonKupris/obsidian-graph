# Vault Graph

An Obsidian plugin that maps a vault: topic clusters, bridge notes and gaps, with views and lenses for acting on them (link notes, add them to maps, review stale ones, follow up on plans).

How it's put together: [ARCHITECTURE.md](ARCHITECTURE.md).

## Use

```sh
npm test                      # build + rules/code checks + every view and lens on the sample vault
npm run test:vault            # the same on a real vault (local.json's "vault", or --vault <dir>)
npm run build                 # dist/: main.js, styles.css, manifest.json, rules.js (sample rules)
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

## Requirements

Node 22 or later. The analysis (`analysis/`) is Python 3 with PyYAML; deploy installs it into the vault, where the desktop plugin runs it.
