# Architecture Decision Records — terraform_provisioner

Package-scoped ADRs for `terraform_provisioner`. Decisions that span multiple packages go in the
root [`docs/adr/`](../../../../docs/adr/) instead.

Format and numbering: see
[`prefapp/skills`’s `domain-modeling/ADR-FORMAT.md`](https://github.com/prefapp/skills/blob/main/skills/domain-modeling/ADR-FORMAT.md).
Authored lazily via `/domain-modeling`.

| ADR | Title |
|-----|-------|
| [0001](0001-local-bare-git-mirrors-for-remote-tfm.md) | Local bare-git mirrors for remote Terraform modules |
| [0002](0002-single-shared-configgit.md) | Single shared config.git |
| [0003](0003-escalating-signal-kill-chain-over-abortsignal.md) | Escalating signal kill chain over AbortSignal cancellation |
