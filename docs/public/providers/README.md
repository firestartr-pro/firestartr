# Claims providers

A **provider** in Firestartr is a namespace inside a claim's `providers` block.
A claim declares one or more providers, and each provider describes how Firestartr
should materialize that part of the claim:

```yaml
kind: ComponentClaim
name: component-a
owner: group:firestartr-team
providers:
  github:
    org: my-org
    name: component-a
    visibility: private
    branchStrategy:
      name: main
```

Providers are **claim-facing integrations**, not Terraform provider plugins. The
renderer turns each provider block into Kubernetes custom resources, and
dedicated controllers or provisioners reconcile those resources into the external
system (GitHub, OpenTofu state, External Secrets, the Backstage catalog).

## The four providers

| Provider | Claim key | What it manages |
| --- | --- | --- |
| [GitHub](./github/README.md) | `github` | Your GitHub organization: repositories, teams, memberships, organization settings, Actions variables, organization webhooks, and repository secrets. |
| [Terraform](./terraform/README.md) | `terraform` | OpenTofu workspaces: modules, values, state, provider/backend configuration, policy, and synchronization. |
| [External Secrets](./external_secrets/README.md) | `external_secrets` | `ExternalSecret` (pull) and `PushSecret` (push) resources that reference an existing `SecretStore` or `ClusterSecretStore`. |
| [Catalog](./catalog/README.md) | *(implicit)* | Most claims are also projected into the Backstage catalog — no provider block required (`OrgSettingsClaim` is the exception). |

> **Other provider keys.** The `argocd` key is also real: `ArgoDeployClaim` uses
> `providers.argocd` and the renderer emits an `argoproj.io/v1alpha1`
> `Application`. It is outside the four-provider model documented here (Argo CD
> itself and its credentials are configured externally), so it has no dedicated
> page.

## A note on `terraform` and OpenTofu

The provider is called `terraform`, and the claim key is **always**
`providers.terraform`. Under the hood, Firestartr executes
[OpenTofu](https://opentofu.org/) (the `tofu` binary), not HashiCorp Terraform.
Modules, providers, backends, and state are OpenTofu-compatible. Throughout this
documentation, "Terraform workspace" names the claim and custom-resource
concepts, while "OpenTofu" is used where the runtime binary matters.

## How claims relate to providers

- A claim's `providers` object may contain more than one provider key (for
  example `github` and `external_secrets`).
- The renderer can be run for a single provider (for example `--provider github`)
  or for all of them (`--provider all`); catalog output is generated in both the
  `catalog` and `all` modes.
- A provider block is usually paired with an explicit `FirestartrProviderConfig`
  reference (Terraform) or prerequisite secrets/store. See each provider page for
  its dependencies.
