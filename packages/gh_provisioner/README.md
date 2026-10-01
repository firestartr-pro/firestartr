# GitHub Entity Framework (gh-entity)

A **TypeScript-first** framework for declaratively managing GitHub organizations, repositories, teams, secrets, OIDC trust, branch protection, and more.

Built as a clean entity-based abstraction on top of Terraform/Tofu (via `tp_bridge`), it lets platform teams define GitHub resources as simple, reusable, strongly-typed **entities** instead of raw Terraform resources or repetitive YAML.

---

## Architecture Overview

### Conceptual architecture 
```
Kubernetes API server
          │
          ├─ Custom Resource Definitions (CRDs)
          │     │
          │     ├─ GitHubTeam
          │     ├─ GitHubRepository
          │     ├─ GitHubBranchProtection
          │     ├─ GitHubRepositoryEnvironment
          │     └─ ... (your own kinds)
          │
          ▼
gh-provisioner Operator / Controller
          │
          ├─ Watches for create/update/delete on those CRs
          │
          ├─ For each CR instance:
          │     ↓
          │   → Creates / finds corresponding Entity instance
          │     ↓
          │   → Entity.patchData() → produces JSON Patch operations
          │     ↓
          │   → tp_bridge collects → applies patches → builds final Terraform JSON document
          │     ↓
          │   → Executes terraform plan / apply (or OpenTofu)
          │        └─ against GitHub provider
          │
          └─ Updates CR .status (conditions, observedGeneration, errors, applied resources, drift detection…)

```

### Codebase
```
src/
├── entities/          # Core domain: every GitHub concept is an Entity
│   ├── base.ts        # Abstract Entity base class + registration
│   ├── cr.ts          # Custom Resource wrapper
│   ├── ghrepo/        # GitHub Repository + all its post-creation helpers
│   ├── group/
│   ├── ghrepositorysecretssection/
│   └── ghfeature/     # Feature flags applied to repos
├── refs/              # Reference resolution system (cross-entity linking)
├── terraform.ts       # Main Terraform/Pulumi bridge & stack builder
├── debug.ts           # Debugging utilities + gh-debug annotation
├── logger.ts
├── tp_bridge.ts       # Terraform Provider bridge / JSON emitter
└── index.ts           # Public API + entity registry
```

## GitHub Entity Framework  
Everything is driven by **entities** — small, focused classes that represent a single GitHub concept.


**Core idea — one sentence**

We **do not define** a big static structure.  
We start with almost nothing and let each **Entity** **progressively shape the final document** using **JSON Patch operations**.

The **only source of truth** is the sequence of `.patchData()` calls made by entities — nothing else.

```text
                 Initial document = {}  (or minimal base object)

                           │
                           ▼
             Entity A  →  .patchData()  →  add / replace / remove …
                           │
                           ▼
             Entity A.helper 1 →  .patchData()  →  add nested values, arrays…
                           │
                           ▼
             Entity A.helper 2  →  .patchData()  →  fix, override, extend…
                           │
                           ▼
           tp_bridge applies patches in deterministic order

                           │
                           ▼
             Final plain Terraform JSON document
             → terraform plan / apply / tofu apply
```

### Why this design?

| Property                              | Benefit                                                                 |
|---------------------------------------|-------------------------------------------------------------------------|
| No rigid upfront schema               | Easy to evolve GitHub provider schema without breaking old entities    |
| Patches are small & focused           | Easy to read, test, review, reorder                                     |
| Conflicts are explicit                | Two entities touching same path → visible in patch list                |
| Debug shows **exactly** what changed  | `gh-debug` prints patch operations + resulting document                 |
| Test like your example                | Start empty → apply patches → assert final shape                        |
| Works naturally with modules / locals / variables / outputs | Just patch into different document paths                                |


### The document gh-provisioner is intended to create

