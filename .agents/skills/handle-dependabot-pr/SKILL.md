---
name: handle-dependabot-pr
description: Triage open Dependabot PRs (version jump, risk level, Socket check) and walk one PR through its path, Path A merge or Path B own PR. Use when the user asks to triage, handle or process Dependabot PRs.
disable-model-invocation: true
---

# handle-dependabot-pr

Runs on a developer machine with their own `gh` and `socket` logins. It never
merges, approves, clicks "Update branch", or pushes to a Dependabot branch.

## Prerequisites

Run `gh auth status`. Check that `socket` is logged in with `socket login`
(it shows the setup flow) and bound to the `firestartr-pro` org: `socket config
get defaultOrg` must print it, or set `SOCKET_CLI_ORG_SLUG`. The API key needs
`full-scans:create`, `full-scans:list` and `security-policy:read`. If either
fails, stop and show the fix. If a Socket call fails mid-triage, the script
records `socket unknown` and stops.

## Modes

- **Triage all:** `node .agents/skills/handle-dependabot-pr/scripts/triage.mjs --all`.
  Show the table it prints. Done when every open `app/dependabot` PR has a row.
  Never start e2e or snapshots in this mode.
- **Single PR** (`<pr>`): triage, then run the flow for its path below.

## Triage

`node .agents/skills/handle-dependabot-pr/scripts/triage.mjs <pr>` labels the
PR and keeps one summary comment up to date. Use `--dry-run` to preview. The
script prints jump, level, path, Socket verdict, required checks and the squash
subject. Those are the source of truth; don't recompute them.

The Socket gate runs `socket scan create --report` on a checkout of the PR head
under our org, so the verdict is our policy's, not the script's:

| Verdict | Meaning | Script does | Label |
|---|---|---|---|
| `ok` | the scan passes the org policy | continue | `socket/ok` |
| `block` | the policy blocks at least one alert | `stopped: socket block`, lists the Block alerts | `socket/block` |
| `unknown` | no report: CLI error, wrong org, failed scan | `stopped: socket unknown` | `socket/unknown` |

**Stop** on `block` and on `unknown`. Report the findings or the missing scan to
the user and wait. Warn-level alerts stay in the Socket dashboard and never reach
triage, so they don't stop anything. Each run uploads a full scan to the org; that
is accepted. Rationale and the `dependabot.yml` holds:
`docs/adr/0007-dependency-update-policy.md`.

## Socket override

Only when the org policy blocks a legitimate PR. All four steps, in order:

1. `npm diff --diff=<pkg>@<old> --diff=<pkg>@<new>`: no new install scripts,
   network calls, obfuscation or dependencies, and the change matches the advisory.
2. The advisory is real (GitHub Advisory Database, release notes) and the npm
   publisher is unchanged.
3. Add a dashboard Alert Triage rule (Settings → Security Policy → Alert Triage)
   scoped to that alert on `<pkg>@<new>`. Never weaken the policy as a whole.
   `@SocketSecurity ignore` PR comments need the GitHub App and don't apply.
4. Leave a PR comment saying it was reviewed, then retriage.

If the override would need to cover other alerts or other versions, stop and ask a
person: that is a policy change, not a triage step.

## Path A: merge the Dependabot PR

Done when the required checks for the level are green and a person has merged.

1. Comment `@dependabot rebase`. Use `@dependabot recreate` if someone else has
   pushed to the branch. Wait up to about 5 minutes for the rebase push. If it
   doesn't come, record `step: waiting for rebase` and stop.
2. CI. If `main` is red, record `step: waiting for main` and stop. If a job
   failed for a transient reason, re-run once with `gh run rerun --failed`. If
   the bump caused the failure, switch to Path B.
3. Start the checks the script lists for this level. Record each `step:` and
   run ID in the summary comment, then stop. Calling the skill again continues
   from the recorded step.
4. Show the merge command to a person:
   `gh pr merge <pr> --squash --subject "<squash subject>"`.

## Path B: own PR

Done when your PR is merged and the Dependabot PR is closed.

1. Create `deps/<pkg>-<version>` from the Dependabot branch. Open a PR to
   `main`. Comment `Superseded by #<new>` on the Dependabot PR.
2. For every major the bump crosses, read the release notes. Fix the code, and
   the rules and docs (`CONSTITUTION.md` and others), in the same PR. If
   `package-lock.json` has a wrong range, fix it by hand. Don't regenerate it.
3. Use `chore:` for every commit subject and the replacement PR title, without
   a scope such as `feat(desp-dev):`. Request a Copilot review at every level.
   Start the checks the script lists for the PR's level on the replacement PR.
   For e2e, run `github,terraform,k8s-rate-limits,crd-upgrade,retry-lifecycle,core`;
   this is the full workflow suite list except `massive`. Record each `step:` and
   run ID in the summary comment, then stop. Calling the skill again continues
   from there.
   Run `triage.mjs <pr> --replacement <new-pr>` first, so the summary tracks the
   replacement PR's head. A new commit on it resets the saved checks.
4. When `main` moves, rebase onto Dependabot's new commit. If the lockfile
   conflicts, run `git checkout --ours package-lock.json`.
5. Show the merge command to a person, with the subject from the script, only
   once every required check is green. Dependabot closes the superseded PR after
   the replacement updates the dependency; do not close it manually.

## Copilot threads

Draft the reply for each thread and show it to the user. A person posts the
replies and resolves the threads. Never resolve a thread without a reply.

## Hard rules

- Never click "Update branch" or push to a Dependabot branch.
- Never stack a PR on top of the Dependabot PR.
- Let Dependabot close a superseded PR after the replacement updates the dependency.
- Never comment `@dependabot ignore this major version`.
- Never weaken the Socket policy to unblock a PR; use the override instead.
- Never merge or approve. Only a person does that.
