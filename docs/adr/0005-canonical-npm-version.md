# ADR 0005: One canonical npm version, declared with `packageManager`

## Status

Accepted

## Context

`package-lock.json` is validated against the `package.json` files by running npm
(`lockfile-in-sync` in `pr_verify.yaml`), so "in sync" only means something relative to
one npm version. Before this decision the repository used at least three: whatever Node
22 shipped inside `pr_verify` (10.9.x, and it floated with every Node 22 patch), npm
11.5.1 installed by hand in the four publish workflows (the OIDC floor), npm 12 inside
Dependabot (its default for `lockfileVersion: 3`), and anything on developer machines.

npm 12 marks workspace entries differently. Normalizing this lockfile with npm 12 removes
five `"dev": true` lines under
`packages/{crs_analyzer,crs_status_service,importer,operator,scaffolder}`; npm 10 and 11
keep them. Every Dependabot PR therefore failed the gate with a diff unrelated to the bump
the PR was about (#144).

## Decision

- The root `package.json` declares `"packageManager": "npm@12.2.1"`. It is the only
  place the npm version is written.
- The pin is an exact semver, not a major. Corepack validates the field as semver and
  rejects a bare major (`Invalid package manager specification in package.json (npm@12);
  expected a semver version`), and Dependabot only extracts a requested version with
  `^npm@(\d+\.\d+\.\d+)` (`package_manager.rb#requested_version`). With `npm@12` the bot
  would find no version and silently keep its image npm, which is the opposite of failing
  closed.
- Every workflow that runs npm against this repository runs `corepack enable npm` right
  after `actions/setup-node`: the three `pr_verify` jobs, the four npm publish workflows,
  and `e2e`'s `unit-tests` job. In the publish workflows that replaces
  `npm install -g npm@11.5.1`, so the OIDC floor stops being a pin scattered across
  workflows and becomes a constraint on the declared version.
- The package manager is named explicitly. `corepack enable` with no arguments installs
  shims for every supported manager *except* npm (`SupportedPackageManagerSetWithoutNpm`
  in corepack 0.35), because npm ships with Node. The bare form leaves the bundled npm
  active, so the gate keeps normalizing with npm 10, the five `dev` markers come back and
  publishing loses the `>= 11.5.1` npm. Name the shim.
- `promote_docs` and `promote_claims_schema` enable the npm shim too, but their `npm ci`
  runs inside the separate `gitops` checkout, so it follows that repository's pin, not
  this one.
- The lockfile was renormalized once with npm 12.2.1. The diff is exactly the five
  workspace `dev` markers; no resolved version, `resolved` URL or integrity hash changed.
- `docker/slim.Dockerfile` and `docker/full-aws.Dockerfile` keep the base image's npm for
  `npm ci`. Deliberate: `npm ci` never regenerates the lockfile, so the version cannot
  cause drift, and Corepack would add a registry download to every image build.
- Feature-managed workflows are not edited by hand. The npm calls in `make_dispatches`,
  `trigger_deployment` and `build_images_summary_reusable` run in a workspace with no
  manifest, so they are outside this decision.

## Consequences

- "The lockfile is in sync" has one meaning: the npm named in `package.json`. A Dependabot
  bump touches only the lines of the bumped dependency.
- Dependabot's certainty is at major level. It runs
  `corepack install npm@12.2.1 --global --cache-only`; when that exact release is missing
  from the bot image cache, `recover_from_failed_install` degrades to the latest cached
  12.x and raises if even that fails. Keep the pin on the major the bot image carries
  (12 today), or the bot will start failing instead of drifting.
- Bumping npm is a reviewed PR: edit the pin, renormalize the lockfile with the new
  version, and confirm the publish workflows still authenticate over OIDC.
- npm 12.2.1 requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`. CI's
  `node-version: "22"` resolves to the latest 22.x, which satisfies it. `engines.node`
  stays `>=22`: it is intentionally looser than Corepack's requirement.
- When Dependabot's `SUPPORTED_VERSIONS` adds a major newer than the pin, nothing changes
  until someone bumps the pin in a PR. When it drops the pinned major, that bump becomes
  mandatory.
- Node 25+ no longer bundles Corepack. If `node-version` moves there, every
  `corepack enable npm` step needs a replacement.
- npm 12 blocks install scripts that are not covered by `allowScripts`; here that skips
  the `esbuild` and `unrs-resolver` postinstalls. Lint, the TypeScript builds and the
  unit tests pass without them, so no `allowScripts` entry was added. If a future
  dependency needs its postinstall, add it there rather than reinstalling npm by hand.
- The claims-schemas publish builds its package under `/tmp` and runs npm there, outside
  the repository, where Corepack falls back to its default release. OIDC only needs
  `>= 11.5.1`, so that stays correct.
- Unifying npm does not make every Dependabot PR mergeable: a dependency declared with
  different specifiers across manifests still changes the lockfile (#134). That is a
  separate decision.
