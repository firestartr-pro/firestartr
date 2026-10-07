# Architecture Decision Records — e2e

Package-scoped ADRs for `e2e`. Decisions that span multiple packages go in the
root [`docs/adr/`](../../../../docs/adr/) instead.

Format and numbering: see
[`prefapp/skills`'s `domain-modeling/ADR-FORMAT.md`](https://github.com/prefapp/skills/blob/main/skills/domain-modeling/ADR-FORMAT.md).
Authored lazily via `/domain-modeling`.

## Index

- [0001 — e2e validates resources; orchestration lives in dagger/etoe](./0001-e2e-validates-resources-orchestration-in-dagger.md)
- [0002 — Repo-secrets e2e verifies by existence + `updated_at`](./0002-repo-secrets-e2e-verifies-by-existence-and-updated-at.md)
  (superseded by 0003, kept as history)
- [0003 — Repo-secrets e2e verifies the exact secret value via an in-repo Actions workflow](./0003-repo-secrets-e2e-verifies-value-via-actions-workflow.md)
- [0004 — Org-variables e2e asserts apply-time adoption on first reconciliation](./0004-org-variables-e2e-adoption-tested-in-two-reconciliations.md)
- [0005 — e2e global diagnostic collector via Jest globalSetup](./0005-e2e-global-diagnostic-collector-via-jest-global-setup.md)
