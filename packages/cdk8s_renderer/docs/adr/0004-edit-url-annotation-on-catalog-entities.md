# Backstage edit-url annotation points to claim file

All rendered catalog entities receive a `backstage.io/edit-url` annotation so
Backstage's "edit" button links to the source claim file in the git repository
instead of the (non-editable) catalog view. The URL is a full git URL
constructed from render-time global config (repository base URL, default
branch) plus the claim's relative path from the repository root.

We chose a full git URL over a relative path because Backstage renders the
edit button as a clickable external link — a relative filesystem path would
not resolve.

## Repository URL source

The repository base URL can come from two sources, in priority order:

1. **Explicit CLI flag** `--repositoryUrl` — always takes precedence when set.
2. **Auto-derived from `ORG` environment variable** — when the flag is omitted,
   the URL is constructed as `https://github.com/{ORG}/claims`, assuming the
   claims repository is named `claims` under the GitHub organisation given by
   the `ORG` variable.

This two-tier approach means existing workflows that pass `--repositoryUrl` are
unaffected, while workflows that omit it (the common case) get the correct URL
without modification.

We chose derivation from the `ORG` environment variable (which already exists
and is mandatory for the renderer to run) over parsing from individual
`providers.github` blocks, since not all claim kinds carry GitHub provider data
and a single render pass always covers one client's repository.

## Relative path computation

The `--claims` CLI flag points to the `claims/` subdirectory inside the claims
repository (e.g. `$GITHUB_WORKSPACE/claimsdir/claims`). To produce a URL that
resolves in the browser, the relative path is computed from the **parent of the
claims directory** (the repository root, `$GITHUB_WORKSPACE/claimsdir`), not
from the claims directory itself. This preserves the `claims/` prefix in the
path segment — for example `claims/groups/grupo-c.yaml` instead of the bare
`groups/grupo-c.yaml`.

Concretely, in code: `path.dirname(getPath('claims'))` gives the repo root,
then `path.relative(repoRoot, claimFilePath)` yields the correct path
including the `claims/` subdirectory prefix.

## API entities

API entities are embedded in `ComponentClaim.providesApis` and have no
standalone claim file. Their edit URL points to the parent Component's claim
file (same `claimPath` as the owning Component). This is handled by threading
the effective claim path through the rendering context into the API-chart
constructor. The BackstageInitializer also accepts all catalog entity kinds
(not just ComponentClaim) so the annotation applies consistently across every
entity type.