The final document produced by all entities is a plain Terraform JSON structure that consists primarily of module calls to the reusable modules in the tfm repository (see PR #953 for the canonical gh-team example).
Each module receives a clean, strongly-typed config object — exactly the shape defined in modules/gh-team/variables.tf:

```json
{
  "module": {
    "team_platform": {
      "source": "./modules/gh-team",
      "config": {
        "group": {
          "name": "platform-team",
          "description": "Managed by gh-provisioner",
          "privacy": "closed",
          "parentTeamId": null
        },
        "group_members": [
          { "username": "alice" },
          { "username": "bob" }
        ]
      }
    }
  }
}
```

### patchData() — the unbreakable contract

- This is the only place where configuration is produced.
- Never mutate shared objects directly.
- Always return JSON Patch operations.
- Prefer add when creating new module paths.
- Use test for guards when needed.
- The order of entity instantiation does not matter — patches are applied deterministically.

## TFM Module Selection for Entities

The `gh-provisioner` operator uses Terraform modules from the **TFM repository** to realize the desired state defined in Custom Resources (CRs).

There are **two ways** the operator decides which exact Terraform module (source + ref/version) to use for a given entity/CR:

### 1. General / Default Manner – centralized in `src/terraform.ts`

For the vast majority of cases, the mapping between a CR `kind` and the corresponding Terraform module is defined centrally in:

src/terraform.ts


This file contains a constant called `moduleMapping` (or similar), which serves as the **single source of truth** for production/default behavior.

Example:

```ts
// src/terraform.ts (excerpt)

const MODULES = {
  FirestartrGithubGroup: {
    module: 'git::https://github.com/prefapp/tfm.git//modules/gh-team',
    ref: 'feat/952-poc-gh-group',
  },
  FirestartrGithubRepositorySecretsSection: {
    module:
      'git::https://github.com/prefapp/tfm.git//modules/gh-repo-secrets-section',
    ref: 'feat/954-poc-gh-rss',
  },
};

```

### 2. Special / Override Manner – via CR annotation firestartr.dev/terraform-module

In some situations (temporary testing, emergency hotfix, PoC, gradual migration, using a fork, etc.) it is possible to override the default module source and reference per CR instance.
Use the annotation:

```yaml
# a particular gh CR
metadata:
  annotations:
    firestartr.dev/terraform-module: "git::https://github.com/<YOUR-ORG>/tfm.git//modules/gh-team?ref=my-feature-branch"
```

#### How it works internally

The entity (or a helper in tp_bridge / reconciliation logic) checks for the presence of the firestartr.dev/terraform-module annotation on the CR.
- If present → it takes precedence and the value is used directly as the source attribute in the generated module block.
- If absent → falls back to the value defined in src/terraform.ts for that kind.
- The ?ref= part is mandatory in the annotation (Terraform remote module syntax requirement).

#### When to use the annotation override

- Testing a new version / branch of a module before promoting it to production
- Using a temporary fork with urgent fixes
- Experimenting with community / third-party modules
- Gradual rollout of a major module version change

#### Important warnings

- Overrides are not recommended for long-term / production usage
- They bypass version pinning and central review
- They can lead to configuration drift between environments
- Use sparingly and clean up after testing / hotfix is merged

#### Best practice recommendation
Always prefer the central mapping in src/terraform.ts. <br>
Use the firestartr.dev/terraform-module annotation only as a short-lived escape hatch.


## Importing Existing Resources into Terraform State

The `gh-provisioner` supports **importing** already-existing GitHub resources (teams, repositories, secrets, etc.) into Terraform state without recreating them.

This is done entirely through **entities**, using two dedicated methods that produce special import patches. These patches are sent to `tp_bridge`, which generates Terraform `import` blocks and runs a custom import workflow.

### Why import?

- You already have resources in GitHub that were created manually or by another process.
- You want to bring them under `gh-provisioner` management without data loss.
- You need to migrate from manual management → declarative CRs.

### The `import` block in Terraform / OpenTofu

The **`import`** block in **Terraform** (and in **OpenTofu**, which is practically identical) is one of the most important improvements that arrived with **Terraform 1.5** (2023) and that OpenTofu inherited and continues to support.

Before version 1.5, the only way was using the command:

```bash
terraform import aws_s3_bucket.my_bucket existing-bucket-name
```

This command was quite inconvenient because:

- It was manual and difficult to version control
- You couldn't preview it with plan
- You could only import one resource at a time

The import block changed all of that dramatically.

### Key differences: import block vs terraform/tofu import (CLI)

| Feature                     | `terraform import` / `tofu import`          | `import { ... }` block                          |
|-----------------------------|---------------------------------------------|-------------------------------------------------|
| Declarative                 | No                                          | Yes (in code)                                   |
| Versioned in git            | No                                          | Yes                                             |
| Preview with plan           | No                                          | Yes                                             |
| Import multiple resources   | One per command                             | Many in parallel                                |
| Generate HCL configuration  | No                                          | Yes (`-generate-config-out`)                    |
| Repeatable / CI/CD friendly | Fair                                        | Excellent                                       |
| Available since             | Terraform 0.11+                             | Terraform 1.5+ / OpenTofu 1.6+                  |

### How it works – the two entity methods

Every entity that supports import **must** implement:

1. **`loadAddressesToImport()`** (abstract method)
   - Called only when the `import` command is used.
   - Responsible for discovering what should be imported (IDs, addresses, etc.).
   - Uses `patchImportData()` to populate the import document.

2. **`patchImportData(patch: PatchData)`**
   - Adds entries under the `/imports/` path in the import document.
   - Each entry tells Terraform **which resource address** to import and **from which ID** in GitHub.

These patches are **separate** from normal `patchData()` — they only affect the import phase.

### Example: GitHubTeamEntity import implementation

```ts
async loadAddressesToImport(): Promise<void> {
  // 1. Import the main team resource
  this.patchImportData({
    op: PatchOperations.add,
    path: '/imports/',
    value: {
      to:   'github_team.this',
      id:   `${this.cr.id}`,
    },
  });

  // 2. Import all group_members (Terraform treats them as separate resources)
  for (const member of this.cr.spec.config_group_members || []) {
    this.patchImportData({
      op: PatchOperations.add,
      path: '/imports/',
      value: {
        to:   `github_team_membership.members["${member.username}"]`,
        id:   `${member.username}:${this.cr.id}`,
      },
    });
  }
}

```

### Important notes

- Import is idempotent — running it multiple times is safe.
- You can combine normal management + import in the same entity.
- Only entities that implement loadAddressesToImport() participate in import.

This feature makes migration from existing GitHub resources to fully declarative gh-provisioner management smooth and safe.

## Triggering Imports with Annotations

Building on the entity-level import mechanisms (`loadAddressesToImport()` and `patchImportData()`) described in the previous section [Importing Existing Resources into Terraform State](#importing-existing-resources-into-terraform-state), the `gh-provisioner` controller activates imports declaratively through annotations on the Custom Resource. This keeps the entire process fully GitOps-friendly and visible in version control.

The controller supports **two distinct import flavors**:

### 1. Normal (Standard) Import

To bring existing GitHub resources under management, add only this annotation:

```yaml
metadata:
  annotations:
    firestartr.dev/import: "true"
``` 

#### What happens:

- The controller detects the annotation and calls loadAddressesToImport() on the matching entity.
- The entity generates import addresses via patchImportData().
- tp_bridge executes the Terraform/OpenTofu import workflow.

### 2. Force Re-Import (State Wipe + Import)

When the Terraform state is out of sync, corrupted, or resource addresses have changed (e.g. after a module refactor), combine both annotations:

```hcl
metadata:
  annotations:
    firestartr.dev/import: "true"
    firestartr.dev/needs-re-import: "true"
```

#### Two-phase procedure:

1. State Wipe Phase

For every address returned by loadAddressesToImport(), the controller runs:
```bash
tofu state rm <address>
``` 
This completely removes the resources from the state file.

2. Import Phase
Proceeds exactly as the normal import above.

### Comparison of Import Flavors

| Flavor            | Required Annotations                                      | State Action            | Typical Use Case                              | Destructive? |
|-------------------|-----------------------------------------------------------|-------------------------|-----------------------------------------------|--------------|
| Normal Import     | `firestartr.dev/import: "true"`                           | Import only             | First-time onboarding of existing resources   | No           |
| Force Re-Import   | `firestartr.dev/import: "true"`<br>`firestartr.dev/needs-re-import: "true"` | `state rm` → Import     | State drift, module changes, corruption       | Yes          |

### Important Warnings & Best Practices

- firestartr.dev/needs-re-import is destructive — it permanently removes resources from the Terraform state.
- Use the force re-import flavor only when the normal import is insufficient.
- These annotations work on any entity that implements the import methods from the previous section — no additional code changes required.
