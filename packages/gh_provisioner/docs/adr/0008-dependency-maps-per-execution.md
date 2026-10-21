# Dependency maps are per execution, not module state

`runGhProvisioner(...)` is called in-process by the operator, and concurrent
slots share one Node process. Dependency lookup used to live in module state:
`src/refs/resolver.ts` held `_DEPENDENCIES` (written by `setDependencies()`)
and `Entity.refResolver` was a static assigned by `Entity.setRefResolver(...)`.
The last `setDependencies()` of a run won, so a run could resolve its team,
membership and variable refs against **another run's** map.

That was fail-open: an unresolved ref was logged as a warning and skipped, the
binding never reached the Terraform document, and a successful apply could
therefore drop GitHub access.

The decision is to bind the map to the entity:

1. `getEntity(cr, deps)` passes the map into the `Entity` constructor; the
   instance method `resolveRef(ref)` reads it through `resolveRefIn(deps, ref)`,
   and `ResolvedRef` receives the same map for its own outputs lookup. There is
   no module-level dependency map and no static resolver left.
2. Empty deps do not throw at construction; an unknown ref resolves to `null`
   and each call site decides whether `null` is fatal.
3. Unresolved refs **throw** where omitting them would change GitHub state:
   repo teams, repo memberships and repo variables. CODEOWNERS substitution
   keeps its catch/continue behaviour — a missing slug only skips a cosmetic
   rename of an owner entry.
4. Construction logs the item's `kind/name` together with the number of bound
   dependencies, so a run's binding is visible in the logs.

**Alternative considered**: `AsyncLocalStorage` to carry the map implicitly.
Rejected: it replaces one ambient process mechanism with another, harder to
grep, and the operator/cluster would still have to seed it correctly. Explicit
constructor passing keeps the dependency visible at every call site.

**Alternative considered**: keep module state and serialize slots
(`OPERATOR_NUMBER_OF_MAX_SLOTS=1`). Rejected as a mitigation only: it stops
the interleaving that exposes the bug, not the shared-state class itself.

Same class of ambient-process-state bug already rejected in
`0003-one-preserved-workspace-session-per-run.md` (Terraform workspaces — this
ADR does not extend it), `packages/github/docs/adr/0001-named-auth-profiles-over-ambient-env.md`
and `packages/operator/docs/adr/0004-immutable-env-snapshot-operator-profile.md`.
