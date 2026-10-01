# Retire the one-hop relation diff from `create`/`edit`

## Status

Accepted — amends ADR 0005's "one-hop relation diff for create and edit"
decision.

## Context

ADR 0005 gave `create`/`edit --diff` a rendered one-hop relation tree
(added/removed/changed markers, icons, dangling refs) alongside the claim's
field-level changes. In practice the icon-based tree read as a second,
differently-shaped diff bolted onto the same command output, and it was
harder to scan than a single unified view of "what changed in this claim."
A unified line diff over the claim's rendered YAML (git-diff style, changed
lines marked `-`/`+`) provides one view that fully covers field-level changes.

## Decision

- `edit --diff` uses only the unified YAML diff; the relation tree is
  removed from its output, in both text and JSON (`--diff --json` without
  `--show-defaults` now returns the flat changed-field list instead of a
  relation graph).
- `create` loses `--diff` — and the now-purposeless `--json`/`--ascii` that
  only existed to control it — entirely. It has no "before" claim to diff
  against, so the relation tree was its only `--diff` output; `create` always
  prints the full new claim regardless.
- `formatRelationDiff`/`buildRelationDiff` and the claims-map-based
  dangling-reference lookup they used are deleted — nothing in the CLI calls
  them anymore.
- The shared renderer (`renderRelationGraph`, including its `+`/`-`/`~`
  status markers and `--ascii`/emoji icons) is untouched and keeps serving
  `discovery map` and `diagram print`, which render whole-graph views, not a
  before/after diff for one mutation.

## Consequences

There is no longer a one-hop, single-claim relation view anywhere in the
CLI; the closest available view is `discovery map`'s whole-org graph.
Reintroducing a one-hop view (e.g. a dedicated read-only command) is
explicitly out of scope here and left for a future, separately-scoped issue
if it turns out to be missed.
