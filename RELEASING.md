# Releasing Vault Graph

## One command

From a clean, committed `main` on Node 22+, with GitHub push permission:

```sh
npm run release
```

Default: patch (for example 0.6.14 → 0.6.15). Use `npm run release -- minor`
or an explicit version if approved. `--no-wait` publishes the tag without waiting
for CI or asking BRAT to install.

The command fetches origin and requires `origin/main` to be an ancestor of HEAD.
It updates package.json/manifest.json, runs the full sample suite, commits with a
Copilot trailer, tags the version and atomically pushes main and tag without force.
The tag's Release workflow repeats tests, builds and publishes main.js,
manifest.json and styles.css. The command waits up to 20 minutes for the release.
When local.json identifies a vault with `_System/obsidian_cli.py`, it asks the
running Obsidian's BRAT to install the release and checks the installed manifest.
Without that local configuration, no automatic installation occurs.

Before releasing, also validate the target vault, read-only:

```sh
npm run test:vault -- /path/to/vault
```

Browser tests need Chrome. When running suites concurrently, give each a distinct
`VG_PORT_OFFSET`. To keep scratch files in the checkout, create an ignored `.out/`
subdirectory and set `TMPDIR` to its absolute path for tests and release.

## The same steps by hand

1. Check `git status --short`, `git branch --show-current`, `gh auth status`.
2. `git fetch origin`; `git merge-base --is-ancestor origin/main HEAD` must succeed.
   If behind/diverged, stop and integrate remote work without rewriting history.
3. Update package.json's approved version; `node build.js manifest`.
4. `npm test` and the target-vault command above must pass.
5. Commit package.json and manifest.json with `Release <version>` and the trailer
   `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
6. `git tag <version>`; `git push --atomic origin main <version>`.
7. Check `gh run list --workflow release.yml`, then
   `gh run watch <run-id> --exit-status` and
   `gh release view <version> --json url,assets`.
8. In the target Obsidian, BRAT → Check for updates. Confirm both the installed
   `.obsidian/plugins/jk-vault-graph/manifest.json` and loaded plugin version.
   Do not copy a sample-rules build over a BRAT installation.

## Failures and recovery

- Wrong branch, dirty tree, missing Chrome/Node or failed tests: fix the reported
  prerequisite and rerun. Failed tests restore the version files. No tag is pushed.
- GitHub 403: inspect `gh auth status`. If the authorized repository owner is
  already authenticated, use `gh auth switch --user <owner>` and restore the
  previous identity afterward. Never extract stored credentials.
- Push rejected: fetch and inspect main/tag state; never force-push or recreate
  an existing published tag. The atomic push prevents publishing half the pair.
- Failed CI: inspect `gh run view <run-id> --log-failed`. For transient failures,
  use Actions → Re-run failed jobs (or `gh run rerun <run-id> --failed`), then watch
  that run and verify the release assets. For a code failure, fix it on main and
  publish a new patch; never move the old tag.
- Release wait timed out: inspect the run/release before invoking release again;
  the tag may already exist. Once successful, update through BRAT manually.
- BRAT unavailable or Obsidian closed: release remains published. Open Obsidian,
  then BRAT → Check for updates; verify the installed and loaded versions.
- Offline: tests/build work locally once prerequisites exist. Fetch, push, CI,
  publishing and BRAT download require connectivity; stop rather than bypassing
  the remote-main check.
