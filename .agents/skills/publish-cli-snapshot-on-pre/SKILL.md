---
name: publish-cli-snapshot-on-pre
description: Publish a @firestartr/cli snapshot from a branch to npm and set the FIRESTARTR_CLI_VERSION variable of a firestartr-pre tenant org.
disable-model-invocation: true
---

# publish-cli-snapshot-on-pre

`publish-cli-snapshot-on-pre.sh` (next to this file) computes the snapshot
version, dispatches the npm publish workflow without a bump PR, and updates
the org's `FIRESTARTR_CLI_VERSION`. Your job is only to gather inputs and relay
the result.

1. If `.env` next to this file is missing, tell the user to copy
   `.env.example` and fill in the target org, then stop. Never create it or
   choose the org yourself.
2. Ask for the branch (current or another) and a short motive (for example
   `fix-queue`), which becomes part of the version.
3. Run
   `SNAPSHOT_BRANCH=<branch> SNAPSHOT_MOTIVE=<motive> bash .agents/skills/publish-cli-snapshot-on-pre/publish-cli-snapshot-on-pre.sh --non-interactive`.
4. Report the exit status, snapshot version, workflow URL and the variable
   update as they are.
