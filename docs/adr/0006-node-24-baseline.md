# ADR 0006: Node 24 as the CI and image baseline

## Status

Accepted

## Context

ADR 0005 pinned npm 12.2.1, whose own `engines` are
`^22.22.2 || ^24.15.0 || >=26.0.0`. That range, not the repository's preference, decides
which Node versions can run the canonical npm.

Before this decision every job asked `actions/setup-node` for `node-version: "22"` and
every image was built `FROM node:22-bookworm(-slim)`, so the repository floated on the
latest 22.x patch. Node 22 is in maintenance LTS (security fixes only, end of life April
2027) while Node 24 has been Active LTS since October 2025 and is supported until April
2028. The 22.x line already satisfies npm 12.2.1 (`22.22.2` is its floor), so nothing was
broken — the repository was simply building on the older line.

Node 24 had to be validated against the code, not assumed: a major bump can change module
resolution, timing and native addon behaviour, and this repository builds and tests a
Kubernetes operator, two CLIs, a schema publisher and a CDK8s renderer with it.

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
- `engines.node` stays at npm 12.2.1's range
  (`^22.22.2 || ^24.15.0 || >=26.0.0`) instead of being narrowed to 24. Node 22 remains
  admitted because the published packages have consumers on it and because the e2e
  container still runs Alpine's Node 22 (ADR 0005). A narrower range would break both
  without a matching change in code.
- `@types/node` stays at `^22` in the root manifest and in `packages/fs-forge-cli`. The
  root `tsconfig.json` compiles with `target: "ES2020"` and no explicit `lib`, so it only
  typechecks against the ES2020 library — except that `@types/node@22` ships a deprecated
  compatibility polyfill that declares `Array.prototype.at`. `@types/node@24` removed
  that polyfill and the `packages/fs-forge-cli` build fails on `parts.at(-1)`
  (`TS2550: Property 'at' does not exist on type 'string[]'`). Bumping the typings means
  first declaring the library the code actually uses (`lib: ["ES2022", "DOM"]` in the
  root tsconfig), which is a typechecking change across all packages and belongs in its
  own change, not in a Node version bump.
- `README.md` advertises 22 and 24, the two lines that work, not "22 or later": Node 23
  and 25 exist and npm 12.2.1 supports neither.

## Consequences

- CI now runs Active LTS. Node 22 is still installable
  (`npm ci` passes on 22.23.4) but no job tests it; that gap is accepted until the e2e
  container and published consumers move, and is recorded in ADR 0005.
- Node 25 is not supported: npm 12.2.1 does not run on it and `engines.node` does not
  admit it. Node 26 is already admitted by the range, mirroring npm.
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
- Bumping Node again means editing the same ten workflow steps, eight Dockerfiles, the
  root `engines` range, its lockfile mirror and the README badge. There is deliberately no
  shared variable: a version that only exists in one place is a version nobody reviews.
