# Working on Vault Graph

Before adding a feature, read [FEATURES.md](FEATURES.md): extend the one that owns the job, and merge two that do the same job.

How code gets from your editor to `main`, the same on every computer, with or without an AI helper. Releasing what's
on `main` is in [RELEASING.md](RELEASING.md).

## Set up a computer (once)

1. Install [Git](https://git-scm.com/downloads) and [Node.js 22 or newer](https://nodejs.org/). Check with `node -v`.
2. Install Google Chrome (or Chromium, or Edge). The tests drive it. Without it the browser tests are skipped here and
   only GitHub runs them. If it's installed somewhere unusual, set `CHROME_PATH` to its program file.
3. Get the code:
   ```sh
   git clone https://github.com/JacksonKupris/obsidian-graph.git vault-graph
   cd vault-graph
   npm test
   ```
   The first push asks you to sign in to GitHub; you need push access to the repository.
4. Optional: say where your vault is, so tests can run on it and a release installs itself there. Create `local.json`
   (per computer, never committed):
   ```json
   { "vault": "C:/Users/you/Documents/YourVault" }
   ```

## How code flows

```
 main  ──●───────────────●──────────●── release 0.6.15 (tag)
          \             / merge PR   \
 a branch  ●──●──●─────●              ...
           commits, pushed by npm run sync from any computer
```

- **`main`** is reviewed code. Releases are made from it.
- **Each change gets its own branch**, started from `main`, pushed to GitHub straight away so every computer has it.
- **A pull request** merges the branch into `main`. GitHub runs the tests on it (the checks on the PR page); merge
  when they're green.
- **`npm run sync`** keeps this computer and GitHub the same, on whatever branch you're on. Run it when you sit down
  and after every commit. It never loses work: uncommitted changes are kept, and a conflict changes nothing.

### Day to day

```sh
npm run sync                        # sit down: get what other computers pushed

git switch main
git switch -c fix/dungeon-labels    # a new branch for this change (from an up-to-date main)
# ...edit...
npm test
git add -A
git commit -m "Dungeon labels stay on screen"
npm run sync                        # pushes the branch; prints the link that opens its pull request
```

Open the printed link, write what the change does, and **Create pull request**. When the checks are green,
**Merge pull request**, then **Delete branch**. Back on your computer:

```sh
git switch main
npm run sync                        # main now has the merged change
```

Then release it when you want: `npm run release` ([RELEASING.md](RELEASING.md)). It needs GitHub's tests to have passed on `main`, and runs nothing on your computer.

### Carrying on from another computer

```sh
npm run sync
git switch fix/dungeon-labels       # the branch the other computer pushed
# ...edit, commit...
npm run sync
```

### What sync tells you

| Message | What to do |
|---|---|
| `Pushed 2 commits on <branch>` / `Took 1 commit ... from GitHub` | Nothing: this computer and GitHub match. |
| `Open a pull request: https://...` | Open it to propose the branch for `main`. |
| `main has 3 commits this branch doesn't` | Other work was merged. To build on it: `git merge origin/main`, then `npm run sync`. |
| `your commits and GitHub's change the same lines in <file>` | Nothing was changed. Settle it: `git pull --rebase`, edit the file (keep the right lines, remove the `<<<<<<<` `=======` `>>>>>>>` marks), `git add <file>`, `git rebase --continue`, `npm run sync`. |
| `N files changed here and not committed yet` | Commit them, then sync again. |
| `Deleted on GitHub (pull request merged or closed): <branch>` | Once nothing on it is needed: `git branch -D <branch>`. |
| `can't reach GitHub` | Keep working and committing; sync when you're online. |
| `a rebase is still in progress` | `git rebase --continue` after settling the files, or `git rebase --abort` to undo it. |
| `not on a branch` | `git switch main` (or your branch). |

### Without the script

`npm run sync` is these git commands; any of them work by hand:

```sh
git fetch --prune origin
git pull --rebase --autostash        # take GitHub's newer commits on this branch
git push -u origin HEAD              # push this branch (the first time, -u links it to GitHub's copy)
```

## Commits

One change per commit, message in plain words saying what changed ("Dungeon labels stay on screen"). Pair a fix with
the test that would have caught it (`tests/`, run by `npm test`).
