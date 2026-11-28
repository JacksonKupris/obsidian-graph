# Mutation testing

Checks that the tests can fail. It breaks a source file one small way at a time (a `+` becomes `-`, an `if` never fires, a number moves by one) and runs the file's behaviour tests. A break no test notices is a **survivor**: a spot a test doesn't guard.

The runner comes with the graphs library (`node_modules/vault-graph-views/scripts/mutate.cjs`; change it there). This repository names its files and tests in `config/mutation.json`.

## Run it
    npm install                                 once
    npm run mutate -- src/<file>.js             all changes in that file
    npm run mutate -- src/<file>.js --limit 60  an even spread of 60 (the same ones each run)
    npm run mutate -- src/<file>.js --lines 100-180
    npm run mutate -- src/<file>.js --tests test_a   override which tests run
    npm run mutate -- --all --limit 120         every file in the config, then a summary
Reports are in `.out/mutation/`: one per file (score, which test caught how many, each survivor with its line) and `summary.md`.

## Automatic
GitHub runs `--all --limit 120` every Monday (`.github/workflows/mutation.yml`). Run it any time from the Actions tab: **Mutation** → **Run workflow**. The table is on the run page; the survivor lists are in the `mutation-reports` download. Needs a connection; the commands above work offline.

## By hand
Edit one spot in a copy of the repository, run the tests named for the file in `config/mutation.json` (`node tests/<name>.js`), and see whether any fails. The runner does exactly this in a temporary folder, so your files are never touched.

## Reading a result
- **Before anything**, the tests must pass unchanged; otherwise that file stops and the command exits 1. Fix the test first.
- "no tests named" or "there is no tests/…": add or correct the file's entry in `config/mutation.json`.
- A change that makes a test hang counts as caught.
- Survivor you can reach from a test: write the failing test first, then rerun.
- Survivor that is not a real change (an *equivalent* mutant, e.g. `!d` where an empty string takes the same path anyway): note it, no test.
- Survivor in code that only runs in a browser: covered by the browser checks.
- List only behaviour tests. A test that reads source text would catch changes for the wrong reason.
- Slow tests (`test_words`, 22 s) are left out of the config.
- Survivor in the worker plumbing of `shared.js`: covered by the browser checks, not by node tests.
- A run takes about (changes × the listed tests' time) ÷ 2.
