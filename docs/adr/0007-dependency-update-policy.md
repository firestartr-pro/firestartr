# ADR 0007: Dependabot cooldown, one Socket policy, and ignoring only what needs a coordinated PR

## Status

Accepted

## Context

`.github/dependabot.yml` ignored 15 packages under a comment that said "manual
review". Nothing tracked that review, so the ignores became permanent and the
packages drifted (`uuid` 9 vs 14, `@octokit/request` 10.0.9 vs 10.0.16,
`cron-parser` 5.5.0 vs 5.10.6), missing security fixes and widening the eventual
major jump (#215).

The Dependabot triage skill ran `socket package score` and stopped on **any**
finding. The verdict also depended on a Socket dashboard policy outside the
repo, so it changed with whoever configured the org. #182 (`globals` 17.13.0 →
17.14.0) stopped on a `recentlyPublished` alert, which means "new", not
"malicious".

Two facts frame the decision:

- Dependabot already applies an implicit 3-day cooldown to version updates, and
  a malicious npm release is usually pulled within days of publication.
- Security updates are the only PRs with no waiting. They are also the ones a
  compromised "security fix" would ride in on.

Dependabot opens one PR per package. Several dependencies here cannot move one
at a time: the oclif CLI framework (`@oclif/core`, `@oclif/test`,
`@oclif/plugin-help`), `@kubernetes/client-node` (five packages share it), the
octokit trio (`@octokit/core`, `@octokit/rest`, `@octokit/plugin-paginate-rest`)
and `jest` against `ts-jest` 29.

## Decision

- **Cooldown** in `dependabot.yml`: 7 days by default, 14 for majors, 7 for
  minors, 3 for patches. Security updates skip it and open immediately.
- **Socket scores the bumped package; the gate blocks only on malware.** Triage
  runs `socket package score npm <name>@<version> --json` with the operator's own
  token and reads only the result: any alert with `category: supplyChainRisk` and
  `severity: critical` in the package (`self`) or its dependencies
  (`transitively`) stops with `stopped: socket block`; no such alert continues as
  `ok`. CVEs, install scripts, network access, obfuscation heuristics, licence and
  maintenance alerts are listed as information and never stop a bump, because the
  bump is usually the fix. A failed call, a missing token, `ok: false` or a
  version that is not on the registry is `stopped: socket unknown`, so the gate
  fails closed. Alerts are deduplicated by name + severity + example. Labels are
  `socket/ok|block|unknown`, so the old `socket/alert` label is removed
  automatically and PRs stopped under the old step resume at `triaged`.
  No organization, no dashboard policy, no `--org`, no scan upload and no
  worktree: the command takes a package, not a tree.
- **`ignore` freezes the major of a dependency, never the dependency.** Each
  entry carries `update-types: ["version-update:semver-major"]` and a comment
  saying what lifts the hold. Patches and minors keep arriving; security updates
  always arrive because `update-types` does not apply to them.
- **No `socket.yml` and no `groups`.** Locally the CLI only reads
  `projectIgnorePaths`, and grouping changes PR titles, which the triage title
  parser and release-please depend on. Both are separate decisions.
- **Override** for a legitimate PR the policy blocks: check the diff
  (`npm diff`), check the advisory and the publisher, add a dashboard Alert
  Triage rule scoped to that alert on that `package@version`, comment on the PR,
  retriage. The policy is never weakened as a whole.

The nine holds in place today, and what lifts each one:

| Dependency | Hold | Lifts when |
|---|---|---|
| `@oclif/core`, `@oclif/test`, `@oclif/plugin-help` | major 5/5/7 is a CLI framework rewrite | `fs-forge-cli` migrates as one PR (or a `groups` entry exists) |
| `@kubernetes/client-node` | major 2 rewrites the client API | the five consumers move together |
| `@octokit/plugin-paginate-rest` | majors must match `@octokit/rest` (22 wants `^14`) and `@octokit/core` | the octokit set moves together |
| `@types/node` | must describe the Node version in `engines`, not the newest release | `engines.node` moves |
| `jest`, `@types/jest`, `@jest/globals` | `ts-jest` 29 only supports jest 29 | the workspace finishes migrating to jest 30 |

## Consequences

- Patches and minors arrive on their own again, so the drift that motivated
  #215 stops, without opening nine major PRs at once.
- Major upgrades only happen through a deliberate PR that touches every
  affected package. They no longer appear as surprise Dependabot PRs.
- Each operator runs `socket login` once. A free token with `packages:list` is
  enough; there is no org, no policy to maintain and nothing uploaded. A missing
  or broken login yields `unknown` and stops: the gate fails closed.
- The gate does not judge licences, CVEs or code quality. Those findings stay in
  the comment for a human and never block a dependency bump.
- Freezing majors instead of removing every ignore is broader than #192 and #215
  asked for. This ADR is the record; the issues stay as the origin.

## Alternatives considered

- **Remove every ignore.** Correct per #215, but it reopens nine major PRs that
  cannot pass independently without a coordinated change.
- **Keep the blanket ignore, documented.** Cheap, but it also freezes patches,
  which is the bug #215 reports.
- **Dependabot `groups` first.** The proper fix for the coordination problem, but
  it changes PR titles and the triage title parser in the same change.
- **Socket org policy and `socket scan create --report`.** The earlier draft. It
  makes a dashboard the source of truth, but costs a Socket org, a policy nobody
  reviews in git, a key with `full-scans:*` and `security-policy:read`, and one
  uploaded full scan per triage. Rejected: the verdict must be reviewable in a
  diff and must not depend on server-side configuration.
- **Socket GitHub App and `socket.yml`.** Needs the app installed on the repo and
  moves the gate into CI; out of scope for #192.
