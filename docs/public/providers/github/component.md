# ComponentClaim (GitHub repository)

A `ComponentClaim` provisions a GitHub repository and related configuration. The
same claim also feeds the Backstage catalog (see [Catalog](/docs/providers/catalog/)).

Rendered resources:

- `FirestartrGithubRepository` — the repository and most of its settings.
- `FirestartrGithubRepositorySecretsSection` — Actions/Codespaces/Dependabot
  repository secrets. Always rendered, even when empty.
- `FirestartrGithubRepositoryFeature` — one per entry in `features`.

Default modules: `github-repo`, `github-repo-secrets-section`, `github-files-set`.

## Example

```yaml
kind: ComponentClaim
name: component_a
type: service
lifecycle: production
system: "system:system_a"
owner: "group:group_a"
maintainedBy: ["group:group_c"]
platformOwner: "group:group_b"
providers:
  github:
    org: firestartr-test
    name: component_a
    description: "Example service repository"
    visibility: private
    orgPermissions: none
    hasWiki: true
    branchStrategy:
      name: trunkBasedDevelopment
      defaultBranch: main
    topics:
      - service-a
      - backend
    labels:
      - name: bug
        color: d73a4a
        description: Something isn't working
    vars:
      actions:
        - name: ENVIRONMENT
          value: production
    secrets:
      actions:
        - name: DEPLOY_TOKEN
          value: "ref:secretsclaim:deploy_secrets:github_token"
    features:
      - name: ci
        version: v1.2.0
        repo: prefapp/ci-templates
    pages:
      buildType: legacy
      source:
        branch: main
        path: /
```

## Claim-level fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Catalog component name. |
| `type` | No | Component type. |
| `lifecycle` | No | Catalog lifecycle. |
| `owner` | Yes | Owner reference (`group:`, `user:`, …). Becomes a repository `admin`. |
| `system` | No | System reference. |
| `maintainedBy` | No | List of owner references; each becomes a repository `maintain` permission. |
| `platformOwner` | No | Owner reference; becomes a repository `admin`. |
| `subComponentOf` | No | Parent component reference. |
| `providesApis` / `consumesApis` | No | Catalog API definitions/relations. |
| `providers.github` | No | GitHub repository configuration (below). The schema requires the `providers` object, not the `github` key, but GitHub resources render only when it is present. |

## `providers.github` fields

### Identity and branch strategy

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | GitHub repository name (operational/external name). |
| `org` | Yes | GitHub organization. |
| `visibility` | Yes | `private`, `public`, or `internal`. |
| `branchStrategy` | Yes | `name` (required) selects a branch-strategy global; optional `defaultBranch`. |
| `defaultBranch` | No | Default branch (used when the strategy is `none`/`custom`). |
| `description` | No | Repository description. |
| `orgPermissions` | No | `none`, `view`, or `contribute` grants the org's `<org>-all` team `pull`/`maintain` access. |
| `tfStateKey` | No | Explicit UUID state key. |
| `sync` | No | Scheduled reconciliation. |

