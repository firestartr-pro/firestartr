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
(it shows the setup flow). If either fails, stop and show the fix: `gh auth login`
or `socket login`. If the Socket call fails mid-triage, the script stops with its error.

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

If `socket` is `alert`, the script sets `step: stopped: socket alert` and posts
the blocking findings. **Stop.** Report the findings to the user and wait.
A blocking finding is high or critical severity, malware, a vulnerability or a
typosquat. Lower-severity findings (for example `shellAccess` or
`networkAccess`) appear under "Socket notes" and don't stop the flow. Mention
them in your report to the user.

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
3. Request a Copilot review at every level. Start the checks the script lists for
   the PR's level on the replacement PR. Record each `step:` and run ID in the
   summary comment, then stop. Calling the skill again continues from there.
   Run `triage.mjs <pr> --replacement <new-pr>` first, so the summary tracks the
   replacement PR's head. A new commit on it resets the saved checks.
4. When `main` moves, rebase onto Dependabot's new commit. If the lockfile
   conflicts, run `git checkout --ours package-lock.json`.
5. Show the merge command to a person, with the subject from the script, only
   once every required check is green. After the merge, close the Dependabot PR.

## Copilot threads

Draft the reply for each thread and show it to the user. A person posts the
replies and resolves the threads. Never resolve a thread without a reply.

## Hard rules

- Never click "Update branch" or push to a Dependabot branch.
- Never stack a PR on top of the Dependabot PR.
- Never close a superseded Dependabot PR before your own PR has merged.
- Never comment `@dependabot ignore this major version`.
- Never merge or approve. Only a person does that.
