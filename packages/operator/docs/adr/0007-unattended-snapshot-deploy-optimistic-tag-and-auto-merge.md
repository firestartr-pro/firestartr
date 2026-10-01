# Unattended snapshot deploy: optimistic tag and auto-merge on PRE

`packages/operator/tools/deploy-snapshot-on-pre.sh` gained a `--non-interactive`
mode (driven by the deploy-snapshot skill/CI) that deploys an operator snapshot
image to a `firestartr-pre` org without a human in the loop. Two choices in that
mode are deliberate and would otherwise look wrong to a future reader:

1. **Optimistic image tag.** The snapshot tag is computed up front from the
   selected branch's HEAD short SHA (`<shortsha>_<flavor>`) rather than read back
   from the build workflow. This lets the org's `values.yaml` be updated/pushed
   and `generate-deployment-kubernetes.yml` be dispatched *in parallel* with the
   Docker snapshot build, instead of serially after it. ArgoCD tolerates the not-
   yet-existing image by retrying the pull until the tag is published. A later
   verify step still polls GHCR for the predicted manifest tag and hard-fails
   if that tag is not published, so a wrong guess fails loudly
   rather than silently pointing PRE at a nonexistent image.

2. **Auto-merge the deployment PR by default.** Non-interactive mode finds the
   deployment PR deterministically (head `kubernetes-<platform>-<tenant>-<environment>`,
   base `deployment`) and squash-merges it with no review gate. This is only
   acceptable because the target is a live-but-safe PRE environment; the same
   behavior would be inappropriate against prod.

The trade-off is speed-and-automation versus safety: the tool assumes the branch
HEAD is the SHA the build will use and merges to a real org unattended. The
guard rails are that everything is scoped to `firestartr-pre`, the build result
is verified before the run reports success, and the interactive wizard keeps its
original human-driven, manual-merge, browser-opening behavior unchanged — the
optimistic/auto-merge path is opt-in via `--non-interactive` only.
