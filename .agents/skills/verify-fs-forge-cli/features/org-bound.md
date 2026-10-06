# Org-bound commands

Some `fs-forge` commands talk to a GitHub org: they read its claims repo (`<org>/claims`) and its state repos, or they write to them. Reads need `GITHUB_TOKEN` and `--org`. Writes happen only with `--commit`, which creates a branch, dispatches a provisioning workflow and lets that workflow open and merge PRs. This map keeps every org-bound drive opt-in against an org the user names.

## Sub-features

- `ob-no-org` shows each command refusing to run with no org named (offline, safe to run).
- `ob-guards` shows `drive.sh` refusing `--commit` and unnamed orgs before anything runs (offline, safe to run).
- `ob-defaults` reads the org's defaults: `defaults list`, `defaults show <kind>`, `defaults apply`.
- `ob-discovery` reads the org's claims: `discovery map` and `discovery org-elements`.
- `ob-preflight` checks whether a create, edit or delete of a repo, team, user or tfworkspace would collide with existing state.
- `ob-watch-checks` watches the check runs of a claim's wet PRs.
- `ob-edit-read` and `ob-features-read` read a claim from the org with `edit REFERENCE --diff` and `features list <component>`.
- `ob-delete-dry-run` runs `delete` without `--commit`.
- `ob-write` covers the paths behind `--commit`: `create`, `edit`, `features add|edit|remove` and `delete`.

## How to get to it (user POV)

- Run `fs-forge defaults list|show <kind>|apply [<Kind>-<name>]`, `fs-forge discovery map|org-elements`, `fs-forge preflight --kind <kind> --name <name> --create|--edition|--deletion`, or `fs-forge watch-checks <Kind>-<name>`, each with `--org <org>` or `FSCRT_ORG`.
- Run `fs-forge edit <Kind>-<name> ... [--diff]` or `fs-forge features add|edit|remove|list <component>` with no `--file`.
- Run `fs-forge delete <kind> <name>` to see what a delete would dispatch, and add `--commit` to dispatch it.
- Add `--commit` to `create`, `edit` or `features add|edit|remove` to publish the change.

## Driving it with drive.sh

Preconditions:

- `DOCTOR OK`, and `$V/doctor.sh --org <org>` for every drive below except `ob-no-org` and `ob-guards`.
- For every drive below except `ob-no-org` and `ob-guards`: the user has named the org in this conversation and agreed to the drive. Do not take the org from `FSCRT_ORG`, from `gh`'s defaults or from a fixture. `ORG` below stands for that org.
- A token, picked in `gh`'s order: `GH_TOKEN`, then `GITHUB_TOKEN`, then `gh auth token`. `drive.sh` passes it to the child only in `read` and `write` modes and fails the drive when it finds the token in the evidence, redacting it from every matching evidence file before reporting.
- For `ob-write`: `ORG` is a pre org registered under `firestartr-pre/app-firestartr` at `kubernetes/firestartr-pre/<org>/` (see `smoke-test-renderer`), and the user approves each `write` drive by name. Run `publish-cli-snapshot-on-pre` first if the workflow must run this branch's CLI.
- Org-bound modes were exercised against a stand-in `gh` only. The first live drive is unproven: read `org-before.json`, `org-after.json` and `org-diff.txt` as well as the verdict, and report anything surprising.

