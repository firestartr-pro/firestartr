# verify-fs-forge-cli

Developer notes. Agents read [`SKILL.md`](./SKILL.md), which is the source of
truth; this page only explains how the skill works.

## What it does

It proves a change to `packages/fs-forge-cli` by running the built `fs-forge`
CLI the way a user does, one command at a time, and keeping what happened as
evidence. It sits on top of the package's unit tests, not in place of them.

Ask your agent to "verify the fs-forge CLI" after a change, or run the scripts
yourself from the repo root:

```sh
V=.agents/skills/verify-fs-forge-cli/scripts
$V/launch.sh                                              # build, open a run
$V/doctor.sh                                              # check the setup
$V/drive.sh --label create-system -- create system --name sys
$V/cleanup.sh                                             # drop scratch, keep evidence
```

Each script prints a final `... OK` line, or a `DRIVE <NN>-<label> verdict=...`
line for `drive.sh`.

## How a drive works

`drive.sh` runs one `fs-forge` command in a fresh temp directory with a
scrubbed environment and records the command, its output, the exit code, the
files it wrote and the network connects it tried. The verdict comes from those
observations, not from the command's name. `--seed` copies files in, so one
drive's output can feed the next (`create` then `validate`).

| Mode | For | Guard |
|---|---|---|
| `offline` (default) | local commands | no token; connects are blocked and fail the drive |
| `read` | org-bound reads | needs `--org`; the org's `claims` repo must not change |
| `write` | `--commit` | needs `--org` of a registered pre org; the org must change, and the diff is saved |

`read` and `write` only run against an org you name, and an agent must ask you
before each write. They have only been tested against a fake `gh` so far.

## Where things live

```text
SKILL.md      the agent's instructions: launch, doctor, drive, evidence, cleanup
scripts/      launch.sh, doctor.sh, drive.sh, cleanup.sh, org-snapshot.sh;
              lib.sh is shared; net-canary.cjs blocks and logs connects
features/     one recipe per CLI feature; README.md is the index
fixtures/     extra inputs the recipes use
```

Evidence goes to `$TMPDIR/verify-fs-forge-cli/<run>/evidence/<NN>-<label>/`,
outside the repo; `cleanup.sh` keeps it. Set `FSF_RUN` to the `RUN_DIR`
`launch.sh` printed when more than one run is open.

## Changing it

- New or changed CLI behavior: add or update its file in `features/` and its
  row in `features/README.md`, which also defines the file layout.
- Script changes: run the quick start above and expect every step to pass.
