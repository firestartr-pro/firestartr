---
name: verify-fs-forge-cli
description: Drive and verify the `fs-forge` CLI (packages/fs-forge-cli) the way a user does. Reach for it after changing that package, to prove a claim command (create, validate, features, schema, diagram), or to check what a dry-run really skips. Offline by default; org-bound commands run only against a pre org the user names.
---

# verify-fs-forge-cli

`fs-forge` is a short-lived oclif CLI (`packages/fs-forge-cli/bin/run.js`, needs
`dist/`). Launch means build once; every drive is one command in its own temp
directory with its own evidence. The package's unit tests and validation order
live in `packages/fs-forge-cli/RULES.md`; this skill proves behavior on top of
them.

Everything runs through scripts in `.agents/skills/verify-fs-forge-cli/scripts/`
(call them from anywhere; they find the repo themselves):

```sh
V=.agents/skills/verify-fs-forge-cli/scripts   # from the repo root
```

Node and npm may be lazy shell functions that fail with `_load_nvm`. The
scripts resolve a real node >=22 themselves, so run ad-hoc commands through
`bash -c` or the scripts.

## Launch

```sh
$V/launch.sh              # npm ci if node_modules is missing, npm run build, open a run
$V/launch.sh --no-build   # reuse dist/ when nothing under packages/fs-forge-cli changed
```

Ready when it prints `LAUNCH OK` with `CLI=`, `BUILD=` and `RUN_DIR=`. Each
launch opens its own unique run directory, so concurrent launches never share
evidence. It records the repo's `git status` as a baseline. `npm run build`
regenerates tracked files from `schemas/*.json`; a `WARN ... codegen drift`
means the checkout was out of sync with its schemas. There is no server, so
there is nothing to keep alive. Cleanup tears down.

## Doctor

```sh
$V/doctor.sh              # makes no GitHub call
$V/doctor.sh --org <org>  # also checks token and gh for an org-bound drive
```

Run it before the first drive and whenever a verdict surprises you. Ready when
it prints `DOCTOR OK`; each `FAIL` line names its fix. It checks node >=22, a
`dist/` newer than every `src/*.ts` and `schemas/*.json`, the version, the
registered kinds, that the network canary blocks and logs a connect, that the
refusal guards below fire, and that the evidence directory is writable and
outside the repo. `WARN env` means your shell exports `GITHUB_TOKEN`, `FSCRT_ORG`
or similar; drives scrub them.

## Drive

```sh
$V/drive.sh [--label L] [--mode offline|read|write] [--org ORG] [--expect-exit N] \
            [--seed SRC[=DEST]]... -- <fs-forge args>
```

`--seed` copies a file or directory into the drive's work dir (`DEST` is
relative to it); a previous drive's `stdout.txt` makes a good seed for chaining
`create` into `validate`. `--expect-exit` is for commands that should fail
(`validate` exits 1 on an invalid claim). Pick the feature in
`features/README.md`, then follow its file.

| Mode | Lets through | Observed before the verdict | Refused with exit 2 |
|---|---|---|---|
| `offline` (default) | local commands, no token, outbound connects blocked | `net.log` must stay empty | `--org`, `--commit` |
| `read` | org-bound reads, token set, connects logged | `fs-forge/*` branches, PRs and workflow runs in `<org>/claims` unchanged | no `--org`, `--commit` |
| `write` | `--commit`, `delete` without a dry run | claims-repo diff recorded in `org-diff.txt` | no `--org`, org not registered under `firestartr-pre/app-firestartr` `kubernetes/firestartr-pre/` |

Org-bound drives need an org the user named in this conversation. Take it from
nothing else: not `FSCRT_ORG`, not `gh`'s defaults, not a fixture. Get the
user's OK before the first drive against it; `write` needs approval for every
drive, because `--commit` creates a branch `fs-forge/<Kind>-<name>` in
`<org>/claims` and dispatches `provision-claim.yaml` (or
`unprovision-claim.yaml`), and the provision workflow then opens, merges and
hydrates PRs in `state-github` and `state-infra`. A command that targets a
different `--org` than the drive names is refused.

Other skills own the surrounding steps:

- `smoke-test-renderer` defines pre-org registration and the `ia-test`
  annotation for test claims.
