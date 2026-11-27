# App command group

`fs-forge app` discovers platform facts (`app discover`), renders and compares all files for deploying or updating an App (`app plan`), and opens PRs in step order only when asked (`app apply`). All commands share the `AppInputs` schema, which is exposed offline via `fs-forge schema`.

## Sub-features

- `app-schema` lists `AppInputs` in `schema list` and prints it with `schema show AppInputs` (offline).
- `app-help` prints help for `app discover`, `app plan`, and `app apply` (offline).
- `app-inputs-errors` rejects missing org, missing or invalid inputs files, and invalid `--app` overrides on `app plan` and `app apply` with exit 2 (offline).
- `app-apply-audit-flags` enforces audit flag exclusivity (`--issue` vs `--create-issue`, and `--issue-title`/`--issue-body` requiring `--create-issue`) on `app apply` (offline).
- `app-discover` reads platform, ArgoCD, and service facts for an App from a named org (read).
- `app-plan` renders files, compares against repos, and writes rendered files with `--out` for an existing or new App in a named org (read).
- `app-apply` opens PRs in plan order against a named pre org (write; requires user approval per drive).

## How to get to it (user POV)

- Run `fs-forge schema list` and `fs-forge schema show AppInputs`.
- Run `fs-forge app discover --help`, `fs-forge app plan --help`, and `fs-forge app apply --help`.
- Run `fs-forge app discover --app <app> [--service <service>] [--org <org>] --json`.
- Run `fs-forge app plan --inputs <file> [--out <dir>] [--org <org>] [--app <app>] [--json]`.
- Run `fs-forge app apply --inputs <file> [--no-wait] [--timeout <s>] [--create-issue | --issue <N>] [--org <org>] [--app <app>] [--json]`.

## Driving it with drive.sh

Preconditions:

- `DOCTOR OK`.
- Offline drives (`app-schema`, `app-help`, `app-inputs-errors`, `app-apply-audit-flags`) need no org and no token; `net.log` must stay empty.
- Read drives (`app-discover`, `app-plan`) need `$V/doctor.sh --org ORG` and an org the user named and approved in this conversation.
- Write drives (`app-apply`) need a pre org registered under `firestartr-pre/app-firestartr` at `kubernetes/firestartr-pre/<org>/`, `$V/doctor.sh --org ORG`, and explicit user approval for every drive, just like `ob-write`.

## What `ready` needs on an org with no apps yet

`app plan` exits 1 with `ready: false` until every check passes. On an org that has
never had an App, these are the checks that fail and the setup each one wants:

| Check | Fails when | Smallest setup |
|---|---|---|
| `dot-firestartr-repo` | `<org>/.firestartr` is missing | provision the `dot-firestartr` claim |
| `state-argocd-repo` | `<org>/state-argocd` is missing | `create component --name state-argocd --feature 'state_argocd@<version>:{"client_name":"argocd",...}' --commit`, the way the sibling `state-github`/`state-infra` claims make those repos |
| `service-repo` | the Service repository is missing or archived | create it, or unarchive it |
| `registry-and-platforms` | the `chart.registry` alias is absent from `.firestartr/docker_registries/`, or a target platform, tenant or env is absent from `.firestartr/platforms/` | land one file in each directory, valid against `packages/cdk8s_renderer/src/schemas/dot-firestartr/` ([docker_registries.schema.ts](../../../../packages/cdk8s_renderer/src/schemas/dot-firestartr/docker_registries.schema.ts), [platforms.schema.ts](../../../../packages/cdk8s_renderer/src/schemas/dot-firestartr/platforms.schema.ts)) |
| `image-types` | the registry does not list the `snapshots`/`releases` type the targets' tracks need | add the type to the registry file |
| `build-images` | `.github/build_images.yaml` is absent from the Service repository, or lacks a `<type>.<flavor>` one of the targets needs | add it, valid against [build_images.schema.ts](../../../../packages/cdk8s_renderer/src/schemas/actions/build_images.schema.ts) |

While the registry alias is missing, `conflicts` also names the Service claim and the
`app-<app>` target file, so `ready` stays false even when the checks are read alone and
the `--out` render skips both files. `argo-notifications-app` and `vars-and-secrets`
are `info` checks: they never block `ready`.

