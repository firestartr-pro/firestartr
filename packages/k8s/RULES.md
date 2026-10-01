# k8s — Package Rules

## New CRDs

- One file, `src/crds/crd-firestartr-<kebab-case-name>.yaml`
  (`apiextensions.k8s.io/v1`, structural schema, `status` subresource). No Go
  types, controllers or extra files.
- Syntactic schema keywords only (`type`, `properties`, `required`, `enum`,
  `default`, `format`, …). No patterns, bounds or CEL: semantic validation
  belongs to the renderer and the Terraform modules.
- After changing any CRD, regenerate the cdk8s imports and commit them with the
  change. Never edit `packages/cdk8s_renderer/imports/firestartr.dev.ts` by
  hand:

  ```sh
  cd packages/cdk8s_renderer
  cat ../k8s/src/crds/*.yaml | ../../node_modules/.bin/cdk8s import /dev/stdin
  ```

Existing CRDs aren't required to follow these rules retroactively, but changes
must not move them further away.

## Managed-resource conventions

Managed resources (GitHub kinds, Terraform workspaces) follow these; support
CRDs (`FirestartrProviderConfig`, `TFResult`) may skip them, but only as far
as their role requires.

- **Claim-driven.** Annotation `firestartr.dev/claim-ref: <ClaimKind>/<name>`
  and label `claim-ref: <name>`. No standalone handwritten managed kinds.
- **Identity.** `metadata.name` is `<dns-safe-external-name>-<uuid>`; the real
  provider name goes unchanged in `firestartr.dev/external-name` (and
  `github.com/project-slug` when relevant). Terraform-managed kinds define
  `spec.firestartr.tfStateKey`, reusing that UUID, stable forever.
- **Spec vs status.** Users write `spec`. Conditions, revisions, PR trace
  (`firestartr.dev/last-state-pr`, `last-claim-pr`) and sync state
  (`firestartr.dev/sync-*`, `revision`) go in `status` or metadata, never in
  `spec`.
- **Providers.** Provider and backend come from `FirestartrProviderConfig`
  refs under `spec.context`; never credentials or backend config in spec.
- **Graph.** Links to other Firestartr resources are `ref: {kind, name}`
  objects, with `needsSecret` when the consumer needs its secret; never opaque
  strings. Reusable outputs go through
  `spec.writeConnectionSecretToRef: {name, outputs}`.
- Fixtures in `__tests__/fixtures/` use these conventions realistically, and
  every new convention gets at least one fixture.
