# ADR 0005: Claims defaults resolution in fs-forge-cli

**Status**: Accepted; amended by issue [#2465](https://github.com/prefapp/gitops-k8s/issues/2465)
**Date**: 2026-07-29  
**Issue**: [#2459](https://github.com/prefapp/gitops-k8s/issues/2459)

## Context

The `cdk8s_renderer` applies per-kind defaults to claims during rendering via `loadClaimDefaults()` + `applyBlockAwareDefaults()`. These defaults come from a `claims_defaults.yaml` file in the claims repo — they are organizational defaults, not schema-level defaults. The CLI (`fs-forge-cli`) had no access to this file, meaning claims authored by the CLI were "minimal" and lacked fields the renderer would fill. This caused a gap between what the CLI produced and what the renderer expected.

Two approaches were considered:

1. **Make `create` network-bound** — have `create` commands fetch defaults from the claims repo and fill them automatically. This would sacrifice the `create` command's determinism guarantee.

2. **Keep `create` deterministic, add separate defaults commands** — `create` continues to produce minimal claims. Defaults are surfaced through dedicated commands (`defaults apply`, `defaults show`, `defaults list`) and automatically applied in the already-network-bound `edit` commands.

## Decision

**Option 2 is adopted.** The CLI adds three new commands for defaults interaction, and `edit` automatically applies defaults from the claims repo after user overrides. `create` remains deterministic (no network, no defaults).

The defaults-application logic is vendored as a pure function in the CLI package (`src/defaults/applier.ts`) rather than imported from `cdk8s_renderer`, following the same pattern as schema vendoring (the CLI does not depend on the renderer at runtime).

## Rationale

- **Determinism is a hard-won property of `create`.** Breaking it would cascade into every caller (agents, skills, CI) that relies on `create` being offline-safe. Adding defaults as a separate, explicit step keeps that contract intact.
- **`edit` is already network-bound.** It already fetches claims, the claims-map, and the defaults file from the same claims repo — the marginal cost of fetching and applying defaults is near zero.
- **Separation of concerns.** `create` answers "what did the user ask for?"; `defaults apply` answers "what would the renderer see?" These are different questions.
- **No new runtime dependency.** Vendoring the applier avoids pulling `cdk8s_renderer` (and its cdk8s toolchain) into the CLI bundle, consistent with Decision #9 of the parent RFC (#2318).

## Consequences

- Three new commands are added under `src/commands/defaults/`: `apply`, `show`, `list`.
- A new pure-function module `src/defaults/applier.ts` implements the additive-only defaults merge (same semantics as `cdk8s_renderer`'s `applyBlockAwareDefaults`).
- The Claim defaults module (`src/claims/defaults.ts`) owns Defaults-file resolution, parsing, caching, ambiguity policy, and composition with the pure applier. The claims-repo module (`src/claims/claimsRepo.ts`) remains limited to raw repo operations.
- `edit` gains automatic defaults application after user overrides.
- A new `--show-defaults` flag on `edit` controls whether defaults-filled fields appear in `--diff` output (default: hidden).
- The `Deterministic` definition in CONTEXT.md is updated to clarify that repo defaults are intentionally excluded from `create`.
- The `defaultBlocks` list is hardcoded in the CLI applier (matching `cdk8s_renderer`'s) and must be maintained in sync. Currently: `/providers/terraform/sync`. Default blocks are atomic — if the claim defines any field within the block, the entire block is preserved as-is; if absent, the entire default block is applied.

## Alternatives considered

- **Make `create` network-bound (rejected).** Would have required adding `--org` to all codegen'd `create` commands, breaking every existing caller that relies on the deterministic guarantee. Two-phase workflows (create, then defaults-apply) achieve the same result without breaking existing contracts.
- **Import `cdk8s_renderer`'s `applyBlockAwareDefaults` directly (rejected).** Would add the full cdk8s toolchain as a runtime dependency. The logic is a pure function with a single dependency (`fast-json-patch` + `lodash`, both already in the CLI). Vendoring is simpler and keeps the bundle small.
- **Server-side defaults resolution (rejected).** Would require a new API endpoint in the claims repo or renderer. The CLI already has a claims-repo client (`src/claims/claimsRepo.ts`) wired to the claims repo — a file fetch is the simplest, lowest-latency path.

## Amendment: explicit create publishing

Issue [#2465](https://github.com/prefapp/gitops-k8s/issues/2465) adds an explicit
`create --commit` publish step. Claim construction and validation remain offline
and do not apply Claims repo defaults. Only after successful validation does the
opt-in publish step access the network to reject duplicates, commit the Claim,
and dispatch provisioning. Plain `create` retains the deterministic contract
described by this ADR.

## Related

- Issue [#2459](https://github.com/prefapp/gitops-k8s/issues/2459)
- Issue [#2465](https://github.com/prefapp/gitops-k8s/issues/2465)
- `cdk8s_renderer/src/loader/claimsDefaulter.ts`
- `src/defaults/applier.ts`
- `src/claims/claimsRepo.ts`
