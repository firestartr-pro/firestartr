# ADR 0006: Node 24 as the CI and image baseline

## Status

Accepted

## Context

ADR 0005 pinned npm 12.2.1, whose own `engines` are
`^22.22.2 || ^24.15.0 || >=26.0.0`. That range, not the repository's preference, decides
which Node versions can run the canonical npm; the repository then decides which of those
lines it tests.

Before this decision every job asked `actions/setup-node` for `node-version: "22"` and
every image was built `FROM node:22-bookworm(-slim)`, so the repository floated on the
latest 22.x patch. Node 22 is in maintenance LTS (security fixes only, end of life April
2027) while Node 24 has been Active LTS since October 2025 and is supported until April
2028. Node 26 was released in April 2026 and takes over the Active LTS slot in October
2026; this decision deliberately stays one major behind the newest line, which is
supported until April 2028 regardless. The 22.x line already satisfies npm 12.2.1
(`22.22.2` is its floor), so nothing was broken — the repository was simply building on
the older line.

Node 24 had to be validated against the code, not assumed: a major bump can change module
resolution, timing and native addon behaviour, and this repository builds and tests a
Kubernetes operator, two CLIs, a schema publisher and a CDK8s renderer with it.

The one place the repository does not choose its Node is the e2e container: the upstream
`firestartr-core` module creates it from `alpine:latest`, so its Node follows whatever
Alpine ships, and a stale `latest` can still be Alpine 3.22 with Node 22. That container
is made explicit rather than left to drift.

## Decision

- Every `actions/setup-node` step asks for `node-version: "24"`: the three `pr_verify`
  jobs, the four npm publish workflows, `e2e`'s `unit-tests` job, `promote_docs` and
  `promote_claims_schema` — ten steps in eight workflow files, the same set that installs
  the pinned npm.
- Every Dockerfile builds on `node:24-bookworm` or `node:24-bookworm-slim`:
  `docker/slim.Dockerfile`, `docker/full-aws.Dockerfile`, `docker/full-az.Dockerfile`,
  `docker/dev.Dockerfile`, `docker/build.Dockerfile`, `docker/run-slim.Dockerfile`,
  `docker/run-aws.Dockerfile` and `docker/run-az.Dockerfile`. This moves the published
  CLI runtime images, not just the builders.
- `engines.node` is `^24.15.0`: the single line CI tests. npm 12.2.1 would also run on
  Node 26, but no job tests it, so it is not advertised. The suite still passes on Node
  22.23.4, yet that line is not supported either: the only Node 22 consumer inside the
  repository was the e2e container, and `PrepareTestContainer` now installs Node 24
  explicitly. The published packages keep their own `>=22` engines; only the repository
  manifest narrows.
- `@types/node` stays at `^22` in the root manifest and in `packages/fs-forge-cli`. The
  root `tsconfig.json` compiles with `target: "ES2020"` and no explicit `lib`, so it only
  typechecks against the ES2020 library — except that `@types/node@22` ships a deprecated
  compatibility polyfill that declares `Array.prototype.at`. `@types/node@24` removed
  that polyfill and the `packages/fs-forge-cli` build fails on `parts.at(-1)`
  (`TS2550: Property 'at' does not exist on type 'string[]'`). Bumping the typings means
  first declaring the library the code actually uses (`lib: ["ES2022", "DOM"]` in the
  root tsconfig), which is a typechecking change across all packages and belongs in its
  own change, not in a Node version bump.
- `README.md` advertises Node 24, the line CI runs, not "22 or later": Node 23 and 25
  exist and npm 12.2.1 supports neither.

## Consequences

- CI runs Active LTS and the repository refuses Node 22 (`npm ci` fails with
  `EBADENGINE`): one line is supported and tested here. Published packages still declare
  `>=22`; narrowing those stays a consumer-facing decision.
- Node 25 is not supported: npm 12.2.1 does not run on it and `engines.node` does not
  admit it. Node 26 is not admitted either, even though npm 12.2.1 runs there: moving to
  it is a manifest and CI change, not an npm one.
- The upgrade was verified before the change landed, on a detached worktree at the merge
  base, with npm 12.2.1:
  - `npm ci`, `npm run lint`, and the `cli` and `fs-forge-cli` builds pass on Node 24 with
    npm 12.2.1.
  - `docker build -f docker/slim.Dockerfile --target builder` succeeds: the real builder
    installs npm 12.2.1 on `node:24-bookworm`, runs `npm ci` and bundles the CLI with ncc.
  - All fourteen unit-test workspaces pass on Node 24. `cdk8s_renderer` (65 suites, 395
    tests) and `fs-forge-cli` (42 suites, 544 tests) were also run on 24.22.1 and 22.23.4
    with identical results, so the suite is not Node-version sensitive.
  - The `ts-jest` suites need `ORG=firestartr-test` exactly as CI provides it; without it
    claim references cannot resolve and suites fail on either Node version.
  - The e2e pin was verified in an `alpine:3.22` container with the same apk arguments:
    Node 24.22.1 from the v3.24 repository plus npm 12.2.1, then `npm ci` with the narrowed
    engines. It was not exercised through a full e2e run, which needs the private
    daggerverse credentials and a kind cluster.
- Bumping Node again means editing the same ten workflow steps, eight Dockerfiles, the
  e2e pin in `dagger/etoe/e2e.go`, the root `engines` range, its lockfile mirror and the
  README badge. There is deliberately no shared variable: a version that only exists in
  one place is a version nobody reviews.
