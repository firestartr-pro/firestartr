# Build and dispatch workflows

## Overview

This feature builds and publishes Docker images from release, pre-release, and snapshot sources, then automatically dispatches the resulting image updates to their corresponding state repositories.

This feature is a collection of seven workflows (along with their configuration files), which when used in conjunction allow a user to build final docker images from a release tag, or snapshot images, from a pre-release tag, or commit SHA; Once the images are built, the `make_dispatches` workflow dispatches the image update automatically to their respective state repositories. They can be thought of as two different but closely related features.

The workflows `trigger_dispatch_on_releases.yaml`, `trigger_dispatch_on_pre-releases.yaml` and `trigger_dispatch_on_snapshot.yaml` only serve to trigger `make_dispatches.yaml` after a successful automated call to any of the `build_docker_<type>.yaml` workflows. They require no other explanation so they won't be discussed in this README

## Build images

Composed of the workflows `.github/workflows/build_docker_releases.yaml`, `.github/workflows/build_docker_pre-releases.yaml` and `.github/workflows/build_docker_snapshots.yaml`.

### Configuration

All build workflows use the same configuration file located at `.github/build_images.yaml`. Its format is as follows:

```yaml
snapshots: # Configuration specific for snapshots, used by build_docker_pre-releases and build_docker_snapshots
  flavor: # Flavor-specific configuration. A flavor can be named anything as long as it's a valid YAML key
    dockerfile: path/to/dockerfile # Path relative to the repo root folder
    auto: false # Whether or not to automatically build this flavor when the * input is specified (see "Inputs" below). Defaults to false
    build_args: # Environment variables to set during the image building process
      #  ENV_VARIABLE_NAME: env_variable_value
      API_URL: https://api.com/url
      UI_COLOR: "#125690"
    secrets: # Secrets to be set during the image building process
      DB_PASSWORD: "arn:aws:ssm:region:account:parameter/dev/my-db-pass"  # Amazon SSM Parameter Store ARN
      DB_USERNAME: "https://my-vault.vault.azure.net/secrets/my-db-username"  # Azure Key Vault URL
    extra_registries: # List of registries, other than the default one (see "Defaults" below), where to upload the image
      - name: registry.azure.io
        repository: service/repo
        auth_strategy: azure_oidc
      # Multiple kinds of registries can be specified
      - name: aws.amazon.com
        repository: programs/program-name # Repository names can be different between registries
        auth_strategy: aws_oidc # Multiple auth strategies should be supported but they currently aren't
    extra_tags: # List of extra tags to publish the image as
      - latest
      - stable
    platforms: # List of platforms for which to build the image. If unspecified, the image will be built for linux/amd64 only
      # Only linux/amd64 and linux/arm64 are currently supported
      - linux/amd64
      - linux/arm64

  another-flavor:
    dockerfile: path/to/dockerfile
    registry: # The default registry can be overridden (see "Defaults" below)
      name: nondefault.registry.es
      repository: nondefault/repo
      auth_strategy: azure_oidc # Can be any of the supported auth strategies, not just azure_oidc, with the corresponding required variables for each strategy (see "Cloud provider setup to access Docker registries and secret managers" below)

releases: # Configuration specific for releases, used by build_docker_releases
  release-flavor: ... # The same configuration parameters as snapshots can be used here
```

- `snapshots`: all image flavors included within this key will count as a snapshot flavor, and thus will be built when the `build_docker_snapshots` or `build_docker_pre-releases` workflows are executed
- `releases`: all image flavors included within this key will count as a release flavor, and thus will be built when the `build_docker_releases` workflow is executed

Inside each of these two keys (`type` keys) there will be one or more flavor keys:

- `<flavor>`: the name of the flavor to build. Will be appended to the end of the final image tag. The same flavor name cannot be duplicated inside the same `type` key, but it can be in both `type` keys at the same time (i.e. `snapshots` cannot contain two `default` flavor keys, but both `snapshots` and `releases` can contain a single `default` key at the same time)

Each flavor key can contain:

