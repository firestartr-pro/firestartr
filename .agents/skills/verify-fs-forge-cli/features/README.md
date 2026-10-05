# fs-forge verification map

This directory is the maintained source for verifying the user-facing behavior of the `fs-forge` CLI (`packages/fs-forge-cli`). Read the index before driving, then use the matching feature file as the recipe. The launch, doctor, drive, evidence and cleanup mechanics are in [`../SKILL.md`](../SKILL.md).

## Baseline preconditions

- Run `$V/launch.sh`, then `$V/doctor.sh`, and require `LAUNCH OK` and `DOCTOR OK` (`V=.agents/skills/verify-fs-forge-cli/scripts` from the repo root).
- Fixtures live under `packages/fs-forge-cli/__tests__/fixtures/` (`$F` below). Seed copies of them into a drive; never point a drive at the originals.
- `$F/valid/*.yaml` are valid claims. `$F/invalid/*.yaml` each break one rule. `$F/feature-sources/` is a local Feature source (`index.json` plus `feature_a`). `$F/relation-graphs/{valid,invalid}.json` feed `diagram print`.
- The drive supplies its own `FS_FORGE_FEATURE_CACHE_DIR`, `XDG_*` dirs and a scrubbed environment. Set none of `GITHUB_TOKEN`, `FSCRT_ORG` or `FS_FORGE_FEATURE_CACHE_DIR` by hand.
- Org-bound features need an org the user named, whose OK you hold, and a token (`GITHUB_TOKEN` or `gh auth token`). Write recipes need a pre org registered under `firestartr-pre/app-firestartr` `kubernetes/firestartr-pre/`.
- Drive only through `drive.sh`; a run started outside it has no isolation and no evidence.

## Driving conventions

- One command per drive: `$V/drive.sh --label <feature>-<step> [--expect-exit N] [--seed SRC[=DEST]]... -- <fs-forge args>`.
- Give each drive a label that names the feature and step, so `evidence/<NN>-<label>/` reads as a transcript of the proof.
- Treat every command as literal. Flags are oclif flags: a boolean flag takes no value (`--args.enabled`, `--no-args.enabled`), an array flag repeats (`--args.tags=a --args.tags=b`).
- Chain with seeds: `--seed <evidence dir>/stdout.txt=claim.yaml` feeds one drive's output to the next.
- `--help` and `--help --json` are the source of truth for a command's flags; this map names only the flags a recipe needs.
- Offline is the default mode. Switch to `--mode read` or `--mode write` only for the features that say so.

## Proof and skip reporting

- CLI proof includes the command (`cmd.txt`), stdout, stderr and the exit code, plus `files-changed.txt` (files written; empty means none) and `net.log` (connects attempted).
- A mutation command proves its result with a second view: validate what `create` printed, list what `features add` printed.
- Org-bound proof includes `org-diff.txt`; on an unchanged `read` drive it holds the line `no change in fs-forge branches, PRs or workflow runs`, so any `diff` output means the drive changed org state.
- Record the feature ID and entry point beside every verdict.
- Report an unreachable path with the attempted command and the unmet precondition (for example: no org named, no token).
- Do not report a skipped entry point as verified through a different path: `create <kind>` does not stand in for `create <kind> --commit`.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

| Feature | Mode | Covers |
|---|---|---|
| [Create a claim](./create-claim.md) | offline | `create <kind>` for the ten kinds: printed YAML, schema errors, required flags |
| [Validate claims](./validate-claim.md) | offline | `validate -f`: valid and invalid claims, exit codes, Feature checks against a local source |
| [Manage Features on a claim](./features-crud.md) | offline | `features discover`, `features list/add/edit/remove --file` against a local source |
| [Introspect the CLI](./introspection.md) | offline | `kinds`, `schema`, `--help --json`, `diagram print` |
| [Org-bound commands](./org-bound.md) | read, write | `defaults`, `discovery map/org-elements`, `preflight`, `watch-checks`, `edit`, `delete`, and every `--commit` path |

Org-bound modes were exercised against a stand-in `gh` only; the first live run of `org-bound.md` is unproven.
