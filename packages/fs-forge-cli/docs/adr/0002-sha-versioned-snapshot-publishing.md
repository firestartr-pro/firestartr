# SHA-versioned snapshot publishing for `@firestartr/fs-forge-cli`

`fs-forge-cli` snapshots (on-demand dev releases to npm) are versioned as
`<manifest-version>-snapshot.<sha8>` — the first 8 characters of the dispatched
branch's HEAD commit — and published under the `snapshot` dist-tag via a
`workflow_dispatch` on `npm-publish-fs-forge-cli.yaml`. No git tag, branch, GitHub
release, or PR is created: snapshots are npm-only throwaway artifacts.

## Considered options

- **Clone `@firestartr/cli`'s scheme** (hand-typed `vX.Y.Z-snapshot-N` semver via
  a `version` dispatch input). Rejected: the manual counter forces a unique
  version every publish, needs a dedicated branch to stage the bump, and those
  branches are never pruned — `cli` has accumulated 177 stale `feat/bump-cli-to-*`
  branches. It also loses commit traceability.
- **SHA-derived version (chosen).** One commit maps to exactly one version, no
  manual counter, no branch artifact, and the version itself names the commit it
  came from. Trade-off: SHA prereleases don't sort chronologically by semver, but
  `npm i @firestartr/fs-forge-cli@snapshot` always resolves the last-published snapshot.

## Consequences

- `cli` still uses the counter scheme; this deliberately diverges from it. `cli`
  will be migrated to this SHA scheme later under a separate issue, at which point
  both packages converge.
- The publish job runs the full oclif build (`prebuild` codegen → `tsc` →
  `npx oclif manifest`) before `npm publish --tag snapshot`, so snapshots ship a
  correct manifest.
