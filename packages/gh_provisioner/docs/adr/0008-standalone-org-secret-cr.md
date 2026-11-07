# Standalone CR for org-level secrets

Org-level secrets produce a dedicated `FirestartrGithubOrganizationSecretSection` CR (short name: `ghorgsecrets`) rather than being bundled into `FirestartrGithubOrganizationSettings` or reusing the repo-level `FirestartrGithubRepositorySecretsSection`.

A standalone CR gives org secrets an independent Terraform state, a separate reconcile lifecycle (secrets can update without touching other org settings), and clean operator queue ordering. Bundling into the settings CR would create a single oversized CR that changes on every settings or secret update, increasing reconcile noise. Reusing the repo-level CR conflates repo and org scopes.
