# ADR 0003: Sanitize client references for public repo migration

## Status

Accepted

## Context

As part of migrating this repository to a public repository, the codebase contains references to specific client names, internal infrastructure (AWS account IDs, SSO URLs, internal GitHub repos), and sensitive data. Going public widens the attack surface — anyone can inspect source code, issues, workflow runs, and PRs.

The codebase also uses "client" in a business sense (e.g., "client organization") in internal docs, which conflicts with the technical use of "client" (e.g., k8s client, API client) and is not aligned with the domain model's preferred terminology.

## Decision

1. **Terminology**: Replace "client" (business sense) with "organization" throughout `docs/internal/` to align with the domain model and avoid ambiguity with technical "client" usage.

2. **Sanitization approach**: Replace all client-specific names, internal infrastructure references, and sensitive data with generic placeholders in current files. Git history will be wiped in the fresh start.

3. **Placeholder convention**: Use `<PLACEHOLDER_NAME>` format consistently (e.g., `<AWS_ACCOUNT_ID>`, `<your-org>`, `my-tenant`).

4. **Scope boundary**: Sanitize docs, workflow files, and the current `dagger/etoe` assets wherever they expose client-specific names, internal infrastructure references, or stale `ghcr.io/prefapp/...` image paths. Keep `firestartr-pre` dev tooling, `dagger.json` module source pins, product domains (`github.prefapp.dev`, `firestartr.io`), architectural concepts (`tenant`), and `package.json` identity as-is.

## Consequences

- Internal docs remain useful for the team but no longer expose sensitive infrastructure details
- Domain vocabulary becomes unambiguous: "organization" for business entities, "client" only for technical API/k8s clients
- The new public repo starts with a clean initial commit containing no client or enterprise references
- Dev tooling (`firestartr-pre` scripts, agent skills) continues to function unchanged
