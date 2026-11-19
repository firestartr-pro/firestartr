# Org-secrets e2e verifies Actions by value and the other domains by existence

## Context

Issue #219 asks the e2e suite to cover organization secrets across `actions`,
`codespaces` and `dependabot`: `all` and `selected` visibility, several secrets
across the three domains, adoption of a pre-existing secret, and removal when the
claim is deleted.

GitHub never returns a secret's plaintext. ADR-0003 solved this for repository
secrets and ADR-0004 for organization variables by dispatching an in-repo
workflow that compares the provisioned value with the expected one. That
mechanism only reaches `secrets.*` for **Actions** secrets: Codespaces and
Dependabot secrets are never exposed to a workflow run, so no consumer can
compare their value.

Adoption (ADR-0010) checks the GitHub API for declared names that are new to the
module, so the suite must pre-create a secret with a known value and then prove
the claim's value wins — which again is only observable for Actions.

Codespaces and Dependabot also depend on the organization plan and on the GitHub
App holding the `codespaces_secrets` / `dependabot_secrets` organization
permissions. The disposable e2e org may not expose either, and a suite that
hard-requires them would fail for an environment limit rather than a regression.

## Decision

1. **Actions secrets get the authoritative value assertion.** After the section
   CR reaches `PROVISIONED`, the suite commits `verify-org-secret.yaml` into the
   disposable component repository and dispatches it once per value; the run's
   `success` conclusion proves byte-for-byte equality. Runs are correlated by a
   unique `display_title` (ADR-0003).
2. **Codespaces and Dependabot are asserted by existence and visibility** through
   `getOrgSecret`, plus `getOrgSecretSelectedRepositories` for `selected` where
   the domain keeps bindings separately. No value assertion is attempted.
3. **Domain availability is probed once**, before rendering, by listing that
   domain's organization secrets. `403`, `404` and `422` mean "the org does not
   expose this domain" and the domain is omitted from the rendered claim with a
   log line; transient and rate-limit errors are surfaced so a real failure never
   looks like a missing capability.
4. **The suite applies only `FirestartrGithubOrganizationSecretSection`.** The
   `OrgSettingsClaim` also renders the org-settings singleton shared with the
   org-settings and org-variables suites; applying it here would make the parallel
   regular Jest batch fight over `github_organization_settings`. Rendering still
   uses the claim, so the full claim → CR path stays covered.
5. **Adoption is verified across two reconciliations.** The adoption apply imports
   the pre-existing secret and drops its SHA-256 fingerprint, but the module
   rewrites values through `replace_triggered_by`, which Terraform does not fire
   when the fingerprint trigger resource is first created — the imported secret
   keeps the external value after that apply. The suite forces the next
   reconciliation with the `firestartr.dev/reconcile-at` annotation (the same
   mechanism ADR-0002/0003 use for repo-secret rotation), treats `updated_at`
   advancing as the readiness signal, and only then dispatches the value
   workflow.
6. **Cleanup is asserted remotely.** Deleting the section CR must make every
   declared secret disappear from GitHub; the test polls for absence instead of
   trusting the finalizer. Teardown deletes the owning CRs before any direct
   GitHub deletion, and every direct deletion is recorded separately so one
   failure cannot skip the rest.

## Consequences

- The suite runs in the regular parallel batch and needs no change to
  `scripts/run` or the dagger orchestration.
- On an org without Codespaces or Dependabot the suite still covers the full
  Actions path and prints which domains it skipped, so the gap is visible in the
  logs instead of being silently absent.
- A future issue can add value coverage for Codespaces/Dependabot only if a
  consumer for those domains appears; the API limitation is documented in
  `docs/public/providers/github/org-settings.md`.
