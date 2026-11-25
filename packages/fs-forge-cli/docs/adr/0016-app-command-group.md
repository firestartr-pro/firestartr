# ADR 0016: App command group (`fs-forge app`)

## Status

Accepted. Implemented for [#194](https://github.com/firestartr-pro/firestartr/issues/194).

## Context

Deploying a service on a Firestartr platform touches up to five repositories:
the claims repo, `{org}/.firestartr`, the per-app state repo `app-<app>`,
`{org}/state-argocd`, and the Service repository. The files and their landing
order follow deterministic rules, while the values differ per organization and
per App. Keeping that rendering and ordering in prose or agent prompts makes
deployments drift and fail.

`fs-forge app` moves the deterministic discovery, rendering, diffing, checking,
and PR orchestration into the CLI. Interactive prompting stays in the calling
skill or user workflow.

## Decision

### One inputs file shared by `plan` and `apply`

Both `fs-forge app plan` and `fs-forge app apply` read the same YAML file
defined by `AppInputs` (`schemas/AppInputs.json`). Because both commands load
and validate the same file, what a user approves in `plan` is the exact input
that `apply` executes.

### Read-only by default; `apply` runs only on request

`fs-forge app discover` and `fs-forge app plan` are read-only commands. They
inspect repositories, render files, compare them semantically, and report
checks and conflicts without writing to GitHub. `fs-forge app apply` is a
separate command that runs only when the developer asks the CLI to open PRs.

### Three-step landing order

Both `plan` and `apply` use the same three-step order:

1. **Step 1 (`claims`)**: land the `app-<app>` `ComponentClaim` and any
   Service `ComponentClaim` feature updates. Provisioning this step creates
   `app-<app>`, its orphan `deployment` branch, and seeds
   `.github/make_dispatches.yaml` when adding the feature.
2. **Step 2 (`.firestartr`, `app-<app>`, `state-argocd`)**: once step 1 is
   provisioned, open PRs in parallel for `apps/<app>.yaml`, the state-repo
   scaffold, and the ArgoCD `ApplicationSet` and `AppProject`.
3. **Step 3 (Service repo)**: once all step 2 PRs are merged, open the PR for
   `.github/make_dispatches.yaml` so the first image dispatch targets a wired
   application.

### One claim per PR in step 1 (user decision)

Claims in step 1 land one at a time through the Provision workflow on
`fs-forge/<Kind>-<name>`, and `plan` shows those exact PRs. Combining two
claims into one PR would merge both claims in the claims repo while hydrating
only one.

### Steps 2 and 3 are opened, never merged, by `apply` (user decision)

`fs-forge app apply` opens or reuses pull requests for steps 2 and 3 and waits
for them to be merged when waiting is enabled. It never merges them itself, so
the developer or repo owners keep merge control over `.firestartr`,
`app-<app>`, `state-argocd`, and the Service repository.

### Never overwrite existing files; differences are conflicts

The CLI builds every file as a structured object, validates it against its
schema, and compares it semantically with the existing file in the repository.
Additive merges (such as appending a deployment entry or adding a missing
ArgoCD destination) are allowed. Any incompatible difference is reported as a
conflict, and `apply` refuses to run while conflicts or failing checks exist.

### Reused open PRs must match the plan

When `apply` finds an existing open PR on `fs-forge/app-<app>` for a step 2 or
step 3 repository, it compares the PR's files against the current plan. It
reuses the PR only when the files match, and stops otherwise so an unrelated or
stale branch is never reused silently.

### Schema ownership boundary (user decision)

- **CLI I/O schemas** (`AppInputs`, `CommandHelpJson`, `MutationDiff`,
  `RelationGraph`) stay in `packages/fs-forge-cli/schemas/` and are exposed
  offline through `fs-forge schema`.
- **Prefapp-owned file schemas** (claims, `.firestartr`, `state_apps_env.json`,
  and action schemas) come from `@firestartr/firestartr-claims_schemas` (see
  [ADR 0015](./0015-claim-schemas-from-npm-package.md)).
- **Third-party CRDs** (ArgoCD `ApplicationSet` and `AppProject`) are
  committed under `schemas/vendor/` at a pinned version and refreshed with
  `npm run refresh-vendor-schemas`.

## Alternatives considered

### One orchestrating `app deploy` command with interactive prompts

Rejected because asking the user to choose targets, charts, and overrides is
the skill's job. Keeping the CLI non-interactive makes `discover`, `plan`, and
`apply` scriptable and testable.

### One render and apply pair per repository, sequenced by the skill

Rejected because the three-step landing order would live in a prompt instead of
code. Moving the sequence into `plan` and `apply` guarantees one ordering rule
for both manual and automated runs.

### CLI flags only, without an inputs file

Rejected because an App can have several Deployment targets, each with its own
platform, tenant, environment, cluster URL, track, and optional flavor. A
schema-validated YAML file represents that structure cleanly and can be reused
between `plan` and `apply`.

### Put App setup checks in `fs-forge preflight`

Rejected because `preflight` checks one claim name at a time. App setup checks
span multiple repositories, including `.firestartr` registries and platforms,
ArgoCD access, and Service repository workflows.

## Consequences

- `plan` and `apply` share one validated input contract (`AppInputs`) and one
  planner, so dry-run output matches execution.
- Step 1 remains compatible with the existing Provision workflow and audit
  issue flags (`--issue`, `--create-issue`).
- Partial `apply` runs are resumable: rerunning with the same inputs file skips
  already-landed work and reuses matching open PRs.
- Third-party ArgoCD CRD updates require running the vendor refresh script,
  while Prefapp schema updates arrive through `@firestartr/firestartr-claims_schemas`.
