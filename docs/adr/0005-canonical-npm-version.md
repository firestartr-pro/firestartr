# ADR 0005: One canonical npm version, declared in `packageManager` and installed per job

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

Corepack is not part of this repository's CI or contributor instructions. Version
selection is explicit: each job installs npm itself.

## Decision

- The root `package.json` declares `"packageManager": "npm@12.2.1"` and
  `engines: { node: ">=22.22.2", npm: "12.2.1" }`. The `packageManager` field exists for
  Dependabot, which reads it to pick the npm that regenerates the lockfile. No workflow
  runs Corepack and no contributor is asked to enable it.
- The pin is an exact semver, not a major. Corepack validates the field wherever it is
  enabled, so `"npm@12"` makes every npm command fail on a machine that has Corepack
  shims on `PATH` (`Invalid package manager specification in package.json (npm@12);
  expected a semver version`), even though our CI does not use Corepack. Dependabot also
  only extracts a version with `^npm@(\d+\.\d+\.\d+)`
  (`package_manager.rb#requested_version`); a bare major is ignored and the bot silently
  keeps its image npm.
- Every job that runs npm installs the declared version right after
  `actions/setup-node`, with `- name: Install npm` / `run: npm install -g npm@12.2.1`:
  the three `pr_verify` jobs, the four npm publish workflows, `e2e`'s `unit-tests` job,
  `promote_docs` and `promote_claims_schema`. In the publish workflows this replaces the
  old `npm install -g npm@11.5.1`, so the OIDC floor stops being a pin hidden in four
  places and becomes the declared version.
- `engines.node` moves to `>=22.22.2` because npm 12.2.1 requires
  `^22.22.2 || ^24.15.0 || >=26.0.0`; CI's `node-version: "22"` resolves to the latest
  22.x and satisfies it. `engines.npm` is advisory: another npm only produces an
  `EBADENGINE` warning, and the gate catches the resulting lockfile drift.
- The lockfile was renormalized once with npm 12.2.1. The diff is exactly the five
  workspace `dev` markers; no resolved version, `resolved` URL or integrity hash changed.
- `docker/slim.Dockerfile` and `docker/full-aws.Dockerfile` keep the base image's npm for
  `npm ci`. Deliberate: `npm ci` never regenerates the lockfile, so the version cannot
  cause drift, and installing npm in the image would add a registry download to every
  build.
- Feature-managed workflows are not edited by hand. The npm calls in `make_dispatches`,
  `trigger_deployment` and `build_images_summary_reusable` run in a workspace with no
  manifest, so they are outside this decision.

## Consequences

- "The lockfile is in sync" has one meaning: the npm named in `package.json`. A Dependabot
  bump touches only the lines of the bumped dependency.
- The version literal now appears in ten workflows. Bumping npm means editing
  `package.json`, those ten steps and the lockfile together; a repository variable would
  remove the repetition but also the review, so it was rejected. A future check could
  assert that every `npm install -g npm@…` matches `package.json`.
- Dependabot's certainty is at major level. It runs
  `corepack install npm@12.2.1 --global --cache-only` inside its own image; when that
  exact release is missing from the image cache, `recover_from_failed_install` degrades to
  the latest cached 12.x and raises if even that fails. Keep the pin on the major the bot
  image carries (12 today), or the bot will start failing instead of drifting.
- Because nothing uses Corepack, a `node-version` bump is safe: Node 25+ drops Corepack
  and that no longer affects this repository.
- npm 12 blocks install scripts that are not covered by `allowScripts`; here that skips
  the `esbuild` and `unrs-resolver` postinstalls. Lint, the TypeScript builds and the
  unit tests pass without them, so no `allowScripts` entry was added. If a future
  dependency needs its postinstall, add it there rather than reinstalling npm by hand.
- The claims-schemas publish builds its package under `/tmp` and runs npm there; the
  globally installed 12.2.1 is what runs, so OIDC keeps working.
- Unifying npm does not make every Dependabot PR mergeable: a dependency declared with
  different specifiers across manifests still changes the lockfile (#134). That is a
  separate decision.
