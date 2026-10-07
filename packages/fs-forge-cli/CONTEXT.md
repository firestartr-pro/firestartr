# fs-forge-cli

The oclif CLI that turns firestartr claim schemas into command-line flags.

## Language

**Release**:
An official stable publish of the version currently in `package.json`. Published to npm
with the `latest` tag. If the version is already published, the publish fails — no
pre-flight check.

**Snapshot**:
An on-demand development publish tied to a specific source revision
(`<version>-snapshot.<SHA8>`). Published to npm with the `snapshot` tag.
Disposable and separate from a Release.
_Avoid_: dev build

**Claim**:
A deterministic YAML document describing a desired platform resource
(component, group, system, etc.). The CLI's core output unit.

**Catalog-only claim**:
A claim kind that produces only Backstage catalog entities, not GitHub CRs.
Currently `SystemClaim` and `DomainClaim`. These claims skip hydration steps
in the provision workflow because no GitHub CRs need to be created or reconciled.
Catalog hydration is handled downstream by the claims-index workflow regenerating
`claims-map.json` on merge to the default branch.

**Schema**:
A JSON Schema (draft 2020-12) file under `schemas/` that defines the structure
and constraints of a claim kind.

**Kind**:
The type of a claim — `ArgoDeployClaim`, `ComponentClaim`, `DomainClaim`,
`GroupClaim`, `OrgSettingsClaim`, `OrgWebhookClaim`, `SecretsClaim`,
`SystemClaim`, `TFWorkspaceClaim`, `UserClaim`.

**Codegen**:
The metadata-driven code generation process
(`src/codegen/generateCommands.ts`) that reads schemas and produces oclif
`Command` classes.

**Flag**:
A CLI flag derived from a schema property path. The leaf-node representation of
a claim field on the command line.

**FlagSpec**:
Structured metadata about a flag:
`{ path, type, required, description, enumValues, defaultValue, multiple }`.

**OCLIF**:
The Open CLI Framework (v4) that powers the CLI runtime — command discovery,
flag parsing, help output.

**Deterministic**:
A core design property of the `create` commands: given the same flags, the
CLI must always produce the same claim YAML — no randomness, no network calls
during claim construction. Does not apply to `edit` or to the explicit
`create --commit` publish step, which are inherently network-bound.
Defaults from the claims repo are intentionally not applied during `create` —
use `defaults apply` or let `edit` fill them automatically.

**Feature**:
A versioned platform capability published with configuration metadata and documentation.

**Feature source**:
A URL or local directory containing a Feature index and its referenced Feature files.

**Default source**:
The public `firestartr-pro/docs` Feature source used when `--source` is omitted.

**Feature index**:
The source's `index.json`, listing each Feature's current version and file manifest.

**Feature schema**:
A version-specific `schema.json` describing a Feature's args and generated files.

**Feature args**:
The configuration object in a Feature reference (`args`), validated against a Feature's schema.
_Avoid_: Feature config, Feature options

**Feature reference**:
The `{name, version, ref, args}` tuple that pins a Feature version to a claim.

**Feature CRUD**:
Add, list, edit, and remove Feature references on a claim — using the
Feature's own schema to drive CLI flag generation for its args, not the
claim schema's features array definition.

**Discover**:
Read Feature metadata or documentation from a Feature source without changing it.

**Claims repo**:
The GitHub repository (conventionally `<org>/claims`) that stores the org's
platform claim YAML files. The single source of truth for all claim data.

**Claims map**:
A `claims-map.json` file hosted on the `claims-index` orphan branch that maps
`<Kind>-<name>` keys to their relative file paths in the claims repo. Produced
by `cdk8s_renderer.generateClaimsMap()` after each push to the default branch.

**Claims-index branch**:
An orphan branch on the claims repo that contains only `claims-map.json` (or
`claims-map.json.stale` on workflow failure). No shared history with the
default branch.

