# New TFM module for org-level secrets

Org-level secrets get a dedicated `github-org-secrets-section` Terraform module in the TFM module repository, rather than extending `github-repo-secrets-section` or `github-org-variables-section`.

Org secrets use `github_actions_organization_secret` (a different resource type than repo secrets' `github_actions_secret`), require org-level public key fetching for encryption, and have different `visibility` semantics (org-level supports `private`/`selected` with org-wide repository selection). Mixing repo and org logic in one module violates single responsibility. Mixing variables and secrets in one module conflates two distinct concerns with different resource types.