- **Schema (offline).** Run `$V/drive.sh --label app-schema-list -- schema list`: `stdout.txt` includes `AppInputs`. Run `$V/drive.sh --label app-schema-show -- schema show AppInputs`: `stdout.txt` is valid JSON with `"title": "AppInputs"` and required keys `["app", "service", "targets", "chart"]`.
- **Help (offline).** Run `$V/drive.sh --label app-discover-help -- app discover --help`, `$V/drive.sh --label app-plan-help -- app plan --help`, and `$V/drive.sh --label app-apply-help -- app apply --help`. Each exits 0 and prints its flags (`--app` on `discover`, `--inputs` and `--out` on `plan`, `--inputs`, `--no-wait`, `--timeout`, `--issue`, and `--create-issue` on `apply`).
- **Missing inputs file (offline).** Run `$V/drive.sh --label app-plan-missing --expect-exit 2 -- app plan --inputs missing.yaml` and `$V/drive.sh --label app-apply-missing --expect-exit 2 -- app apply --inputs missing.yaml`. Both exit 2 with `Invalid inputs file:` in `stderr.txt`.
- **Invalid inputs file (offline).** Seed a YAML file missing required fields (`--seed <invalid.yaml>=bad.yaml`) and run `$V/drive.sh --label app-plan-invalid --expect-exit 2 --seed <invalid.yaml>=bad.yaml -- app plan --inputs bad.yaml` and the same for `app apply`. Both exit 2 with `Invalid inputs file:` and schema errors in `stderr.txt`.
- **No org (offline).** Seed a valid `AppInputs` file without `org` (`--seed <valid-no-org.yaml>=inputs.yaml`) and run `$V/drive.sh --label app-plan-noorg --expect-exit 2 --seed <valid-no-org.yaml>=inputs.yaml -- app plan --inputs inputs.yaml` and the same for `app apply`. Both exit 2 with `Organization is required:` in `stderr.txt`.
- **Bad `--app` override (offline).** Seed a valid `AppInputs` file and run `$V/drive.sh --label app-plan-bad-app --expect-exit 2 --seed <valid-no-org.yaml>=inputs.yaml -- app plan --inputs inputs.yaml --app INVALID_APP` and the same for `app apply`. Both exit 2 with `Invalid --app value "INVALID_APP":` in `stderr.txt`.
- **Apply audit flag exclusivity (offline).** Run `$V/drive.sh --label app-apply-audit-exclusive --expect-exit 2 -- app apply --inputs missing.yaml --issue 1 --create-issue` (exits 2 with `cannot also be provided when using --create-issue`) and `$V/drive.sh --label app-apply-audit-title --expect-exit 2 -- app apply --inputs missing.yaml --issue-title "Deploy"` (exits 2 with `All of the following must be provided when using --issue-title: --create-issue`).
- **Discover (read).** Run `$V/drive.sh --mode read --org ORG --label app-discover -- app discover --app <app> [--service <service>] --json` (`--service` is required when `apps/<app>.yaml` does not yet exist in `.firestartr`; omitting it exits 1 with `Cannot infer --service`). `stdout.txt` is JSON with `platforms`, `registries`, `argocd`, and `service` facts; `org-diff.txt` reports no change.
- **Plan (read).** Seed a valid `AppInputs` file for an existing or new App in `ORG` and run `$V/drive.sh --mode read --org ORG --label app-plan-json --seed <inputs.yaml>=inputs.yaml -- app plan --inputs inputs.yaml --json` (and with `--out rendered` to confirm files are written under `rendered/<repo>/<path>` in `files-changed.txt`). Exits 0 when `ready` is true, or 1 when checks or conflicts block apply; `org-diff.txt` reports no change.
- **Apply (write).** After the user approves this drive, run `$V/drive.sh --mode write --org ORG --label app-apply --seed <inputs.yaml>=inputs.yaml --watch-repo claims --watch-repo .firestartr --watch-repo state-argocd --watch-repo app-<app> --watch-repo <service> -- app apply --inputs inputs.yaml --timeout 600 --json`. Exits 0 (`done`), 1 (`failed` or `not_ready`), 2 (`error`), or 3 (`pending`); `--timeout` is per step, so it bounds step 1's provisioning and each step's merge wait (default 1800). Inspect `org-diff.txt` and any PRs opened on `fs-forge/<Kind>-<name>` (step 1) or `fs-forge/app-<app>` (steps 2 and 3).

## Proven live

`app apply` ran end to end on `pre-vieitesss` for App `fsf-verify-app` and Service
`random-labels` (2026-11-26): step 1 provisioned both claims, step 2 opened three PRs,
a human merged them, and step 3 opened `random-labels/.github/make_dispatches.yaml`
on `fs-forge/app-fsf-verify-app`.

- Step 3 PR: one file, byte-identical to the `app plan --out` render of the same
  inputs. Its `build-*` checks were `skipped` (no Dockerfile, no image built) and its
  `validate-yaml` check was red (see Gotchas).