- `publish-cli-snapshot-on-pre` publishes the CLI snapshot a pre org's
  workflows run (`FIRESTARTR_CLI_VERSION`); use it before a write drive that
  must exercise this branch's CLI.
- `rollout-functionality` tests claims end to end through `firestartr-operation`;
  use this skill when `fs-forge` itself is under test.

Each drive exits `0` (verdict PASS), `1` (CLI exit differs from `--expect-exit`),
`2` (refused or bad usage) or `4` (guard breach: a network attempt in offline
mode, a changed org in read mode, or the token found in the evidence, which is
redacted from the matching files before the verdict is reported). Read the
final `DRIVE <NN>-<label> verdict=...` line; exit 4 means the proof is void even
when the CLI behaved.

Org-bound modes were exercised against a stand-in `gh` only, never a live org.
Treat the first live drive as unproven and report anything surprising.

## Evidence

Drives write to `${TMPDIR}/verify-fs-forge-cli/<RUN_ID>/evidence/<NN>-<label>/`
(`$FSF_HOME/latest` points at the current run; set `FSF_RUN` to pick another).
That location is outside the repo, so git never tracks it, and cleanup leaves
it alone. Per drive:

| File | Holds |
|---|---|
| `cmd.txt` | mode, org, working dir and the exact command |
| `stdout.txt`, `stderr.txt`, `exit-code.txt` | the transcript |
| `net.log` | JSONL of every connect attempted: `host`, `port`, `blocked` |
| `files-before.txt`, `files.txt`, `files-changed.txt` | sha256 of the work dir's files (seeds included) before and after the command, and their diff; an empty `files-changed.txt` means the command wrote nothing |
| `org-before.json`, `org-after.json`, `org-diff.txt` | claims-repo state around org-bound drives |
| `verdict.txt` | `PASS` or `FAIL - <reason>` |

A proof earns its verdict like this:

- Drive the real command as a user types it. `create`, `features add` and
  `features edit` print the claim; confirm that from `stdout.txt` and
  `files-changed.txt` rather than expecting a written file.
- Capture the action and the state it left: `cmd.txt`, `stdout.txt`, the exit
  code, then `files-changed.txt` and `net.log`.
- Chain, then read back: validate what `create` printed, list what `features
  add` printed.
- Verify dry-runs by observation. `net.log` and `org-diff.txt` say what a
  command touched; its name does not. `delete` without `--commit` still reads
  the org's claims map over the network.
- Report each feature with the entry point used, the drive directories and the
  verdicts. Report a path you could not reach with the command attempted and
  the unmet precondition.

## Cleanup

```sh
$V/cleanup.sh                    # remove the run's work/ dirs, keep the evidence
$V/cleanup.sh --purge-evidence   # remove the whole run, only for a throwaway run
```

Ready when it prints `CLEANUP OK: work/ removed; N evidence files kept at ...`.
It also lists any `git status` entries gained since launch and fails when no
evidence remains. Run it after a failed attempt too. It starts no processes and
stops none, and it never touches remote leftovers: after a `write` drive, the
branches, PRs and claims named in `org-diff.txt` stay until a `delete` write
drive (with approval) or the user removes them.

## Helpers

| Script | Invocation | Use |
|---|---|---|
| `launch.sh` | `$V/launch.sh [--no-build]` | build and open a run |
| `doctor.sh` | `$V/doctor.sh [--org <org>]` | trust check before driving |
| `drive.sh` | `$V/drive.sh [opts] -- <fs-forge args>` | one isolated, observed drive |
| `cleanup.sh` | `$V/cleanup.sh [--purge-evidence]` | remove scratch, keep evidence |
| `org-snapshot.sh` | `$V/org-snapshot.sh snap <org> <out.json>`; `$V/org-snapshot.sh diff <before> <after>` | read-only `gh api` snapshot of `fs-forge/*` branches, claims PRs, workflow runs and state-repo PR numbers; `diff` exits 1 on a change |
| `net-canary.cjs` | `NODE_OPTIONS="--require $V/net-canary.cjs" FSF_CANARY=strict\|log FSF_CANARY_LOG=<file> node packages/fs-forge-cli/bin/run.js ...` | what `drive.sh` preloads to block and log connects |
| `lib.sh` | sourced by the scripts | repo, node and run-dir resolution |
