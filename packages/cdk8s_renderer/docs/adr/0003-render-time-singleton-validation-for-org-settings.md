# Render-time singleton validation for GitHub org-settings

A `FirestartrGithubOrganizationSettings` is validated to be a singleton **per
GitHub org** (`spec.org`, case-insensitive) across the whole rendered CR set, in
`validations/githubOrgSettings.ts`, called once on the full set in
`renderer/renderer.ts`. A render pass always covers exactly one client's claims
repository (the operator is deployed namespace-per-client), so the rendered-set
scope *is* the per-client scope: a client may manage many GitHub orgs (many
settings CRs), but at most one settings CR per org.

We enforce this at render time — not via a cluster-level uniqueness constraint —
because the renderer is the single chokepoint that sees the full client dataset
before anything reaches the cluster, so a duplicate org fails fast and loud
instead of producing two CRs that fight over the same GitHub org's settings.

The check is intentionally inlined (no generic multi-kind "singletons" helper):
it has one caller and one key, and a configurable abstraction would be
speculative generality.
