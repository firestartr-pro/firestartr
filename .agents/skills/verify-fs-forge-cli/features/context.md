# Resolve the org context

`fs-forge context` prints the org the CLI would act on and where it came from (`--org`, `FSCRT_ORG`, or the entry in `$XDG_CONFIG_HOME/fs-forge/config.yaml` whose `paths` holds the current directory), the derived repos, the CLI version and the auth source. Every org-bound command's `--org` falls back the same way.

## Sub-features

- `ctx-match`: a config path holding the cwd resolves the org; the repos are derived from it.
- `ctx-errors`: a missing config, an old-shape config, no matching path, two orgs claiming one path, or no token each exit 1 with a `{"error":{"code","message"}}` body.
- `ctx-org-fallback`: an org-bound command with no `--org` takes the org from the config.

## How to get to it (user POV)

- `fs-forge context [--json] [--org ORG]`
- Any org-bound command run without `--org` or `FSCRT_ORG` from a configured directory.

## Driving it with drive.sh

Preconditions: `LAUNCH OK`, `FSF_RUN` exported. Offline mode. The CLI reads the config from the drive's `.xdg/config`, so seed one there: `--seed $C/<name>.yaml=.xdg/config/fs-forge/config.yaml`. Write the configs under `C="$FSF_RUN/seeds"`. Their `paths` hold `$(cd "$FSF_RUN" && pwd -P)`; macOS resolves `/var` to `/private/var`, and a path holds every drive's work dir under it.

- **Match.** Seed `organizations: [{name: acme, paths: ["<run>"]}]`. Run `$V/drive.sh --label ctx-match --stub-token --allow-connect registry.npmjs.org:443 --seed ... -- context --json`. Exit 0. `stdout.txt` has `"org": "acme"`, `"source": "config"`, `"matchedPath"` equal to the path, repos `acme/claims`, `acme/state-github`, `acme/state-infra`, `acme/catalog`, `"latest": null` and `"auth": {"source": "GITHUB_TOKEN"}`.
- **Errors.** With `--expect-exit 1`, the `error.code` in `stderr.txt` is:
  - `NO_CONFIG` with no seed;
  - `NO_CONFIG` with the old shape `organization: {name: acme}`;
  - `NO_MATCH` with `paths: ["/nowhere/acme"]`;
  - `AMBIGUOUS_MATCH` with two organizations listing the same path;
  - `NO_AUTH` with the match config and no `--stub-token`.
- **Org fallback.** Seed the match config. Run `$V/drive.sh --label ctx-org-fallback --expect-exit 1 --seed ... -- defaults list`. `stderr.txt` says `GITHUB_TOKEN is required (or log in with \`gh auth login\`)`, not `--org or FSCRT_ORG is required`, so the org came from the config. `net.log` is empty.

## Gotchas

- A resolved `context` looks up the latest CLI on `registry.npmjs.org:443`. The canary blocks it and `latest` comes back `null`; `--allow-connect` keeps the drive from failing on that one connect.
- `context` exits `NO_AUTH` before printing anything when no token resolves, so the match drive needs `--stub-token`.
- Every drive puts a stand-in `gh` on `PATH` that reports no account. The `gh auth token` fallback is unit-tested only, so `auth.source` `gh` is unproven here.
- Offline mode refuses `--org`, and it unsets `FSCRT_ORG`, so the `flag` and `env` sources are unit-tested only.
