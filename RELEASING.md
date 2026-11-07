# Releasing Vault Graph

How to build, publish and install a new version yourself, on any computer, without an AI helper.
Every command runs in the repository folder, in PowerShell, Git Bash, or a Mac/Linux terminal.

Setting up a computer, branches, pull requests and `npm run sync`: [CONTRIBUTING.md](CONTRIBUTING.md).

## Release

Release from `main`, after the change's pull request is merged:

```sh
git switch main
npm run release              # 0.6.14 -> 0.6.15.  npm run release -- minor  for 0.7.0;  npm run release -- 1.2.3  for that exact one
```

It syncs with GitHub first, so it always releases what's merged, and it only goes ahead once GitHub's tests have passed on that code. If they're still running it waits for them. No tests run on your computer, so what else your computer is doing doesn't matter.

Once the tests have passed it takes about a minute and prints each step. It ends with:

```
Released 0.6.15: https://github.com/JacksonKupris/obsidian-graph/releases/tag/0.6.15
Installed 0.6.15 in .obsidian/plugins/jk-vault-graph
Obsidian reloaded it: 0.6.15 is running        (or: Obsidian isn't running: it loads this version when it opens)
```

## How a release travels

```
your computer                 GitHub                                       Obsidian
-------------                 ------                                       --------
npm run release:
  checks GitHub's tests passed on main
  version 0.6.15 in
  package.json + manifest.json
  commit, tag "0.6.15"  --->  the tag starts Actions (release.yml):
                                checks the tag matches the version
                                checks test.yml passed on this code
                                builds
                                makes a Release with main.js,
                                manifest.json, styles.css   ---------->   this computer: the script copies the 3 files
                                                                            into <vault>/.obsidian/plugins/jk-vault-graph/
                                                                          other computers: BRAT downloads them
```

- **The tests** run on GitHub on every pull request and every push to `main` (`test.yml`). That's the run a release needs. The version commit changes only the number, so it starts no run, and `release.yml` refuses one that changes anything else.
- **The version** lives in `package.json`. `manifest.json` (what Obsidian reads) copies it; `node build.js manifest`
  writes it. The tests fail if they differ, and GitHub refuses a tag that doesn't match.
- **A version is used once.** If 0.6.15 is broken, release 0.6.16. Never move or re-push a tag.
- Your plugin settings (`data.json` in the plugin folder) are never touched by an install.

## The same steps by hand

This is everything `npm run release` does, in order. Use it if the script stops partway, or to see what each step does.

```sh
git switch main
npm run sync                                # the same as GitHub (or: git pull --rebase)
git status                                  # must say "nothing to commit"
# check https://github.com/JacksonKupris/obsidian-graph/actions: Test is green on main's latest commit

# set "version" in package.json to the new one (e.g. 0.6.15), then copy it into manifest.json:
node build.js manifest

git commit -m "Release 0.6.15" package.json manifest.json
git tag 0.6.15
git push origin main 0.6.15
```

Watch it at https://github.com/JacksonKupris/obsidian-graph/actions. When it's green, the release is at
https://github.com/JacksonKupris/obsidian-graph/releases. Install it with `npm run install-release` (below) or BRAT.

## Install a release

| Where | How |
|---|---|
| This computer, after `npm run release` | Done for you when `local.json` (or `--vault`) names the vault. |
| This computer, any time | `npm run install-release` (latest), `npm run install-release -- 0.6.15` (that one, also to go back), `npm run install-release -- --vault <folder>` for another vault. |
| Any computer, in Obsidian | Install BRAT from Community plugins, then BRAT: **Add a beta plugin** > `JacksonKupris/obsidian-graph`. To update: Ctrl/Cmd+P, type `BRAT`, run its **check for updates** command. |
| By hand | Download `main.js`, `manifest.json` and `styles.css` from a [release](https://github.com/JacksonKupris/obsidian-graph/releases) into `<vault>/.obsidian/plugins/jk-vault-graph/`. |

After an install by hand or with Obsidian open, turn Vault Graph off and on in Settings > Community plugins (or
restart Obsidian) to load it. The script does this itself on Jackson's vault, where it can talk to Obsidian.

## Releasing without waiting

`npm run release -- --background` does the whole release (wait for the tests, bump, tag, publish, install) in a separate process and returns at once, so the terminal is free for the next change. A refusal (wrong branch, uncommitted changes, nothing new) shows within a few seconds as usual. Otherwise it prints the log file to read; the log ends with `Released <version>` and what was installed. Merge several pull requests first and release once: one wait covers them all.

## When the GitHub run fails

The script prints the run's link. Open it; the red lines under **Annotations** name the failing test.

- **Tests failed on `main`, so `npm run release` stopped:** nothing changed. A flaky test: click **Re-run jobs** > **Re-run failed jobs** on that page, then `npm run release` again. A real failure: fix it through a pull request.
- **The publish step failed after the tag:** usually GitHub having a hiccup. Click **Re-run jobs**, then
  `npm run release -- --resume`, which waits for it and installs the release. If it's a real failure, fix it, commit, and
  `npm run release` again. That makes the next version; the failed one is never published.

You never need tokens, `curl` or the GitHub API by hand. (From a terminal instead of the browser: install the
[GitHub CLI](https://cli.github.com/), `gh auth login`, then `gh run rerun <run id> --failed`.)

## Offline

Publishing needs GitHub, so a release waits until you're online. Offline you can still work and try your changes:

```sh
npm test                         # tests on the sample vault
npm run test:vault               # tests on your vault (local.json)
npm run deploy -- --plugin       # put this build straight into your vault to use it now
git commit -m "..."              # commits stay on this computer until you push
```

The build installed by `deploy --plugin` stays until the next install. Back online: `npm run sync`, open the pull request, merge it, then release from `main`.
It ships everything committed since the last release.

## What the messages mean

| Message | What to do |
|---|---|
| `you're on "x"; releases go from main` | Merge x's pull request on GitHub, then `git switch main` and release |
| Anything from the sync step (conflict, can't reach GitHub...) | See "What sync tells you" in [CONTRIBUTING.md](CONTRIBUTING.md). |
| `commit or stash your changes first` | `git add -A` and `git commit -m "..."`, or `git stash` |
| `0.6.15 is already tagged` | That version exists. Run `npm run release` (it picks the next one) or name a higher one. |
| `GitHub's tests failure on abc1234` | Open the printed link. A flaky test: Re-run jobs, then release again. A real failure: fix it through a pull request. |
| `GitHub has no test run for abc1234` | The commit reached `main` without a run, or GitHub dropped it. Open Actions; a new commit through a pull request starts one. |
| `committed and tagged 0.6.15 here, but the push failed` | Usually offline or not signed in. Fix that, then `git push origin main 0.6.15` and `npm run release -- --resume`. |
| `nothing has changed since 0.6.15` | That release already has everything on `main`, usually because someone just released. Nothing to do. To re-issue it anyway: `npm run release -- --force`. |
| `GitHub's hourly API limit is used up` | The release itself is fine; only checking on it is limited. Watch the Actions page, or `npm run release -- --resume` after the time shown. |
| `no release after 20 minutes` | Open the printed link: still queued, running, or failed (see above). |
| `Node 20.x: this needs Node 22 or newer` | Install Node 22+ from nodejs.org. |
| `no Chrome on this CI runner` | GitHub's machine changed. Add a Chrome install step to `.github/workflows/test.yml`. |
| `Obsidian has 0.6.14, not 0.6.15` | Turn Vault Graph off and on in Settings > Community plugins. |

Browser tests need Chrome. Each picks a free port, so two suites can run at once.
