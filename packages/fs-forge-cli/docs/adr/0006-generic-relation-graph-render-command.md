# `diagram print` accepts an arbitrary RelationGraph as JSON

## Status

Accepted — amends ADR 0005's "no public generic graph input command" decision
and issue #2453's corresponding out-of-scope note.

## Context

ADR 0005 and issue #2453 deliberately scoped `discovery map` and the relation
renderer to claims data only, explicitly ruling out "a generic, domain-agnostic
diagram command that accepts arbitrary `GraphNode[]` JSON unrelated to claims."
That scoping remains correct for claims discovery itself. Separately, there is
a real need to render the same box-drawing/icon/diff-marker graphics for
structure that has nothing to do with a claims repo (e.g. a graph an agent or
script has assembled some other way), without hand-rolling a second tree
renderer.

## Decision

- A new command, `fs-forge diagram print`, accepts a JSON document via
  `--file <path>` or stdin and renders it with the existing
  `renderRelationGraph()` from `src/lib/relationMap.ts` — the same function
  `discovery map` and the `--diff` relation views use.
- The accepted JSON is exactly the existing `RelationGraph` shape
  (`{ nodes: [{id, kind, name, dangling?, status?}], edges: [{from, to,
  relation, status?}] }`) — no new schema shape, no claims-specific fields
  required.
- Input is validated against a new `schemas/RelationGraph.json` JSON Schema
  through the same AJV machinery already used for claim validation
  (`src/utils/ajvValidation.ts`), so malformed input gets a clear error list
  instead of a crash or silent misrender.
- `kind` values that aren't a real claim kind (the common case for non-claim
  input) fall back to the renderer's existing generic icon
  (`❓` / `[???]`) — no per-node custom icon field. `discovery map` stays
  claims/GitHub-fetch-only; it does not gain a `--file` flag.
- `--ascii` behaves identically to `discovery map`'s flag.

## Consequences

There are now two entry points into the same rendering library: one
claims-specific (`discovery map`, fetches from a claims repo, org-scoped) and
one generic (`diagram print`, arbitrary local/piped JSON, no org/claims
concept). `schemas/RelationGraph.json` is excluded from claim-kind codegen
(`generateCommands.ts` only scans `*Claim.json`), so it does not generate a
`create relationgraph` command or appear in `CLAIM_KINDS`. All non-claim
`kind` values render with one shared fallback icon; per-kind custom icons are
deferred until a real need for visual differentiation shows up.
