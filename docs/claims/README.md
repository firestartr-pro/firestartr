# The firestartr renderer

## Claims Documentation

For comprehensive documentation of all claim types, see the dedicated [Claims Documentation](./claims/README.md).

The claims directory contains detailed documentation for each claim type including:
- Complete schema definitions
- Real-world examples
- Use cases and best practices
- Validation rules
- Provider-specific details
- Integration patterns

## Quick Reference - Claims definitions and schemas

> **Note**: This section provides a quick reference. For complete documentation, see [docs/claims/](./claims/README.md).

### Component

```yaml
kind: (Required) string; What kind of object you want to create.
name: (Required) string; The name of the claim.
description: (Optional) string; A description of the claim.
type: (Required) string;
version: (Required) string;
lifecycle: (Required) string;
system: (Required) system:string;
owner: (Required) string:string;
platformOwner: (Optional) string:string;
maintainedBy: (Optional) string:string[];
annotations: (Optional) [string]: string;
subComponentOf: (Optional) string:string;
profile: (Optional)
  displayName: (Optional) string;
  email: (Optional) string;
  picture: (Optional) string;
providers: (Required)
  github:
    name: (Required) string; The name of the repository.
    # description: (Required) string; A description of the repository.
    org: (Required) string; The organization's name of the repository.
    visibility: (Required) string; Defines the visibility of the repository. It can be "public", "private" or "internal".
    # defaultBranch: (Required) string; The name of the default branch of the repository.
    # orgVisibility: (Required) boolean; If It's true, the group formed by all members of the org can see the repository.
    # orgContributions: (Required) boolean; If It's true, the group formed by all members of the org can write to the repository.
    # technology: (Required) IComponentClaimTechnology;
    #   stack: (Required) string;
    #   version|ref: (Required) string;
    #   args: (Optional) [string]: string
    #   repo: (Optional) string/string;
    # branchStrategy: (Required) string; It can be "none", "trunkBasedDevelopment", "gitflow" or "custom".
    # allowSquashMerge: (Required) boolean; Set to false to disable squash merges on the repository.
    # allowMergeCommit: (Required) boolean; Set to false to disable merge commits on the repository.
    # allowRebaseMerge: (Required) boolean; Set to false to disable rebase merges on the repository.
    # allowAutoMerge: (Required) boolean; Set to true to allow auto-merging pull requests on the repository.
    # deleteBranchOnMerge: (Required) boolean; Automatically delete head branch after a pull request is merged.
    # autoInit: (Required) boolean; Set to true to produce an initial commit in the repository.
    # archiveOnDestroy: (Required) boolean; Set to true to archive the repository instead of deleting on destroy.
    # allowUpdateBranch: (Required) boolean; Set to true to always suggest updating pull request branches.
    # hasIssues: (Required) boolean; Set to true to enable the GitHub Issues features on the repository.
    # pages: (Required) IRepositoryPage;
    #   cname: (Required) string;
    #   source:
    #     branch: (Required) string;
    #     path: (Required) string;
    # actions: (Required) IComponentClaimActions;
    #   oidc:
    #     useDefault: (Required) boolean;
    #     includeClaimKeys: (Required) string[];
    features: (Required) IClaimInstalledFeature[];
      - name: (Required) string;
        version: (Required) string;
        args: (Optional) string:string[];
```


### Group

```yaml
kind: (Required) string; What kind of object you want to create.
name: (Required) string; The name of the claim.
description: (Optional) string; A description of the claim. 
type: (Optional) string; It can be "business-unit" or "team"
version: (Optional) string;
annotations: (Optional) [string]: string;
profile: (Optional)
  displayName: (Optional) string;
  email: (Optional) string;
  picture:  (Optional) string;
parent: (Optional) string;
members:  (Required) string[];
children: (Optional) string[];
providers: (Required)
  github:
    name: (Required) string;
    description: (Optional) string;
    org: (Required) string;
    privacy: (Required) string; It can be "closed" or "secret".

```

### User

```yaml
kind: (Required) string; What kind of object you want to create.
name: (Required) string; The name of the claim.
description: (Optional) string; A description of the claim.
type: (Optional) string;
version: (Required) string;
annotations: (Optional) [string]: string;
# displayName: (Required) string;
# memberOf: (Optional) string[];
profile: (Required) IUserClaimProfile
  displayName: (Required) string;
  email: (Required) string;
  picture: (Required) string;
providers: (Required)
  github:
    name: (Required) string;
    org: (Required) string;
    role: (Required) string; It can be "admin" or "member".

```

### System

```yaml
kind: (Required) string; What kind of object you want to create.
version: (Required) string;
name: (Required) string; The name of the claim.
description: (Required) string; A description of the claim.
owner: (Optional) string:string;
domain: (Required) string;
annotations: (Optional) [string]: string;
providers: (Required) # defined by default
  catalog:
```

### Domain

```yaml
kind: (Required) string; What kind of object you want to create.
version: (Required) string;
name: (Required) string; The name of the claim.
description: (Required) string; A description of the claim.
owner: (Required) string:string;
annotations: (Optional) [string]: string;
provider: (Required) # defined by default
  catalog:
```

### TFWorkspace

```yaml
kind: (Required) string; What kind of object you want to create.
name: (Required) string; The name of the claim.
description: (Optional) string; A description of the claim.
type: (Optional) string;
version: (Required) string;
owner: (Required) string;
system: (Optional) string;
lifecycle: (Optional) string;
annotations: (Optional) [string]:string;
profile: (Optional)
  displayName: (Optional) string;
  email: (Optional) string;
  picture: (Optional) string;
providers: (Required)
  terraform:
    name: (Required) string;
    source: (Required) string; It can be "remote", "inline", "Remote" or "Inline"
    values: (Required) {}
    context: (Required)
      providers: (Required) []
        name: (Required) string;
      backend: (Required)
        name: (Required) string;
    module: (Required) string;
    valuesSchema: (Optional) string; A locator for a json schema to validate values.
    policy: (Optional) string; It can be "apply", "create-only", "create-update-only", "full-control", "observe" or "observe-only"
    sync: (Optional)
      enabled: (Required) boolean;
      period: (Optional) string. It must comply with the pattern "^[0-9]+[smhd]$"
      policy: (Optional) string; It can be "apply" or "observe".
    tfStateKey: (Optional) string;
```

## Complete Claims Documentation

For detailed documentation of all claim types including ArgoDeployClaim, SecretsClaim, and OrgWebhookClaim, visit the comprehensive [Claims Documentation](./claims/README.md).

The dedicated claims documentation provides:
- Complete schema definitions for all 9 claim types
- Detailed examples and use cases
- Best practices and validation rules
- Provider-specific configuration details
- Integration patterns and troubleshooting guides

