# Apply-time adoption for org-level secrets

Org-level secrets use the apply-time adoption pattern in v1, mirroring
org-level variables: a secret that already exists on the org makes the
`github-org-secrets-section` module's create fail with an `already_exists`-class
error, the same failure ADR 0006 fixed for labels. Adoption stays safe because
value-change detection keeps using the SHA-256 plaintext fingerprints (ADR 0004)
and the GitHub existence reads are narrowed to secret names that are new to the
module. Repo-level secrets keep the plain delivery path with no adoption, so the
two scopes are not confused.

That narrowing depends on the module's `managed_secrets` self-output, which the
revision currently pinned in `src/terraform.ts` does not expose yet: it exposes
only `actions_secret_names`, `codespaces_secret_names`, `dependabot_secret_names`,
and `all_secret_names`, so the narrowing is not effective until the module is
bumped.