- After that merge, `app apply` with the same inputs and a bounded `--timeout` exited
  **0** with `outcome: "done"` and every step `skipped`, and `app plan` exited 0 with
  `ready: true`, `conflicts: []` and `nothing to change` in every repo.
- Merging the last step 3 PR is also what proves the resume path: a fully satisfied
  plan touches nothing, so that write drive trips the no-change guard (see Gotchas).
- Teardown was proven on the same org: 21 minutes of writes, 13:48:55Z to 14:10:33Z,
  reversing the setup bottom up — `features remove --commit` per Feature `apply`
  attached, `delete component --commit` per claim it created (which unprovisions the
  state CRs and leaves the repository to `gh repo delete`), one merged PR per plain
  file the setup had written, and the Service repository re-archived last. Afterwards
  `app plan` fails the same checks and conflicts it failed before the setup, and
  `.firestartr` plus the Service repository's `.github/` are byte-identical to their
  pre-setup trees.

## Gotchas

- Step 2 has an order dependency: land `.firestartr/apps/<app>.yaml` **before** the
  `app-<app>` target PR. The `app-<app>` hydrator reads the App name from
  `.firestartr/apps/*.yaml`, so its `validate-changes` check fails while that file is
  not on `main` yet; the PR still merges, and the next `app apply` reports the step
  satisfied.
- When the Service repository's `.github/make_dispatches.yaml` starts as
  `deployments: []`, the merge keeps that flow sequence's style, so the rendered
  `deployments` block is written as `[ { … } ]` with indented entries and the
  repository's default `yamllint` (`validate-yaml` check) fails it on `indentation` and
  `brackets` (firestartr-pro/firestartr#267). Reformat that file by hand if the repo
  lints its config files.
- `app plan` exits 1 (not 2) when the plan runs successfully against GitHub but reports failing checks or conflicts (`ready: false`); input, schema, and org-resolution errors exit 2 before any network call.
- `app apply` exits 3 when a step is still pending (for example with `--no-wait` or on `--timeout`).
- `app apply` writes without a `--commit` flag; `drive.sh --mode write` currently checks for `--commit`, so check `drive.sh` before running a live `app-apply` write drive.
- `app plan --out <dir>` writes only non-noop, non-conflict files, so an up-to-date App writes nothing.
- An archived Service repository fails the `service-repo` check (`Repository <org>/<repo> is archived and must be unarchived before applying this plan.`), so `app plan` exits 1 before `app apply` reaches the read-only archived repo (`ERROR: This repository was archived so it is read-only`). Unarchive it first (firestartr-pro/firestartr#262).
- Step 1 does not end at the provision run. After each claim's dispatch succeeds, `app apply` also watches that claim's **wet PR** — the PR the operator opened in `state-github`/`state-infra` — so a red operator check there stops the whole run with exit 1 even though the claims PR merged and the provision run is green. It is reported as `Wet PR checks failed: failure`, naming neither the state PR nor the failing check: look for the newest `automated-non-automerge/ComponentClaim-<name>` PR in `state-github`, then read the check runs on its `merge_commit_sha`, not its head SHA (firestartr-pro/firestartr#263).
- Steps 2 and 3 wait for a human merge, so a live run that must not merge PRs ends `pending` (exit 3) after `--timeout` at step 2 and never opens the step 3 PR; once the step 2 PRs are merged, the same run goes straight to step 3 and ends `pending` there with that PR open. Expect `Timed out waiting for PRs to merge: …` in the JSON `reason`.
- `delete component --commit` merges the claims PR and the unprovision workflow then
  merges away the claim's state CRs, but the GitHub repository the claim created
  survives: `gh repo delete` it after the delete exits 0 and the claim is gone.
- `features remove` of the last remaining Feature re-serializes the whole claim, so
  the key order changes even though the content is back to `features: []`. A
  byte-identical restore needs a plain commit of the original file.
- `features remove` and `delete` run the same wet-PR watch step 1 of `apply` does, so
  a pre-existing red state-repo reconcile (for example `422 … name already exists`)
  exits **2** with `Wet PR checks failed: failure` even though the claims PR merged
  and the unprovision ran: read the claims log instead of the exit code.
- A resume is idempotent: reusing every open PR changes nothing in the org, and `drive.sh --mode write` requires a change, so it reports `FAIL - write drive changed nothing in <org>/claims` on that drive. Read `exit-code.txt`, `stdout.txt` and `org-diff.txt` — all three still prove the reuse — instead of the verdict line.