Branch protections are not declared inline: the `branchStrategy.name` selects a
repository-wide strategy global, and `custom`/`none` fall back to the claim or the
previous CR. See [Notes](#notes).

### Repository options

`archiveOnDestroy`, `allowMergeCommit`, `allowSquashMerge`, `allowRebaseMerge`,
`allowAutoMerge`, `deleteBranchOnMerge`, `autoInit`, `allowUpdateBranch`,
`hasIssues`, `hasWiki`, `hasDiscussions`, `topics[]`, and `technology.{stack,version}`.

### Files, labels, and variables

| Field | Description |
| --- | --- |
| `labels[]` | `name`, `color` (6 hex chars, no `#`), optional `description` (max 100 chars). |
| `additionalRules[]` | Accepted by the schema but **not rendered**; add CODEOWNERS rules through `overrides.additionalCodeownersRules` (below) instead. |
| `vars.actions[]` | Repository Actions variables: `name` and a literal `value`, or `value: "ref:secretsclaim:<claim>:<key>"`. |
| `secrets.actions[]`, `secrets.codespaces[]`, `secrets.dependabot[]` | Repository secrets: `name` and `value: "ref:secretsclaim:<claim>:<key>"`. |

### Features

| Field | Required | Description |
| --- | --- | --- |
| `name` | Yes | Feature name. |
| `version` | One of | Published version of the feature. |
| `ref` | One of | Git ref (commit/tag/branch). Mutually exclusive with `version`. |
| `repo` | No | Source repo, `owner/repository`. |
| `args` | No | Arbitrary arguments for the feature. |

Exactly one of `version` or `ref` must be provided.

### Pages

`pages` supports `cname`, `public`, `https_enforced`, `buildType`
(`workflow`|`legacy`), and `source.{branch,path}` (`path` is `/` or `/docs`).

### `overrides`

`overrides` tweaks the rendered `FirestartrGithubRepository` beyond the
first-class claim fields:

- `overrides.spec` is a raw patch merged into the rendered CR `spec` — the escape
  hatch for fields not exposed directly, for example branch protections.
- `overrides.additionalAdmins`, `overrides.additionalMaintainers`,
  `overrides.additionalWriters`, and `overrides.additionalReaders` add
extra repository permissions.
- `overrides.additionalCodeownersRules` adds CODEOWNERS entries.

```yaml
providers:
  github:
    overrides:
      spec:
        branchProtections:
          - branch: main
            requiredReviewersCount: 1
      additionalMaintainers:
        - "group:group_b"
```

## Rendered resources

### `FirestartrGithubRepository`

- `metadata.name`: normalized `providers.github.name` with the state key
  appended (`<name>-<tfStateKey>`).
- `spec.org`, `spec.repo.*` (options, default branch, CODEOWNERS, additional
  branches, labels, topics), `spec.actions.oidc`, `spec.permissions`,
  `spec.vars`, `spec.pages`, `spec.branchProtections`.
- A write connection Secret with outputs `id`, `nodeId`, `fullName`, `htmlUrl`,
  `sshCloneUrl`, and `primaryLanguage`.

### `FirestartrGithubRepositorySecretsSection`

- Named after the repository CR (`<repository-name>-<tfStateKey>`) and
  owner-referenced to it; the `-secrets-section` suffix appears only as the
  cdk8s construct id.
- References the repository, resolves each `ref:secretsclaim:...` to a Kubernetes
  Secret, encrypts the plaintext with GitHub's public key, and stores ciphertext
  plus a SHA-256 digest per section.

### `FirestartrGithubRepositoryFeature`

- Inherits `claim-ref`, `revision`, `sync-enabled`, and `sync-period` annotations
  from the repository.
- Carries `firestartr.dev/external-name`, `feature-name`, and, when set,
  `feature-git-sha`, `feature-git-tags`, `feature-url`, `feature-ref`, and
  `feature-repo`.
- Files may be marked `userManaged: true`, which provisions them once and then
  leaves later manual edits intact.

## Imports and apply-time adoption

- `github_repository.this`, `github_branch_default.this`, the OIDC template,
  declared branch protections, Actions variables, and Pages — all by repository
  name (or `<repo>:<branch>`/`<repo>:<variable>`).
- Repository **labels** are adopted during `apply` when they already exist; the
  claim's color/description wins over drift.
- **Files, teams, and collaborators are not imported.**
- `features` uses migration-specific import semantics for user-managed files.

## Post-provision

After a successful `apply`, `additionalBranches` are created directly through the
GitHub API: existing branches are skipped, and a missing branch is created as an
orphan or copied from the default branch.

## Notes

- **Branch strategy resolution.** `branchStrategy.name` must match a configured
  strategy global unless it is `none` or `custom`. A missing strategy fails
  rendering. `none` clears branch protections; `custom` keeps the previous CR's
  protections.
- **Pages validation.** `https_enforced: true` requires `cname`. For a new repo,
  a Pages source branch must equal the default branch; for an existing repo it
  must already exist upstream (a 404 becomes an error). Validation is skipped for
  `destroy`/`plan-destroy`.
- **Label adoption is not read-only.** Existing labels can be updated on GitHub
  during resource loading, not only during apply.
- **Feature content is inline base64.** Feature file content lives in the CR; the
  controller reads existing repository content through the GitHub Contents API
  for user-managed files.
- **Additional-branch failures are logged, not fatal.** Provisioning can succeed
  while an additional branch is missing.
