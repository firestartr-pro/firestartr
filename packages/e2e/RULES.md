# e2e — Package Rules

- The less abstraction the better: no interfaces, classes, factories or helper
  layers until there is real duplication. Reuse `E2EApi`, `K8sApi`,
  `ClaimsApi`, `GhApi` and `src/k8s/types.ts` (or a `Pick<>` of them) before
  adding a type.
- Tests read as workflows: setup and stale cleanup, fixture render and patch,
  apply and wait, assertions, teardown in `afterAll`. Don't hide that sequence
  behind broad helpers.
- Failure diagnostics for apply, wait and delete live in the shared helpers,
  not in tests. They include kind/name/namespace, status, conditions and
  TFResult, and never secrets, tokens or full environment dumps.
- Render fixtures from `fixtures/base_claims` with
  `client.claims.renderLocally(...)` and change them only through the patch
  helpers. No ad-hoc claim YAML in test bodies. If a test renames a resource,
  clean it up by its runtime name.
- Use `client.k8s.applyCr`/`waitForCr`/`deleteCr`, never `kubectl` from tests.
  Deletion is idempotent, and cleanup keeps going and reports all errors at
  the end.
- Logic that can be checked without a cluster (formatting, planning, cleanup
  ordering, failure handling) gets unit tests.