**Claims-index workflow**:
The GitHub Actions workflow at `.github/workflows/generate-claims-map.yaml` in the
claims repo. Triggered on push to the default branch; regenerates and
pushes `claims-map.json` to the `claims-index` branch.

**Provision workflow**:
The GitHub Actions workflow at `.github/workflows/provision-claim.yaml` in the
claims repo. Triggered by `workflow_dispatch`; opens a PR for the branch,
runs verify, merges, dispatches hydration, and merges the wet PR. Takes
`claimType`, `claimName`, and optional `correlationId` as inputs.

**Deterministic path**:
The conventional mapping from claim kind to directory under `claims/`.
GitHub elements (`ComponentClaim`, `GroupClaim`, `UserClaim`, `SystemClaim`,
`DomainClaim`, `OrgWebhookClaim`, `ArgoDeployClaim`) follow
`<kind-dir>/<name>.yaml`. `TFWorkspaceClaim` and `SecretsClaim` use a
user-provided `--path`.

**Claims repo interaction**:
The mechanisms by which fs-forge reads from and writes to a claims repo:
**get claim** (read claims-map → download claim file), **create claim**
(create branch → commit claim → dispatch provision workflow), and
**get defaults** (fetch `claims_defaults.yaml` for additive default application).
Implemented by `src/claims/claimsRepo.ts` over the GitHub port.

**GitHub port**:
The `src/github/api.ts` interface describing the GitHub operations fs-forge
needs in its own data shapes. `src/github/octokitApi.ts` implements it over a
single raw `@octokit/rest` Octokit instance authenticated via `GITHUB_TOKEN`,
built by `createGitHubApi`; tests use an in-memory implementation. Does not use
`packages/github`. See ADR 0003.

**Defaults** / **Claim defaults**:
Per-kind default values sourced from the claims repo's `claims_defaults.yaml`.
Applied additively (fills omitted fields without overwriting existing values).
Consumed by `defaults apply`, `defaults show`, `defaults list`, and automatically
by `edit` after user overrides.

**Defaults file**:
A YAML file (`claims_defaults.yaml`) in the claims repo containing per-kind
defaults. Conventionally at `claims/claims_defaults.yaml`; if absent the CLI
searches the repo for any file with that name. Formatted as:
```yaml
ComponentClaim:
  platformOwner: "group:firestartr-test-platform-team"
  providers:
    github:
      orgPermissions: 'none'
      technology:
        stack: "node"
        version: "14"
      features: []
GroupClaim:
  providers:
    github:
      org: my-org
      privacy: closed
```

**Defaults apply**:
A command (`fs-forge defaults apply <Kind>-<name>|-f <file> --org <org>`)
that fetches or reads a claim, applies its kind's defaults from the claims
repo using additive-only merge, and outputs the filled claim YAML to stdout.
Pipe-friendly. Does not modify the claims repo.

Defaults application respects **default blocks** — paths treated atomically
so that specifying any field within a block preserves the entire claim-level
value, and omitting the entire block applies the default in full.
Blocks are hardcoded in the CLI (e.g. `/providers/terraform/sync`).

**Defaults show**:
A command (`fs-forge defaults show <kind> --org <org>`) that fetches the
defaults file from the claims repo and prints the defaults for a specific
claim kind to stdout. Short kind names match the `kinds` command
(e.g. `component`, `group`).

**Defaults list**:
A command (`fs-forge defaults list --org <org>`) that lists which claim
kinds have defaults defined in the claims repo. Table output by default,
`--json` for machine-readable output.

**Relation graph**:
The structured nodes and directed, field-labelled edges derived from claim
references. It is the JSON output of `discovery map` and the input to relation
tree rendering.

**Relation map**:
A rendered tree view of a Relation graph. It uses box-drawing connectors,
schema-generated claim-kind icons, visible dangling/cycle markers, and permits
a shared claim below each of its parents.

**Claim diff**:
A comparison of one Claim before and after an edit mutation. It covers
Claim fields, not the one-hop relations formerly covered by Relation diff.