- `dockerfile`: path to the dockerfile to use when building this image, relative to the repo root (i.e. if the dockerfile is located at `https://www.github.com/firestartr-test/code-repo/docker/Dockerfile`, this keys' value will be `docker/Dockerfile`)
- `auto`: whether or not to build this flavor when the [`flavors` input](#inputs) equals \*. [Defaults to false](#defaults)
- `build_args`: key-value pairs that are set as environment variables when building the image. The key is the environment value name, and the value its value, and any number of them can be specified.
- `registry`: a [`registry` object](#registry-objects) that overrides the [default registry](#defaults). If this key is specified, **_no image will be uploaded to the [default registry](#defaults)_**
- `extra_registries`: a list of [`registry` object](#registry-objects) to where the image will be uploaded to, in addition to the [default registry](#defaults). If this key is specified, **_the image will still be uploaded to the [default registry](#defaults)_**
- `extra_tags`: optional list of strings representing extra tags to publish the image as. While the default tag is constructed as `<flavor>_<version>`, no extra info will be appended to these tags. E.g. if the flavor is `default` and the version is `v1.2.3`, the default tag will be `default_v1.2.3`, and if `latest` is specified as an extra tag, the image will also be tagged as `latest`. For this reason, all values listed as `extra_tags` must be unique across all flavors and types (i.e., two different flavors cannot both have `latest` as an extra tag, even if one is a snapshot and the other a release)
- `platforms`: optional list of strings representing platforms for which to build the image. If unspecified, the image will be built for `linux/amd64` only. Currently, only `linux/amd64` and `linux/arm64` are supported. If specified, the image will be built only for the platform(s) listed.
- `secrets`: optional key-value pairs specifying secrets to pass to the Docker build process. The values are resolved at runtime depending on their format (see [Build secrets](#build-secrets))

Configuration variables (both optional):

| Variable                            | Description                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUILD_DOCKER_IMAGES_AMD64_RUNS_ON` | Specifies the runner version that the images for `linux/amd64` will be built on, in [the format supported by the GitHub runs-on setting](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow). If unset, it'll default to the feature argument `RUNNER_VERSION` |
| `BUILD_DOCKER_IMAGES_ARM64_RUNS_ON` | Specifies the runner version that the images for `linux/arm64` will be built on, in [the format supported by the GitHub runs-on setting](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow). If unset, images for this platform won't be built                |

### Registry objects

A registry object contains the following keys:

- `name`: base URL of the registry. E.g. when uploading a image to `registry.com/image_repo/image_tag`, this key's value should be `registry.com`
- `repository`: name of the repository inside of the registry `name` to where upload the image to. E.g. when uploading a image to `registry.com/image_repo/image_tag`, this key's value should be `image_repo`
- `auth_strategy`: type of authentication to use for login, as different registries require different authentication methods. Currently `azure_oidc`, `aws_oidc`, `ghcr`, `dockerhub` and `generic` are supported. The first two use OIDC to authenticate, and thus require no credentials stored in GitHub secrets, but a set of vars to identify the integration. The last three require credentials stored in GitHub secrets. The `generic` strategy can be used to authenticate to any registry using credentials, but it requires manually logging in using the `DOCKER_REGISTRY_<TYPE>_CREDS` secrets (see [Cloud provider setup to access Docker registries and secret managers](#cloud-provider-setup-to-access-docker-registries-and-secret-managers) for more info on this)

### Inputs

All build workflows share the following inputs:

- `from`: point of the code history from which the image will be built. Can be a short or long commit SHA, a branch name or a tag name
- `flavors`: which flavors to build. Each workflow will only look for flavors in their respective section (i.e., build_docker_releases will only build flavors from `releases`, while the other two will only build flavors from `snapshots`). Can be a single flavor, a list of comma separated flavors (spaces are trimmed) or \*. \* builds all flavors that are set as auto in `build_images.yaml` (see [Configuration](#configuration))
- `dereference_enabled`: boolean input that enables dereference of tags when building images. Defaults to `true` in `build_docker_snapshots.yaml` workflow and to the value of the `prereleases_dereference_enabled` feature arg (default: `true`) in `build_docker_pre-releases.yaml` workflow.

> [!WARNING]
> Disabling pre-releases dereference (arg `prereleases_dereference_enabled: false`) may cause image tags to be overwritten if your snapshots/pre-releases and releases images are uploaded to the same registry. Keep the `DOCKER_REGISTRY_SNAPSHOTS` and `DOCKER_REGISTRY_RELEASES` vars pointing at separate registries when enabling this parameter.

`build_docker_snapshots.yaml` also includes this workflow-dispatch-only input:

- `autodeploy`: boolean input (default: `false`) used by `build_docker_snapshots.yaml` when launched manually (`workflow_dispatch`). When `true`, the downstream `trigger_dispatch_on_snapshot` workflow will continue and trigger `make_dispatches.yaml`; when `false`, the trigger workflow skips the dispatch step.

### Defaults

All build workflows use the same defaults. There are two types of defaults: environment variables and defaults defined by code. The environment variables are:

- `DOCKER_REGISTRY_RELEASES`: base URL of the Docker registry for releases. Follows the same format as `extra_registries.name` and `registry.name` (e.g. `prefapp.azureacr.io`. See [Configuration](#configuration))
- `DOCKER_REGISTRY_SNAPSHOTS`: base URL of the Docker registry for snapshots. Follows the same format as `extra_registries.name` and `registry.name` (e.g. `prefapp.azureacr.io`. See [Configuration](#configuration))

The defaults defined by code are:

- `registry.repository` defaults to the name of the repo the workflow is being executed on, including the owner. E.g. `prefapp/test-repo-rundagger`
- `flavor.auto` defaults to `false`

### Cloud provider setup to access Docker registries and secret managers

The build workflows authenticate against external container registries and secret managers via [OpenID Connect (OIDC)](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect). The `auth_strategy` feature argument determines which cloud provider is used. Two providers are currently supported: **Azure** and **AWS**.

Both providers share a set of common [GitHub repository variables](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/store-information-in-variables) and [secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions) that must always be configured regardless of the chosen strategy:

**Common variables (always required):**

| Variable                       | Description                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOCKER_REGISTRY_SNAPSHOTS`    | Base URL of the Docker registry for snapshot images (e.g. `prefapp.azurecr.io`)                                                              |
| `DOCKER_REGISTRY_RELEASES`     | Base URL of the Docker registry for release images (e.g. `prefapp.azurecr.io`)                                                               |
| `DOCKER_REGISTRIES_BASE_PATHS` | JSON string mapping image types to service paths. E.g. `{"services":{"releases":"","snapshots":""},"charts":{"releases":"","snapshots":""}}` |
| `FS_CHECKS_APP_ID`             | GitHub App ID used to create check run summaries                                                                                             |

**Common secrets (always required):**

| Secret                         | Description                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `FS_CHECKS_PEM_FILE`           | PEM private key for the GitHub App used in check run management                                                                     |
| `GITHUB_DOCKER_REGISTRY_CREDS` | _(optional)_ Credentials for authenticating against the GitHub Docker registry. Falls back to the default `GITHUB_TOKEN` if not set |

#### Azure (`azure_oidc`)

When `auth_strategy` is set to `azure_oidc`, the workflows use [Azure OIDC federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation) to authenticate against Azure Container Registry (ACR) and Azure Key Vault without storing long-lived credentials.

**Prerequisites in your Azure account:**

1. Register an App Registration (service principal) in Microsoft Entra ID.
2. Configure a federated credential for the GitHub OIDC provider on that App Registration, scoping it to the repository (or organization) that runs the workflows.
3. Grant the service principal the necessary role assignments:
   - **ACR push/pull**: e.g. `AcrPush` on the Azure Container Registry resource, so the workflow can push built images.
   - **Key Vault read** _(only if using Azure Key Vault secrets)_: e.g. `Key Vault Secrets User` on the Key Vault resource, so the workflow can fetch secrets at build time.

**Required GitHub variables:**

| Variable                | Description                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`       | Client ID of the App Registration (service principal). Its presence also acts as a conditional to enable the Azure login step |
| `AZURE_TENANT_ID`       | Microsoft Entra ID (Azure AD) tenant ID                                                                                       |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID that contains the ACR and Key Vault resources                                                           |

**Build secrets from Azure Key Vault:**

Flavors can reference secrets stored in Azure Key Vault via the `secrets` key. Values matching an Azure Key Vault URL are automatically fetched at build time:

```yaml
snapshots:
  my-flavor:
    dockerfile: Dockerfile
    secrets:
      MAVEN_USERNAME: "https://my-vault.vault.azure.net/secrets/maven-username"
      MAVEN_PASSWORD: "https://my-vault.vault.azure.net/secrets/maven-password"
```

#### AWS (`aws_oidc`)

When `auth_strategy` is set to `aws_oidc`, the workflows use [GitHub's OIDC provider with AWS IAM](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) to assume an IAM role and authenticate against Amazon Elastic Container Registry (ECR) and AWS Systems Manager (SSM) Parameter Store without storing long-lived credentials.

**Prerequisites in your AWS account:**

1. Create an IAM OIDC identity provider for `token.actions.githubusercontent.com`.
2. Create an IAM role with a trust policy that allows the GitHub OIDC provider to assume it, scoped to the repository (or organization) that runs the workflows.
3. Attach the necessary policies to the role:
   - **ECR push/pull**: e.g. `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` on the ECR repository resource, so the workflow can push built images.
   - **SSM Parameter Store read** _(only if using SSM secrets)_: e.g. `ssm:GetParameter` on the parameter resources, so the workflow can fetch secrets at build time.

<details>
<summary><b>Full IAM role example</b></summary>

**Trust policy** — allows GitHub Actions to assume the role via OIDC, scoped to a specific repository:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:my-org/*:*"
        }
      }
    }
  ]
}
```

**Inline policy — ECR push** — grants the minimum permissions to authenticate and push images:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuth",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRPush",
      "Effect": "Allow",
      "Action": [
        "ecr:UploadLayerPart",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:GetDownloadUrlForLayer",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages",
        "ecr:CompleteLayerUpload",
        "ecr:BatchGetImage",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:eu-west-1:123456789012:repository/*"
    }
  ]
}
```

**Inline policy — SSM read** _(only if using SSM secrets)_ — grants read access to the parameters used as build secrets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SSMRead",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParametersByPath",
        "ssm:GetParameters",
        "ssm:GetParameterHistory",
        "ssm:GetParameter",
        "ssm:DescribeDocumentParameters"
      ],
      "Resource": "arn:aws:ssm:eu-west-1:123456789012:parameter/*"
    }
  ]
}
```

</details>

**Required GitHub variables:**

| Variable            | Description                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWS_OIDC_ECR_ROLE` | ARN of the IAM role to assume via OIDC (e.g. `arn:aws:iam::123456789012:role/github-ecr-role`). Its presence also acts as a conditional to enable the AWS login step |
| `AWS_REGION`        | AWS region where the ECR registry and SSM parameters are located (e.g. `eu-west-1`)                                                                                  |

**Build secrets from AWS SSM Parameter Store:**

Flavors can reference secrets stored in AWS SSM Parameter Store via the `secrets` key. Values matching an SSM Parameter Store ARN are automatically fetched at build time:

```yaml
snapshots:
  my-flavor:
    dockerfile: Dockerfile
    secrets:
      MAVEN_USERNAME: "arn:aws:ssm:eu-west-1:123456789012:parameter/maven/username"
      MAVEN_PASSWORD: "arn:aws:ssm:eu-west-1:123456789012:parameter/maven/password"
```

#### DockerHub or other credential-based registries

If the target registry does not support OIDC authentication (e.g. DockerHub, a self-hosted registry, or any registry that requires username/password credentials), the workflows can authenticate using static credentials stored as GitHub secrets:

| Secret                            | Description                                                          |
| --------------------------------- | -------------------------------------------------------------------- |
| `DOCKER_REGISTRY_SNAPSHOTS_CREDS` | Credentials for authenticating against the snapshots Docker registry |
| `DOCKER_REGISTRY_RELEASES_CREDS`  | Credentials for authenticating against the releases Docker registry  |

These secrets are passed to the build workflow and used during the registry login step. They are independent of the OIDC-based providers described above and can be used alongside them when pushing to multiple registries (e.g. pushing to both ACR via OIDC and DockerHub via credentials using `extra_registries`).

#### How build secrets work

The `secrets` key in the `build_images.yaml` flavor configuration allows passing secrets to the Docker build process. Currently, the following mechanisms for injecting secrets are supported:

**1. Vault-resolved secrets via the `secrets` key**

Each flavor can specify a `secrets` key with key-value pairs. The secret values are resolved **at runtime** by a provider factory that auto-detects the backend based on the value format:

| Value format                | Provider               | Example                                                  |
| --------------------------- | ---------------------- | -------------------------------------------------------- |
| Azure Key Vault URL         | `AzureKeyVaultManager` | `https://my-vault.vault.azure.net/secrets/my-secret`     |
| AWS SSM Parameter Store ARN | `AwsSecretsManager`    | `arn:aws:ssm:eu-west-1:123456789012:parameter/my/secret` |
| Any other string            | `GenericSecretManager` | Plain value, used as-is                                  |

These resolved secrets are passed to the Docker build as [Dagger secrets](https://docs.dagger.io/api/reference/#definition-Secret), which can be consumed in the Dockerfile via `--mount=type=secret`. For example:

```dockerfile
RUN --mount=type=secret,id=MAVEN_USERNAME \
    --mount=type=secret,id=MAVEN_PASSWORD \
    export MAVEN_USERNAME=$(cat /run/secrets/MAVEN_USERNAME) && \
    export MAVEN_PASSWORD=$(cat /run/secrets/MAVEN_PASSWORD) && \
    mvn package
```

### About GitHub secrets & vars

The `build_docker_(snapshots, pre-releases, releases)` workflows all use the `build_images_reusable` workflow, which supports sending additional secrets and variables to the Dagger module. This is done by setting the `build_images_vars` and `build_images_secrets` feature parameters, as explained in the [Feature arguments](#feature-arguments) section below.
Additionally, the workflow sets the `environment` job parameter, which can be either `snapshots` or `releases`, depending on the type of image that's being built (`snapshots` for non-production images, `releases` for production). This means that for a variable or secret, to be used, it must either:

- Be defined at the organization or repository level (i.e. not tied to any environment)
- Be defined within the `snapshots` environment, when using the `build_docker_snapshots` or `build_docker_pre-releases` workflows
- Be defined within the `releases` environment, when using the `build_docker_releases` workflow

The same variable or secret can be defined in multiple of these scopes, with the value defined within either environment having precedence over variables defined at the organization or repository level. You can read more about workflow environments and their variables and secrets [in the GitHub documentation](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments).

> [!NOTE]
> Note that, apart from GitHub secrets and vars, in these fields you can also
> define text variables and references to secrets in the AWS Parameter Store or
> Azure Keyvault, which will be available in all image builds of all flavors
> defined in your `.github/build_images.yml`.

> [!WARNING]
> Avoid defining secrets and references to secrets within the `build_image_vars` field, as they can end up populated in your Docker image layers.
> Always use the `build_image_secrets` field to provide secrets, which will use [Dagger's secure mechanism](https://docs.dagger.io/extending/secrets/?sdk=System+shell)
> to provide them to the build process without the risk of them being exfiltrated into the final image.
## Make dispatches

Composed of the workflow `.github/workflows/make_dispatches.yaml`.

### Configuration

The `make_dispatches` workflow uses the configuration file located at `.github/make_dispatches.yaml`. Its format is as follows:

```yaml
deployments:  # Has a list of configurations
  - tenant: prefapp
    platform: az-cluster  # Platform where we want to dispatch changes to
    type: snapshots  # Either snapshots, releases or any
    flavor: flavor1  # Flavor to dispatch for this deployment. Must have the same name as a flavor defined in build_images.yaml, under the chosen type (see "Build images -> Configuration" above)
    version: $branch_dev  # See "About the version field" below
    registry: prefapp.azureacr.io  # Optional. Registry where the image was uploaded to (see "Defaults" below)
    image_repository: service/test-repo  # Optional. Repo where the image was uploaded to (see "Defaults" below)

    base_path: apps  # Can be left empty or unspecified
    application: test-repo-rundagger
    env: dev

    # You can specify one of the following
    service_names: ['test-repo-service']  # List, multiple services can be specified
    # OR
    image_keys: ['/test-repo-service/image']  # List, multiple image keys can be specified

    # So, in this example github.com/prefapp/prefapp-state/apps/<platform-type>/az-cluster/prefapp/test-repo-rundagger/dev would be updated when making this dispatch

  # An entry is created for each tenant - platform - type - flavor combination we want to dispatch
  - tenant: prefapp
    platform: az-cluster
    type: snapshots
    flavor: another-flavor
    ...

  - tenant: prefapp
    platform: aks-cluster
    type: snapshots
    flavor: flavor1
    ...
```

- `deployments`: contains the list of deployments to dispatch. Has no special data or meaning but must be specified for the dispatch workflow to work

Each deployment contains:

- `tenant`: name of the tenant that will be used for this deployment. Used to determine which file to update when dispatching, and also for validation: the tenant must be specified in the list of valid tenants in the platform configuration of the `.firestartr` repo
- `platform`: name of the platform that will be used for this deployment. Used to determine which file to update when dispatching, and also for validation: the specified platform must have an associated configuration file. From the platform configuration file, its `type` will also be used when determining which file to update.
- `type`: deployment type, can be one of `snapshots`, `releases`, or `any`. Used when calling the dispatch workflow to filter which dispatches to make. `any` is a value for this deployment configuration field and means this deployment can be dispatched with both `snapshots` and `releases` type images. When using workflow inputs to build or dispatch both image types, use `image_type: '*'`, not `any`. More about how it works [here](#about-the-any-image-type).
- `flavor`: name of the flavor that will be used for this deployment. Used to compose the image tag, which will be written to the corresponding deployment files and must have been built beforehand.
- `version`: version of the code used in the image. Used to compose the image tag, which will be written to the corresponding deployment manifests and must have been built beforehand. See [About the version field](#about-the-version-field) for more info on the possible values this parameter could have.
- `registry`: registry to where the image has been uploaded to. This parameter is optional, and the registry specified in either the `DOCKER_REGISTRY_RELEASES` and `DOCKER_REGISTRY_SNAPSHOTS` variables will be used by default (see [Defaults](#defaults-1)).
- `image_repository`: repository to where the image has been uploaded to. This parameter is optional, and the repository specified in the application configuration will be used by default.
- `base_path`: legacy parameter. Appends this value to the deployment path, so that the final result ends like: `<base_path>/<platform-type>/<platform>/<tenant>/<env>`. Should only be used when dispatching to an old state repository.
- `application`: name of the application that will be dispatched. Used for validation, as a valid configuration must exist for the application, and to get the default state and image repo.
- `env`: environment where to deploy to. Could technically be any string, but usually is one of `dev`, `pre` or `pro`. Must be a value included in the `registry` configuration file.
- `service_names`: names of the services this deployment will be dispatched to. These values will be validated against the application configuration in the `.firestartr` repo: each value of this field must be included within the `service_names` of the current repository for this deployment's application. Cannot be used at the same time as the `image_keys` parameter.
- `image_keys`: list of JSONPatch paths to patch the deployment YAMLs. These values aren't validated against any configuration file. Cannot be used at the same time as the `service_names` parameter.

### Workflow inputs

- `image_type`: which types of images to build. Can be `releases`, `snapshots` (default) or `*` (both)
- `flavors`: which flavors to dispatch. Will only look for flavors inside `image_type`. Can be a single flavor, a list of comma separated flavors (spaces are trimmed) or `*`. `*` builds all flavors that are set as auto in `build_images.yaml` (see [Build Images -> Configuration](#configuration))
- `overwrite_version`: instead of using `version`, the value of this input will be used for each `image_type` and `flavors` if specified. Can be any of the valid `make_dispatches.yaml` configuration keywords (see [About the version field](#about-the-version-field))
- `overwrite_tenant`: instead of using `tenant`, the value of this input will be used for each `image_type` and `flavors` if specified.
- `overwrite_env`: instead of using `env`, the value of this input will be used for each `image_type` and `flavors` if specified.
- `filter_by_tenant`: only dispatch to the `tenant` specified by this input. These tenants must already have an entry in `make_dispatches.yaml` for `image_type` and `flavors` (i.e. this filter won't do anything if the `flavors` of `image_type` could not be dispatched to `filter_by_tenant` to begin with). Can be a single tenant, a list of comma separated tenants (spaces are trimmed) or `*` (all tenants for a given `image_type` and `flavors`)
- `filter_by_env`: only dispatch to the `env` specified by this input. These envs must already have an entry in `make_dispatches.yaml` for `image_type` and `flavors` (i.e. this filter won't do anything if the `flavors` of `image_type` could not be dispatched to `filter_by_env` to begin with). Can be a single env, a list of comma separated envs (spaces are trimmed) or `*` (all envs for a given `image_type` and `flavors`)
- `filter_by_platform`: only dispatch to the `platform` specified by this input. These platforms must already have an entry in `make_dispatches.yaml` for `image_type` and `flavors` (i.e. this filter won't do anything if the `flavors` of `image_type` could not be dispatched to `filter_by_platform` to begin with). Can be a single platform, a list of comma separated platforms (spaces are trimmed) or `*` (all platforms for a given `image_type` and `flavors`)
- `workflow_run_id`: the workflow needs the build summary of the last `build_docker_<type>`. If you have access to it, you can give it as an input here. If left blank, it will be automatically calculated by the workflow

### Defaults

The defaults are defined as environment variables and are:

- `DOCKER_REGISTRY_RELEASES`: base URL of the Docker registry for releases. Follows the same format as `extra_registries.name` and `registry.name` (e.g. `prefapp.azureacr.io`. See [Build Images -> Configuration](#configuration))
- `DOCKER_REGISTRY_SNAPSHOTS`: base URL of the Docker registry for snapshots. Follows the same format as `extra_registries.name` and `registry.name` (e.g. `prefapp.azureacr.io`. See [Build Images -> Configuration](#configuration))

### About the `any` image type

When a deployment configuration has `type: any`, it means that this deployment can be dispatched with both `snapshots` and `releases` type images. However, in addition to this value, users may want to set either the `registry` or `image_repository` fields, or both, to be more specific about which image to dispatch. This restricts the build summary filtering process to select only entries with the specified `registry` and/or `image_repository`. If neither `registry` or `image_repository` are set, all of `image_type`, `registry` and `image_repository` will be ignored. This means that images will efectively be filtered by `flavor` and `version` only, and if two or more build summary entries have the same `flavor` and `version`, the first one will be selected. The `registry` and `image_repository` values of the chosen build summary entry will be used for the dispatch in this case.

### About the `version` field

Specifies which image to dispatch. Can have any of the following values:

- `$latest_release`: the latest available release
- `$latest_prerelease`: the latest available prerelease
- `$branch_<branch_name>`: the latest available image associated to `<branch_name>`
- Any commit SHA (both short and long) or tag: the latest available image associated to the input

### About the `Trigger deployment` workflow

A second workflow, `Trigger deployment` (with filename `trigger_deployment.yaml`), is also included. This is a simplified version of the more complex `make_dispatches` workflow, and is meant to be used by users who want to trigger simple deployments, to a specific `tenant`, `platform` and `env`. Its inputs are:

- `flavor`: which flavor to dispatch. Contrary to the normal `make_dispatches` workflow, only a single flavor can be specified here, and it will also dictate the `image_type` (i.e., if the flavor exists in `snapshots`, the image type will be `snapshots`, and the same for `releases`. If it exists in both, `*` will be used). Defaults to `default`
- `version`: equivalent to the `overwrite_version` input of the normal `make_dispatches` workflow, with one notable difference: if the value is left empty, `$latest_release` will be used
- `tenant`: equivalent to the `filter_by_tenant` input of the normal `make_dispatches` workflow. Mandatory
- `platform`: equivalent to the `filter_by_platform` input of the normal `make_dispatches` workflow. Mandatory
- `env`: equivalent to the `filter_by_env` input of the normal `make_dispatches` workflow. Mandatory

Valid `tenant`, `platform` and `env` values are determined by the existing deployment configurations in `make_dispatches.yaml`, so only combinations of these three parameters that already exist in the configuration file can be used to trigger deployments.

## Feature arguments

The following feature arguments control behavior and defaults for the build and dispatch workflows.

| Argument | Description | Default |
| --- | --- | --- |
| `build_snapshots_branch` | Branch that triggers automatic snapshot builds on push. Taken from the claim's `providers.github.branchStrategy.defaultBranch` when not specified. | repository default branch (e.g. `main` or `master`) |
| `auth_strategy` | Authentication strategy for logging into Docker registries. Determines provider-specific steps (Azure, AWS, GHCR, etc.). | `azure_oidc` |
| `build_snapshots_filter` | Filter applied when automatically building snapshot images. | empty string (no filter) |
| `build_pre_releases_filter` | Filter applied when automatically building pre-release images. | empty string (no filter) |
| `build_releases_filter` | Filter applied when automatically building release images. | empty string (no filter) |
| `default_snapshots_flavors_filter` | Default flavors filter shown in the UI for manual snapshot builds. | `*` |
| `default_pre_releases_flavors_filter` | Default flavors filter shown in the UI for manual pre-release builds. | `*` |
| `default_releases_flavors_filter` | Default flavors filter shown in the UI for manual release builds. | `*` |
| `firestartr_config_repo` | Repository that contains the `.firestartr` configuration used by `make_dispatches` (apps/platforms/registries). | `${{ github.repository_owner }}/.firestartr` |
| `make_dispatches_config_file_path` | Path to the `make_dispatches` configuration file (relative to repo root). | `.github/make_dispatches.yaml` |
| `apps_folder_path` | Local path on the runner to the `apps` folder after config repos are downloaded. | `.firestartr/apps` |
| `platform_folder_path` | Local path on the runner to the `platforms` folder after config repos are downloaded. | `.firestartr/platforms` |
| `registries_folder_path` | Local path on the runner to the `docker_registries` folder after config repos are downloaded. | `.firestartr/docker_registries` |
| `trigger_filter_by_env_snapshot` | Value passed as `filter_by_env` to `make_dispatches.yaml` when triggered automatically after a snapshot build. | `dev` |
| `trigger_filter_by_env_pre_releases` | Value passed as `filter_by_env` to `make_dispatches.yaml` when triggered automatically after a pre-release build. | `pre` |
| `trigger_filter_by_env_releases` | Value passed as `filter_by_env` to `make_dispatches.yaml` when triggered automatically after a release build. | `pro` |
| `skip_commit_types` | Comma-separated list of conventional commit type prefixes to ignore on `push` events for `build_docker_snapshots`. If ALL commits in a push match one of these types the build is skipped. Only applies to `push` events; `workflow_dispatch` and `pull_request` always build. Wrapped in try/catch so failures default to building. | `ci,docs,build,chore,test` |
| `push_paths_ignore` | List of path patterns (GitHub Actions `paths-ignore` format) to exclude from triggering `build_docker_snapshots` on `push` events. Rendered directly under `paths-ignore`. | `.github/**`, `docs/**` |
| `build_images_vars` | Array of TOML-formatted vars and plain text values passed to the Dagger module as the `additional_build_args` input in the `build_images_reusable` workflow call. | none |
| `build_images_secrets` | Array of TOML-formatted secret (both GitHub secrets and external secrets) values passed to the Dagger module as the `secrets` input in the `build_images_reusable` workflow call. | none |

Example of `build_images_vars` and `build_images_secrets` usage:

```yaml
...
args:
  ...
  build_images_vars:
    - value1="my value"
    - value2="${{ vars.MY_VAR }}"
  build_images_secrets:
    - MY_SECRET_1="${{ secrets.GITHUB_SECRET_1 }}"

    # For secrets whose value contains more than one line of text, use """
    - MY_SECRET_2="""${{ secrets.GITHUB_SECRET_2 }}"""

    # AWS Parameter Store ARN
    - MY_SECRET_3="arn:aws:ssm:region:account:parameter/dev/my-postgres-pass"
```

Please note that `vars` and `secrets` referenced in both the `build_images_vars` and `build_images_secrets` arguments are subject to the environment set for the `build_images_reusable` workflow by the `build_docker_<type>` workflows, as explained in the [About workflow environments](#about-workflow-environments) section of the documentation.

**NOTE**: `make_dispatches` downloads the `firestartr_config_repo` repository to access the configuration files via the `apps_folder_path`, `platform_folder_path` and `registries_folder_path` feature arguments. However, `firestartr_config_repo` is always downloaded under the `.firestartr` folder, regardless of what the actual name of the repository is, so the paths specified in the `*_folder_path` arguments should all start with `.firestartr/` (unless the folders are located in another repo)
