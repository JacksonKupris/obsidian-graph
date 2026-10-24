# Roadmap

What Vault Graph should become, decided 2026-10-24 after a full self-review (30 findings across the renderer, the core and the tests).

## The goal

You open it and get three things, on any device, with nothing to install:

1. **What's worth doing today**: one short list (link these two notes, put this one on its map, this relied-on note went stale, this plan never got done), each with its one-click action and Undo.
2. **Search that finds what you half-remember**: words, misspellings, when, who, what kind of thing, "near" a note.
3. **A map you can trust**: your topics, the notes they rely on, and where they don't connect.

It never damages a note or says it did something it didn't. The scenes (city, palace, zombie, sand…) are a gallery you can enjoy, not the main way in.

## Decisions

- **Trust first.** Anything that can lose data, write stale state or report a change it didn't make is fixed before any new feature, each with a regression test.
- **One "next up" list instead of three.** The review queue, quests and missions overlap: one ranked list of next actions (from the same rules), with XP as an optional layer on top, not a separate system.
- **Fewer, deeper surfaces.** Core: Today (the list), Search, Map (2D/3D), and the lenses as questions you can ask. The 20 picture views move to a Scenes gallery; no new hand-coded scenes. New scenes come from scene blocks in notes (no code), which is the extension point.
- **The plugin is the engine.** The analysis moves from Python into the plugin (a background worker, step by step: graph and topics, then text similarity, then the rest), so phones analyse too and every rule exists once. The vault's reports and MCP read what the plugin writes. The Python copy is retired as each part moves.
- **Settings, not a compiled-in rules file.** Folder names, thresholds and systems come from a settings tab with sensible detection (Daily Notes' folder, the inbox, people by tag); the vault's rules file becomes an optional override.
- **Smaller pieces.** `src/view.js` is split into modules (state and rendering, panels, lenses, map views, scenes) with the same one-bundle build, so each part can be read, tested and reviewed on its own.

## Order

1. **Trust**: fix the self-review's data-integrity and crash findings, then its shared-rule findings (one stale rule, one "reviewed" path, one add-to-map path), then the test harness (no hangs, a killed test is a failure).
2. **Focus**: the Today list (merging review, quests and missions), the Scenes gallery, plain empty states with a next step everywhere.
3. **Structure**: split the renderer; settings tab replacing compiled-in rules.
4. **Engine**: analysis in the plugin, Python retired part by part.
5. **Share**: GitHub, releases installable with BRAT, a README for someone who isn't Jackson, a public plugin id.