- **No org named.** Each of these runs offline and needs no approval. Run `$V/drive.sh --label ob-defaults-list-noorg --expect-exit 1 -- defaults list` and the same for `defaults show component`, `defaults apply ComponentClaim-my-api`, `discovery map`, `preflight --kind repo --name my-api --create` and `edit ComponentClaim-my-api --description x --diff`. Each exits 1 with `--org or FSCRT_ORG is required`. With `--expect-exit 2`: `watch-checks ComponentClaim-my-api` (`--org or FSCRT_ORG is required`) and `delete component my-api` (`--org or FSCRT_ORG is required even in dry-run mode to validate the claim exists`). `features list my-api` exits 1 with `GITHUB_TOKEN is required`. `net.log` is empty for all of them.
- **Guards.** Run `$V/drive.sh --label ob-commit-refused -- delete component my-api --commit` and `$V/drive.sh --mode read -- kinds`. Both exit 2 before any CLI runs; the first prints `ERROR: --commit needs --mode write with an explicitly named pre org`.
- **Read the org.** Run `$V/drive.sh --mode read --org ORG --label ob-discovery-map -- discovery map --json` (also `discovery org-elements --json`, `defaults list --json`, `defaults show component`). `stdout.txt` holds the org's data. `org-diff.txt` says `no change in fs-forge branches, PRs or workflow runs`, `net.log` lists the GitHub hosts reached (`blocked: false`) and the verdict is PASS. A diff, or a token in the evidence, makes it exit 4.
- **Preflight.** Run `$V/drive.sh --mode read --org ORG --label ob-preflight -- preflight --kind repo --name <name> --create --json`. `stdout.txt` is the JSON verdict for that name; `org-diff.txt` shows no change. `--edition` also takes `--old-name <current name>`; `--deletion` checks that the claim exists; `--scope claims|provider|all` limits what is checked.
- **Watch checks.** Run `$V/drive.sh --mode read --org ORG --label ob-watch -- watch-checks <Kind>-<name> --current --json` for a claim that already exists. `--current` reads the CR from the state repo's main branch and reports its last PR status, then returns. Without `--current` the command polls the claim's PR checks until they finish or `--timeout <seconds>` (default 1800) runs out, so give it a short `--timeout` in a drive.
- **Edit and features reads.** Run `$V/drive.sh --mode read --org ORG --label ob-edit-diff -- edit <Kind>-<name> --description x --diff --json` and `... -- features list <component> --json`. Without `--commit` they read the claim from the org and print the result; `org-diff.txt` shows no change.
- **Delete dry run.** Run `$V/drive.sh --mode read --org ORG --label ob-delete-dry -- delete <kind> <existing-name>`. `stderr.txt` says `Dry run — would dispatch unprovision-claim.yaml with:` and lists `claimType`, `claimName`, `includeVariants` and `waitForClaimChecks`; `org-diff.txt` shows no new workflow run. For a name that does not exist the command exits 1 with `Claim not found`. The dry run read the org's claims map, so `net.log` is not empty.
- **Write: publish a claim.** After the user approves this drive, run `$V/drive.sh --mode write --org ORG --label ob-create-commit -- create domain --name fsf-verify-<unique> --description "fs-forge verification" --owner group:<an existing group> --annotations.json '{"firestartr.dev/ia-test":"true"}' --commit`. `org-diff.txt` shows a new branch `fs-forge/DomainClaim-fsf-verify-<unique>` in `ORG/claims` and a new `provision-claim.yaml` run; the workflow then opens PRs in `state-github` and `state-infra`, so `statePrs` grows too. Read the PR and run state in the org before reporting.
- **Write: edit an existing claim.** After the user approves this drive, run `$V/drive.sh --mode write --org ORG --label ob-edit-commit -- edit <Kind>-<name> --description "<new description>" --commit` for a claim that already exists in `ORG/claims` and has no live `fs-forge/<Kind>-<name>` branch. `edit --commit` republishes the mutated claim down the create path, so `org-diff.txt` shows a new branch `fs-forge/<Kind>-<name>` and a new `provision-claim.yaml` run, and `statePrs` grows as the workflow opens PRs in `state-github` and `state-infra`. `cleanup.sh` does not remove remote leftovers; the branch and any PRs stay until the user removes them or a delete write drive runs.
- **Write: add, edit or remove a Feature.** Features republish the mutated `ComponentClaim` the same way. After the user approves each drive, run `$V/drive.sh --mode write --org ORG --label ob-features-add -- features add <component> --name <feature> --version <version> --commit`, `... --label ob-features-edit -- features edit <component> --name <feature> --version <version> --commit` (omit `--version`/`--ref` to keep the current pin), and `... --label ob-features-remove -- features remove <component> --name <feature> --commit`, each against a ComponentClaim that exists and has no live `fs-forge/ComponentClaim-<component>` branch. Every `org-diff.txt` shows a new branch `fs-forge/ComponentClaim-<component>` and a new `provision-claim.yaml` run, and `statePrs` grows as the workflow opens PRs in `state-github` and `state-infra`. `cleanup.sh` does not remove remote leftovers; the branch and any PRs stay until the user removes them or a delete write drive runs.
- **Write: remove it again.** After a second approval, run `$V/drive.sh --mode write --org ORG --label ob-delete-commit -- delete domain fsf-verify-<unique> --commit`. `org-diff.txt` shows a new `unprovision-claim.yaml` run. `cleanup.sh` does not remove remote leftovers; the branch and any PRs stay until the user removes them.
- **Proof.** Report each drive with its `org-diff.txt`. A read drive passes only when it holds the line `no change in fs-forge branches, PRs or workflow runs`; any `diff` output fails it. A write drive passes when the diff shows exactly the branch, PRs and runs the command promised, and the org state you read afterwards agrees.

## Gotchas

- `delete` without `--commit` is a dry run of the dispatch only: it still needs `--org` and the token, it reads the claims map and it fails on an unknown claim.
- `edit REFERENCE` and `features add|edit|remove <component>` without `--commit` read the org, so they are `read` drives, not offline ones. `edit --json` needs `--diff` or `--show-defaults`.
- Every `--commit` mutation publishes on the shared branch name `fs-forge/<Kind>-<name>`, so a claim whose branch is still live (for example right after an `ob-create-commit` on the same claim) is refused with `Branch already exists: ...`. Delete the branch or pick another existing claim before republishing.
- In `read` and `write` mode an `--org` inside the fs-forge arguments must equal the drive's `--org`; a different org is refused.
- On a busy pre org other people's branches, PRs and runs change the diff. A diff that names something your drive did not create is a false positive; record it and rerun.
- Provisioning is asynchronous. `org-diff.txt` right after the drive may not yet show the state-repo PRs; take `org-snapshot.sh snap ORG after.json` again later and `org-snapshot.sh diff` against the drive's `org-before.json`.
- The `ia-test` annotation and `sweep-` names belong to other skills: `smoke-test-renderer` uses the annotation for test claims, and `rollout-functionality` goes through `firestartr-operation` and never uses fs-forge-cli directly. Use this skill when `fs-forge` is itself under test.
- `--path` on `create` only matters for TFWorkspaceClaim and SecretsClaim.
