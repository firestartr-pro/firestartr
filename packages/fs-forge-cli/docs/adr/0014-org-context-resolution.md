# ADR 0014: The CLI resolves its own context; `--org` is optional

## Status
Accepted. Supersedes [ADR 0010](0010-org-required-flag-no-autodiscovery.md).

## Context

Before every invocation, the `firestartr-operation` skill made the agent do the
same deterministic work by hand (Step 1 of its `SKILL.md`, plus
`reference/config-schema.md`): read a config file, match the working directory
against stored `paths` on segment boundaries, resolve the org and the claims /
state / catalog repos, compare the CLI version pin against `npm dist-tag ls`,
and prefix every command with `GITHUB_TOKEN="$(gh auth token)"`.

That is ~90 lines of instructions on every run, it is what the CLI can compute
exactly, and path matching done by hand is where the mistakes came from
(prefapp/skills#123, findings in prefapp/skills#126; this package's issue #101).

## Decision

- One resolver, `src/context/`, over a config file the CLI owns:
  `$FS_FORGE_CONFIG`, else `$XDG_CONFIG_HOME/fs-forge/config.yaml`, else
  `~/.config/fs-forge/config.yaml`. The schema is the flat one from the skill:
  `organizations[].{name, paths[], claims_repo?, state_github_repo?,
  state_infra_repo?, catalog_repo?}` plus a single top-level `cli_version`.
  The old single `organization: {name}` shape counts as no config; nothing is
  migrated silently.
- Path matching is on segment boundaries, `~` is expanded, and the longest
  matching stored path wins. The same longest path claimed by two organizations
  is `AMBIGUOUS_MATCH`; the CLI never tie-breaks a real ambiguity.
- `fs-forge context [--json]` prints the effective context: org, source
  (`flag`, `env`, `config`), matched path, the four repos, the running / latest
  / pinned CLI version, and the auth source. It exits non-zero with one of
  `NO_CONFIG`, `NO_MATCH`, `AMBIGUOUS_MATCH`, `NO_AUTH`; with `--json` the
  failure is `{"error": {"code", "message"}}` on stderr.
- `--org` is optional wherever it exists. `ORG_FLAG` resolves the org as its
  oclif default, so precedence is flag, then `FSCRT_ORG`, then the config
  match. Failure reporting stays in one place (`requireOrg`), which keeps the
  existing message and appends the context code.
- Auth: `GITHUB_TOKEN`, else `gh auth token`, resolved in one place
  (`src/context/auth.ts`) and consumed by `createGitHubApi`; `context` reports
  only the source. The token is never printed.
- The registry lookup for `latest` exists only inside `context`: bounded by a
  short timeout and non-fatal (`null` when offline). No other command touches
  the network or spawns `gh` as part of resolving context: they read one small
  config file. The path match picks the org only when neither `--org` nor
  `FSCRT_ORG` is present; an org chosen either way still takes its configured
  repos from its entry.
- `context init` / `context add-path` (writing the config) is deliberately out
  of scope: the new-organization flow stays in the skill for now.

## Alternatives considered

### Keep the resolution in the skill
Zero CLI work, but every run pays the instructions, and hand-run path matching
is exactly the failure this ADR removes.

### Infer the org from the git remote
Wrong for forks, monorepos with several claims checkouts, and preflight, which
runs before a claims repo exists locally. The config's explicit `paths` stay
authoritative.

### Resolve per command instead of in `ORG_FLAG`
Every command would repeat the precedence chain and drift. A flag default is
one declaration; commands keep consuming `flags.org` exactly as before.

### Keep `firestartr-config.yaml` inside the skill directory
The file describes the install, not a published skill: a skill upgrade must not
move or overwrite it. `$XDG_CONFIG_HOME` is the platform location, and
`FS_FORGE_CONFIG` keeps tests and non-standard installs explicit.

### Per-organization `cli_version`
One install runs one CLI version; a per-org pin would only invent conflicts.

### Make `--json` print the token
Never printed, by design: `context` reports only the auth source.

## Consequences

- `--org` closes over the config: commands work from any checkout the file
  registers, and `preflight` no longer needs an explicit org (ADR 0010 is
  superseded rather than amended).
- The skill keeps only the "ask the client" step for `NO_MATCH` /
  `AMBIGUOUS_MATCH`; `reference/config-schema.md` moves into this package's
  documentation (CONTEXT.md vocabulary and this ADR).
- A malformed or half-migrated config fails loudly as `NO_CONFIG` instead of
  silently resolving the wrong org.
- `context` performs one bounded registry lookup; every other command stays
  offline unless it actually talks to GitHub.