**Discovery map**:
The read-only `fs-forge discovery map` command. It downloads one Claims repo
tarball, derives the organization Relation graph from claim YAML, and renders
or returns it without mutating claims. See ADR 0005.

**Org elements**:
The complete set of claims stored in an org's claims repo, representing all
declared platform resources for that org. Discovered via the claims map.

**Discovery**:
A read-only CLI operation that queries claims metadata from the claims repo's
claims-index branch without modifying any state. See ADR 0004.

**Correlation ID**:
A UUID generated by the CLI and passed as a `workflow_dispatch` input to the
Provision workflow. Used to locate the specific workflow run for polling.
Appears as the workflow run's display title so the CLI can match it without
needing a run ID returned from the dispatch API.

**Provision wait**:
The synchronous polling loop in the CLI that blocks after a Provision workflow
dispatch until the run reaches a terminal state (`completed` with `conclusion`
of `success`/`failure`/`cancelled`, or timeout). Enabled by default when
`--commit` is used; skipped with `--no-wait`. See ADR 0007.

**Provision result**:
The structured outcome of a Provision workflow run, surfaced to the user as:
`ok` (conclusion=success), `error` (conclusion=failure/cancelled), `timeout`
(poll deadline exceeded), or `run_not_found` (no run with the correlationId
appeared within the grace window).

**Preflight**:
A read-only gate check run before creation, edition, or deletion of a claim.
Validates local claim state and/or provider-side resource existence to prevent
collisions. Never mutates claims or provider resources. See ADR 0008.

**Provider-backed resource**:
A resource whose lifecycle is managed by an external provider API (e.g., GitHub
repositories, teams, users). Distinguished from Kubernetes-internal CRs which
have no external existence outside the cluster.

**Claim conflict**:
A name collision detected in the local claims system: a claim with the same
kind and name already exists in `claims-map.json`. Preflight exit code 1.

**Provider conflict**:
A name collision detected at the provider API: the resource already exists in
the target provider (e.g., GitHub) but has no corresponding claim. Preflight
exit code 2. User is directed to the import process.

**Wet PR**:
A pull request in a state repo (`state-github`, `state-infra`) created by the
hydrate workflow. Contains rendered Custom Resources ready for plan/apply.
The wet PR carries GitHub check runs (e.g. `terraform_plan`, `terraform_apply`)
that reflect the actual reconciliation status of the claimed infrastructure.
_Avoid_: hydration PR, state PR

**State repo**:
A GitHub repository (`<org>/state-github`, `<org>/state-infra`) that stores
rendered Custom Resources for a provider domain. Wet PRs are opened against
these repos by the hydrate workflow. Each state repo covers one provider
domain (GitHub resources, infrastructure resources).

**Check run**:
A GitHub status check attached to a commit or pull request. In wet PRs,
check runs report the outcome of terraform plan/apply stages per CR.
Each check run carries a conclusion (`success`/`failure`), an output summary
with per-CR results, and optional annotations with line-level details.

**Claim-ref annotation**:
A YAML annotation (`firestartr.dev/claim-ref: <Kind>/<name>`) embedded in
rendered CRs. Used to match wet PRs back to their originating claim.
The `watch-checks` command uses this to discover the correct wet PR.

**Watch-checks**:
A CLI command (`fs-forge watch-checks <Kind>-<name> --org <org>`) with two
modes. **Watch mode** (default): discovers the wet PR for a claim in state
repos, polls all check runs until completion, and reports per-CR
reconciliation status. **Current mode** (`--current`): reads the rendered CR
from the state repo's main branch, follows the `last-state-pr` annotation to
find the PR, and reports its check run status plus CR content. Also available
as an opt-in `--wait-for-checks` flag on `create`/`edit --commit`.

**Last-state-pr annotation**:
A YAML annotation (`firestartr.dev/last-state-pr: <repo>#<number>`) on
rendered CRs in state repos. Points to the PR that last modified the CR.
Used by `watch-checks --current` to find the reconciliation history of an
already-hydrated claim.
