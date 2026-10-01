# Architecture Decision Records — operator

Package-scoped ADRs for `operator`. Decisions that span multiple packages go in the
root [`docs/adr/`](../../../../docs/adr/) instead.

Format and numbering: see
[`prefapp/skills`’s `domain-modeling/ADR-FORMAT.md`](https://github.com/prefapp/skills/blob/main/skills/domain-modeling/ADR-FORMAT.md).
Authored lazily via `/domain-modeling`.

| ADR | Title |
|-----|-------|
| [0001](0001-foreground-deletion-finalizer-over-ownerreferences.md) | Foreground-deletion finalizer replaces ownerReferences |
| [0002](0002-parent-identity-check-over-timer-block.md) | Parent identity check over timer block |
| [0003](0003-deferred-scheduling-for-blocked-parent-deletions.md) | Deferred scheduling for blocked parent deletions |
| [0004](0004-immutable-env-snapshot-operator-profile.md) | Immutable env snapshot operator profile |
| [0005](0005-plan-destroy-resolves-deleted-parents-from-base-revision.md) | Plan-destroy resolves deleted parents from base revision |
| [0006](0006-delegated-process-termination-over-centralized-shutdown.md) | Delegated process termination over centralized shutdown coordination |
| [0007](0007-unattended-snapshot-deploy-optimistic-tag-and-auto-merge.md) | Unattended snapshot deploy: optimistic tag and auto-merge on PRE |
| [0008](0008-semaphore-saturation-counters-for-diagnostic-observability.md) | Semaphore saturation counters for diagnostic observability |
| [0009](0009-policy-aware-retry-dispatch.md) | Policy-aware retry dispatch: RETRY_SYNC and error-condition gating |
| [0010](0010-session-scoped-tfworkspaces-with-reuse-and-tear-up.md) | Session-scoped Terraform workspaces with reuse and tear-up |
| [0011](0011-optional-tool-image-version-for-external-cmd-and-tf-planner.md) | Optional tool image version for external_cmd and tf_planner |
