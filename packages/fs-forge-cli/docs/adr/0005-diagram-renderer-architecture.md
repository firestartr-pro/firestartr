# Claim relation maps share one claims-aware renderer

## Status

Accepted — supersedes the earlier generic `diagram print` design recorded in
this file. Partially amended by ADR 0006: `discovery map` and the claims
`--diff` views stay claims-only as decided here, but a separate `diagram
print` command was later added to accept arbitrary `RelationGraph` JSON
through the same renderer, for non-claims callers. Further amended by ADR
0007: the one-hop relation diff for `create`/`edit` described below
was retired — those commands no longer render a relation tree at all.

## Context

Claim authors need an organization-wide ownership/grouping view and a one-hop
relation diff for create and edit. A generic JSON-to-tree command could not discover the real claim relations and would make every caller rebuild the
same graph semantics. Organization-wide discovery must also avoid one GitHub
request per claim, while create must remain deterministic and offline.

## Decision

- `src/lib/relationMap.ts` is the pure, claims-aware graph builder, differ, and
  renderer used by `discovery map`, edit, and generated create commands.
- It recognizes only `owner`, `maintainedBy`, `platformOwner`,
  `subComponentOf`, `system`, `domain`, `parent`, `children`, and `members`.
  API and inline Feature references remain outside the graph.
- Organization discovery downloads one claims-repo tarball, extracts claim YAML
  locally, and can return either the structured graph or its rendered tree.
- Edit uses the already-loaded claims map to identify dangling direct
  references. Create builds its one-hop graph only from declared references and
  performs no network access.
- Tree rendering uses Unicode box-drawing connectors. Claim icons come from
  schema-driven generated metadata; emoji is the default and `--ascii` selects
  bracket tags explicitly.
- Cycles stop at a cycle marker, dangling targets stay visible, and shared nodes
  may be rendered below each parent.
- Diff output uses `+`, `-`, and `~` markers and has a structured JSON form.

## Consequences

There is one claims-specific graph contract rather than a public generic graph
input command. Whole-org reads use temporary local extraction and add the
already-adopted `tar` dependency. Adding a schema regenerates the supported kind
and icon metadata together with create commands.
