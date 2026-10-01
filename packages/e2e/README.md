# E2E package

Helpers for writing Firestartr end-to-end tests.

This package is built around a simple flow:

1. load a base claim fixture
2. patch it for the test case
3. render it locally
4. apply the rendered CRs to Kubernetes
5. wait for reconciliation and clean everything up

The goal of this README is to show the easiest way to create or update an E2E
test.

The best way to try this locally is to use the `dagger/etoe` dagger module. See
`dagger/etoe/README.md`.

## Table of contents

- [Start here](#start-here)
- [Where base claims come from](#where-base-claims-come-from)
- [Basic test structure](#basic-test-structure)
- [Cleanup helpers](#cleanup-helpers)
- [Patching and renaming claims](#patching-and-renaming-claims)
- [Common recipes](#common-recipes)
  - [Create a GitHub team](#create-a-github-team)
  - [Create a GitHub repository](#create-a-github-repository)
  - [Create a GitHub organization webhook](#create-a-github-organization-webhook)
  - [Create a TFWorkspace](#create-a-tfworkspace)
  - [Link claims together](#link-claims-together)
- [Using patchContextFile](#using-patchcontextfile)
- [Using orgScript](#using-orgscript)
- [Reference tests](#reference-tests)
- [Not available yet](#not-available-yet)
- [Recommended local workflow with dagger](#recommended-local-workflow-with-dagger)
- [Main APIs you will use](#main-apis-you-will-use)
  - [`initE2e(org?, namespace?, options?)`](#inite2eorg-namespace-options)
  - [`client.claims`](#clientclaims)
  - [`client.k8s`](#clientk8s)
  - [Helpers exported by this package](#helpers-exported-by-this-package)
- [Environment](#environment)
- [Running tests](#running-tests)
- [Troubleshooting](#troubleshooting)

## Start here

Most tests follow the same steps:

1. Create the client with `initE2e(...)`.
2. Pre-clean stale resources with `destroyFixtureResources(...)`.
3. Render one or more fixtures with `client.claims.renderLocally(...)`.
4. Apply the rendered CRs with `client.k8s.applyCr(...)` or
   `applyAndWaitCrPaths(...)`.
5. Clean up rendered artifacts with `cleanupRenderedArtifacts(...)`.

If your test creates several independent resources, use `CleanupRunner` in
`afterAll` so teardown keeps going even if one step fails.

## Where base claims come from

Base claim fixtures are available in `packages/e2e/fixtures/base_claims`.

That directory is a symlink to
`packages/cdk8s_renderer/__tests__/fixtures/base_claims`, so there is only one
set of fixtures to maintain.

Common starting points:

- groups / GitHub teams: `packages/e2e/fixtures/base_claims/groups/group_a.yaml`
- components / GitHub repositories:
  `packages/e2e/fixtures/base_claims/components/component_a.yaml`
- default owner group used by `orgScript`:
  `packages/e2e/fixtures/base_claims/groups/firestartr.yaml`
- Terraform workspaces:
  `packages/e2e/fixtures/base_claims/tfworkspaces/tfworkspace_a.yaml`

In E2E code, use fixture stems such as `group-a`, `component-a`, or
`firestartr`.

- `group-a` maps to `packages/e2e/fixtures/base_claims/groups/group_a.yaml`
- `component-a` maps to
  `packages/e2e/fixtures/base_claims/components/component_a.yaml`
- `tfworkspace-a` maps to
  `packages/e2e/fixtures/base_claims/tfworkspaces/tfworkspace_a.yaml`

## Basic test structure

The minimal pattern is:

1. `initE2e(...)`
2. `destroyFixtureResources(...)` in `beforeAll`
3. `client.claims.renderLocally(...)`
4. apply the rendered CRs
5. wait for reconciliation
6. `cleanupRenderedArtifacts(...)` in `afterAll`

`renderLocally(...)` returns absolute manifest paths in `rendered.crPaths`.

Use `client.k8s.applyCr(...)` followed by `client.k8s.waitForCr(...)` when the
claim usually renders one CR, such as groups, org webhooks, and TFWorkspaces.

Use `applyAndWaitCrPaths(...)` when the claim can render more than one CR, such
as components.

Reference tests:

- minimal single-CR flow:
  `packages/e2e/__tests__/github/group-render-apply.test.ts`
- multi-resource flow:
  `packages/e2e/__tests__/github/org-script-render-apply.test.ts`
- Terraform single-CR flow with provider config setup:
  `packages/e2e/__tests__/terraform/tfworkspace-render-apply.test.ts`

## Cleanup helpers

Use the two cleanup helpers for different jobs:

- `destroyFixtureResources(...)`: name-based cleanup for fixture-derived
  resources; use it to delete stale cluster and GitHub org resources even if
  they were left behind by a previous run
- `cleanupRenderedArtifacts(...)`: cleanup for the current test process; use it
  to delete the CRs rendered in this run, remove temporary render folders, and
  destroy the shared render context

Rule of thumb:

- `beforeAll`: usually run `destroyFixtureResources(...)`
- `afterAll`: usually run both helpers

## Patching and renaming claims

Most tests patch the base claim at render time instead of editing fixture YAML
files.

Use `createNameBuilder(client.getPrefix())` when you need deterministic runtime
names.

Common patch patterns:

- rename the claim with `/name`
- rename provider-owned resources with provider-specific fields such as
  `/providers/github/name`
- remove or replace relationships that are not needed for the test, such as
  `/system` or `/members`
- inject runtime values such as webhook URLs, secret refs, or Terraform inputs

If you rename a claim, pass the explicit runtime name to cleanup:

- use `{ fixtureName: 'group-a', claimName: runtimeName }` instead of only
  `'group-a'`
- do the same for any fixture whose rendered name no longer matches the base
  fixture stem

## Common recipes

### Create a GitHub team

Start from `group-a`, `group-b`, or `group-c`.

Choose the base fixture like this:

- `group-a`: standalone team
- `group-b`: team with a parent link already modeled
- `group-c`: deeper parent chain

Typical patches:

- `/name`
- `/providers/github/name`
- `/members`: usually `[]` unless the test is explicitly about membership
- `/parent` when you want to link the team to another runtime-created group

Reference test:

- `packages/e2e/__tests__/github/group-render-apply.test.ts`

### Create a GitHub repository

Start from `component-a`.

In most cases, prefer `orgScript(...)` over rendering `component-a` directly.
It gives you a realistic group + component set and already follows the
dependency order used by the existing E2E suite.

If you render `component-a` directly, review these fields before applying:

- `/name`
- `/providers/github/name`
- `/owner`
- `/platformOwner`
- `/maintainedBy`
- `/system`
- GitHub-specific rules and OIDC override fields under `/providers/github/...`

Component claims can render more than one CR. Prefer
`applyAndWaitCrPaths(client, rendered.crPaths)` instead of applying only
`rendered.crPaths[0]`.

Reference tests:

- realistic multi-resource flow:
  `packages/e2e/__tests__/github/org-script-render-apply.test.ts`
- CRD upgrade path for org-script resources:
  `packages/e2e/__tests__/github/org-script-crd-upgrade.test.ts`

### Create a GitHub organization webhook

Start from `orgwebhook-a`.

Required setup:

- create a default owner group with `ensureDefaultGroup(client)`
- create a temporary Kubernetes `Secret` with `createTempOpaqueSecret(...)`
- patch the claim with the runtime owner ref, webhook URL, and secret ref
- usually remove `/system`
- pass `orgWebhookUrls` to `destroyFixtureResources(...)` so cleanup can find
  the runtime URL
- use `waitForOrgWebhookState(...)` if the test needs to verify the webhook
  exists in GitHub

Reference test:

- `packages/e2e/__tests__/github/org-webhook-render-apply.test.ts`

### Create a TFWorkspace

Start from `tfworkspace-a`.

Required setup:

- call `prepareProviderConfigManifests(resolveE2eProviderConfigsPath(),
  namespace)` in `beforeAll`
- apply the resulting `kubernetes-backend.yaml` and `kubernetes.yaml` provider
  configs before rendering the workspace CR
- patch any runtime Terraform values during render, for example
  `/providers/terraform/values/configmap_name`
- remove the temp directory in `afterAll` alongside
  `cleanupRenderedArtifacts(...)`

Important constraints:

- the base fixture must use `policy: full-control`
- `observe` only plans and never reaches `PROVISIONED`
- these tests do not require `GITHUB_APP_ID` or `GITHUB_APP_PEM_FILE`

Reference test:

- `packages/e2e/__tests__/terraform/tfworkspace-render-apply.test.ts`

### Link claims together

Use patches to replace reference fields from the base fixtures with
runtime-created names.

Common links:

- nested groups: `/parent`
- domain owner: `/owner`
- system to domain: `/domain`
- component to owner group: `/owner`
- component to platform owner group: `/platformOwner`
- component to system: `/system`

Build referenced names with `createNameBuilder(client.getPrefix())` so linked
resources follow the same E2E naming scheme.

Reference examples in the base claims:

- nested groups: `packages/e2e/fixtures/base_claims/groups/group_b.yaml`
- domain owner: `packages/e2e/fixtures/base_claims/domains/domain_a.yaml`
- system domain: `packages/e2e/fixtures/base_claims/systems/system_a.yaml`
- component ownership: `packages/e2e/fixtures/base_claims/components/component_a.yaml`

## Using patchContextFile

Use `client.claims.patchContextFile(...)` when a later render in the same test
must see an updated claim file in the shared render context.

Typical flow:

- render and apply a resource first
- read a derived value back from the cluster
- restart or patch the shared render context
- render a later claim that depends on that derived value

Important behavior:

- `restartContext()` reloads the original fixture files
- previous `renderLocally(...)` patches are not preserved across
  `restartContext()`
- if you restart the context, reapply the earlier base patches and then add the
  new derived field
- a common example is writing the resolved `providers/github/tfStateKey` back
  into the `firestartr` fixture
- prefer `ensureDefaultGroup(client)` unless you need this lower-level control

## Using orgScript

`orgScript(...)` is the easiest way to build a realistic set of fixtures for
groups and components.

It gives you:

- `script.fixtures`: render-ready fixtures in dependency order
- `script.claims`: the expected claim objects
- `script.monikers`: deterministic names for readable assertions

When to use it:

- you want a realistic repo/group graph instead of patching `component-a` by
  hand
- you need several related resources created in dependency order

Current limits:

- it currently generates fixtures only for groups and components
- the other category flags are accepted as exclude switches only

Important usage notes:

- if components are included but groups are excluded, create the default group
  first from `firestartr` and pass `defaultGroupRef`
- patch `orgScript` resources by claim name, not only by fixture name
- the `frontend` fixture may require `PREFAPP_BOT_PAT`

Reference tests:

- `packages/e2e/__tests__/github/org-script-render-apply.test.ts`
- `packages/e2e/__tests__/github/org-script-crd-upgrade.test.ts`

## Reference tests

The README intentionally keeps full working examples out of line. Use these
tests as the source of truth for end-to-end patterns:

- minimal single-CR render/apply:
  `packages/e2e/__tests__/github/group-render-apply.test.ts`
- org webhook flow with secret creation and GitHub verification:
  `packages/e2e/__tests__/github/org-webhook-render-apply.test.ts`
- orgScript flow with related groups and components:
  `packages/e2e/__tests__/github/org-script-render-apply.test.ts`
- orgScript CRD upgrade path:
  `packages/e2e/__tests__/github/org-script-crd-upgrade.test.ts`
- TFWorkspace render/apply flow with provider config setup:
  `packages/e2e/__tests__/terraform/tfworkspace-render-apply.test.ts`

## Not available yet

These claim types are not first-class E2E render targets yet:

- systems
- domains
- users / GitHub memberships

So, for now, do not write E2E tests that depend on creating those unsupported
claims through `client.claims.renderLocally(...)`.

Also, `orgScript(...)` currently generates fixtures only for groups and
components. Categories like `systems`, `domains`, `users`, `argocd`,
`orgWebhooks`, and `secrets` are accepted only as exclude flags for now.

## Recommended local workflow with dagger

For local runs, prefer the `dagger/etoe` dagger module instead of manually
exporting environment variables and invoking test commands yourself.

This is the better workflow because:

- the tests are expected to run against a kind cluster
- the dagger module accepts the kind cluster as an input
- the dagger module manages the test environment around that cluster for you

Before running the dagger module, make sure the Firestartr CRDs are applied to
your local kind cluster:

```bash
kubectl apply -f packages/k8s/src/crds/
```

The CRDs live in `packages/k8s/src/crds/`.

Then use the dagger module documented in `dagger/etoe/README.md`.

Treat the manual environment variables and direct `npm` commands below as the
lower-level path, mainly useful for debugging or iterating on one test once you
already have the cluster and credentials ready.

## Main APIs you will use

### `initE2e(org?, namespace?, options?)`

Creates the E2E client.

Useful options:

- `namePrefix`: deterministic naming prefix used as `<prefix>-e2e-...`
- `onlyFiles`: preload only the fixtures your test needs
- `fixturesBasePath`: override `packages/e2e/fixtures`
- `kubeconfig` / `kubeconfigContext`: override Kubernetes config

### `client.claims`

- `renderLocally(fixtureName, options?)`: render one fixture locally (for
  example `group-a`, `component-a`, `orgwebhook-a`, or `tfworkspace-a`)
- `patchContextFile(fixtureName, patches)`: patch a fixture already loaded in
  the shared context
- `restartContext()`: recreate the temporary render context
- `destroyContext()`: remove the context and render caches

### `client.k8s`

- `applyCr(crPath)`: apply one rendered CR
- `waitForCr(crPath, timeout?, status?)`: wait for reconciliation
- `deleteCr(crPath, timeout?)`: delete one rendered CR
- `applyCrds(version)`: apply released CRDs
- `applyInBranchCrds()`: apply CRDs from `packages/k8s/src/crds`
- `getGroupTfStateKey(claimName)`: useful with `firestartr` / `ensureDefaultGroup`

### Helpers exported by this package

Rendering and apply:

- `applyAndWaitCrPaths(client, crPaths)`
- `renderApplyAndWaitFixtures(client, fixtures, extraPatchesByClaimName)`

Cleanup:

- `destroyFixtureResources(client, prefix, fixtures, options?)`
- `cleanupRenderedArtifacts(client)`
- `CleanupRunner`

Specialized helpers:

- `createTempOpaqueSecret(client, options)`
- `waitForOrgWebhookState(client, url, exists, options?)`
- `prepareProviderConfigManifests(sourceDir, namespace)`: stamps provider
  config fixtures with the correct name and namespace; returns a temp dir
  containing the ready-to-apply YAML files
- `resolveE2eProviderConfigsPath()`: returns the absolute path to
  `packages/e2e/fixtures/provider_configs/`

## Environment

Run commands from the monorepo root.

### All Kubernetes-backed tests

```bash
export E2E_KUBECONFIG="/path/to/kubeconfig-or-kubeconfig-dir"
# optional
export E2E_KUBECONFIG_CONTEXT="your-context"
```

### GitHub-backed tests

```bash
export GITHUB_APP_ID="<app-id>"
export GITHUB_APP_PEM_FILE="/absolute/path/to/private-key.pem"
```

### TFWorkspace tests

These tests use provider config fixtures from:

```bash
packages/e2e/fixtures/provider_configs/
```

The default provider names used by the TFWorkspace path are:

```bash
export TF_BACKEND_PROVIDER_NAME="kubernetes-backend"
export TF_PROVIDER_NAME="kubernetes"
```

`GITHUB_APP_ID` and `GITHUB_APP_PEM_FILE` are not required for the
`terraform` suite.

### Component and orgScript feature downloads

Set this when the test path uses the `frontend` fixture or other component
features that fetch external archives:

```bash
export PREFAPP_BOT_PAT="<bot-pat>"
```

### Common defaults

```bash
export E2E_ORG="firestartr-e2e"
export E2E_NAMESPACE="firestartr-e2e-firestartr-pre"
export BACKEND_PROVIDER_NAME="tfstate-firestartr-e2e"
export GITHUB_PROVIDER_NAME="github-firestartr-e2e"
```

GitHub-specific variables are only required when you run GitHub-backed suites.

## Running tests

Run the full package test suite:

```bash
npm test --workspace packages/e2e
```

Run one Jest file while iterating:

```bash
npm test --workspace packages/e2e -- __tests__/github/group-render-apply.test.ts
```

Run the orchestrated GitHub suite:

```bash
npm run test-suites --workspace packages/e2e -- github
```

Run the orchestrated terraform suite:

```bash
npm run test-suites --workspace packages/e2e -- terraform
```

List suite directories:

```bash
npm run test-suites --workspace packages/e2e -- --list
```
## Troubleshooting

- `appId option is required`: export `GITHUB_APP_ID` and `GITHUB_APP_PEM_FILE`
- `Kubeconfig context '...' not found`: use a valid context from
  `kubectl config get-contexts`
- `CRD not found for ...`: install Firestartr CRDs in the target cluster first
- `orgScript requires options.defaultGroupRef ...`: call
  `ensureDefaultGroup(client)` and pass `defaultGroupRef`
- `GET /repos/prefapp/features/zipball/... 401`: export `PREFAPP_BOT_PAT`
- Kubernetes `401 Unauthorized`: refresh your cloud session and rerun the test
