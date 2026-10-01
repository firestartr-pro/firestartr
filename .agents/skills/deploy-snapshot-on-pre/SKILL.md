---
name: deploy-snapshot-on-pre
description: Deploy an operator snapshot image of a branch to a firestartr-pre org, unattended.
disable-model-invocation: true
---

# deploy-snapshot-on-pre

`packages/operator/tools/deploy-snapshot-on-pre.sh` builds the snapshot,
points the pre org at it, dispatches the deployment and auto-merges the
deployment PR. Your job is only to pick the branch and relay the result.

1. If `packages/operator/tools/.env` is missing, tell the user to copy
   `.env.example` next to it and fill in the target org, then stop. Never
   create it or choose the org yourself.
2. Ask whether to deploy the current branch or another one.
3. Run
   `SNAPSHOT_BRANCH=<branch> bash packages/operator/tools/deploy-snapshot-on-pre.sh --non-interactive`.
4. Report the script's final summary and its exit status as they are.
