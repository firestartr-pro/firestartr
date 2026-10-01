# Use `firestartr.backstage.dev/` as the Backstage-specific annotation namespace

Catalog entity annotations that drive Backstage-specific behaviour (permission policy, UI gating) must live in a dedicated namespace to avoid collision with `firestartr.dev/`, which is already used on Kubernetes CRs rendered by this package.

## Context

The renderer produces both Kubernetes CRs (using `firestartr.dev/` annotations) and Backstage catalog entities (User, Group, Component, etc.). Introducing permission-related annotations on catalog entities — such as `org-role` on Users and `role` on Groups — requires a namespace that clearly separates Backstage concerns from Kubernetes concerns.

`fire-starter.dev/` exists as a legacy prefix on some catalog entities but is not suitable for new annotations.

## Decision

Use `firestartr.backstage.dev/` as the annotation namespace for all Backstage-specific metadata that is not part of the standard `backstage.io/` namespace.

Examples:
- `firestartr.backstage.dev/org-role: owner` on User entities
- `firestartr.backstage.dev/role: write` on Group entities

## Annotation Inference Rules

### User entities

The `firestartr.backstage.dev/org-role` annotation on User entities is **only inferred** from the GitHub role, not from the claim:

- If `providers.github.role` is `admin`, the annotation is set to `owner`.
- Otherwise, the annotation is not set.

Explicit `firestartr.backstage.dev/org-role` values in the claim annotations are **ignored**. The org-role is exclusively derived from the team/admin role.

### Group entities

The `firestartr.backstage.dev/role` annotation on Group entities is **passed through** from the claim annotations without transformation.

## Constraint: No leakage into Kubernetes CRs

Annotations with the `firestartr.backstage.dev/` prefix MUST NOT appear on Kubernetes CRs (FirestartrGithubGroup, FirestartrGithubMembership, etc.). They are exclusively for Backstage catalog entities.

This is enforced at two levels:
1. **MetadataInitializer** — filters out `firestartr.backstage.dev/*` annotations when merging claim annotations into non-catalog CRs (detected via `apiVersion !== 'backstage.io/v1alpha1'`).
2. **Renderer validation** — `validateNoBackstageAnnotationsInK8sCrs()` scans rendered K8s CRs and throws if any `firestartr.backstage.dev/*` annotations are found.
