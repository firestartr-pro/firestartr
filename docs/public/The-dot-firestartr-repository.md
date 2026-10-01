# 📄 Introduction

When using Firestartr, each client should have a repository called `.firestartr`, which should contain a variety of YAML files describing many different aspects of the client's repository, registry and application structures.

## 📁 Repo structure

The repo structure is as follows:

```shell
apps/
  ├─ app1.yaml     # app1 configuration YAML
  ├─ app2.yml      # app2 configuration YAML
docker_registries/
  ├─ releases.yaml       # releases registry configuration YAML
  ├─ snapshots.yaml      # snapshots registry configuration YAML
platforms/
  ├─ cluster1.yaml     # cluster1 configuration YAML
  └─ cluster2.yml      # cluster2 configuration YAML
providers/
  └─ [app-name]/
    └─ [claim-kind]/    # currently only the 'TFWorkspace' kind is supported
      └─ [tenant]/
        └─ [env]/
          └─ provider1.yaml
          └─ provider2.yaml
validations/
  └─ apps/
    └─ [app-name]/
      └─ [claim-kind]/    # currently only the 'TFWorkspace' kind is supported
        └─ validation1.yaml
        └─ validation2.yaml
  └─ policies/
    └─ policy1.rego
    └─ policy2.rego
```

A detailed explanation of each configuration file will be provided below.

- [App](#-app-configuration-example-and-field-description)
- [Registry](#-registry-configuration-example-and-field-description)
- [Platform](#-platform-configuration-example-and-field-description)
- [Provider](#-providers-configuration-example-and-field-description)
- [App validation](#-app-validation-configuration-example-and-field-description)
- [Policy](#-about-validation-policies)

### 🔧 App configuration example and field description

```yaml
name: app1
state_repo: "<your-org>/state-app-sample-app"
platforms: [cluster-name]
services:
  - repo: <your-org>/build-and-dispatch-images-react
    service_names: [micro-a, micro-b]
  - repo: <your-org>/another-build-and-dispatch-images-react
    platforms: [cluster-name-2]
    service_names: [micro-a, micro-b]
```

- **name**: the name of the application for which this configuration will be applied. This value is used in the `make_dispatches.yaml` file ([more info here](https://github.com/prefapp/features/blob/main/packages/build_and_dispatch_docker_images/templates/docs/README.md#make-dispatches))
- **state_repo**: the state repo related to the application (each application should have its own state repo).
- **platforms**: (optional) a list of platforms where this app is deployed. These platform names should match the ones defined in the platforms configuration files.
- **services**: a list of service objects. Each of them contains:
  1. **repo**: the repository where objects will be uploaded. If they are prefixed by whether they are a docker image or a helm chart, this field's value should be only the last part of the repo name (i.e., if images are prefixed with `service/` and a image is uploaded as `service/client/service-name`, this fields value should be `client/service-name`). See the [registry configuration files](#-registry-configuration-example-and-field-description) for more info on how to set the prefix.
  2. **platforms**: (optional) a list of platforms where this service is ALLOWED TO deploy. If not specified, it will be allowed to deploy to all platforms defined in the `platforms` field of this app configuration file. If the global field is also missing, it'll be treated the same as setting it as `[]`. These platform names should match the ones defined in the platforms configuration files. This field overrides the global `platforms` field, i.e. if this field is specified, the platforms defined in the global `platforms` field will be ignored for this service.
  3. **service_names**: names of the services allowed to be saved for this app. These service names are the ones that are later written to the `images.yaml` file.

### 🔧 Registry configuration example and field description

```yaml
name: snapshots # This is going to be used in the helmfile registry alias
registry: prefappacr.azurecr.io
image_types: [snapshots]
default: true
auth_strategy: azure_oidc
base_paths:
  services: "service"
  charts: "charts"
```

- **name**: a name for the registry, which will be used by some of our apps.
- **registry**: url to the registry where the objects will be uploaded to.
- **image_types**: a list of strings, which can be either "snapshots", "releases" or both. Specifies which type of images can be uploaded to this registry.
- **default**: when no registry is specified, use the one that has this field's value set to true. There shouldn't be multiple registries with this field set to true, but if there are, the first one found will be used.
- **auth_strategy**: type of authentication to use when login to the registry. Can be one of `azure_oidc` or `aws_oidc`
- **base_paths**: an object detailing the prefixes to use when uploading a service or chart to this registry. It has two properties:
  1. **services**: the prefix to use when uploading docker images (e.g. if this field's value is `service` and we upload to the `prefapp/application` repository, the final coordinate will be `service/prefapp/application`).
  2. **charts**: the prefix to use when uploading helm charts (e.g. if this field's value is `chart` and we upload to the `prefapp/deployment` repository, the final coordinate will be `chart/prefapp/deployment`).

### 🔧 Platform configuration example and field description

`kubernetes` platform example:

```yaml
type: kubernetes
name: cluster-name
tenants: [test-tenant]
envs: [dev, pre]
```

`tfworkspaces` platform example:

```yaml
type: tfworkspaces
name: my-cloud-account
tenants: [my-tenant]
envs: [dev, pre]
allowedClaims:
  - resourceTypes:
      - az-vmss
      - az-aks
    providers:
      - azure-predev-account
    backend: terraform-backend-azure
```

- **type**: describes the technology this platform uses. Allowed values are `kubernetes`, `tfworkspaces` or `vmss`.
- **name**: the name of this platform. This value is used in the `make_dispatches.yaml` file ([more info here](https://github.com/prefapp/features/blob/main/packages/build_and_dispatch_docker_images/templates/docs/README.md#make-dispatches)).
- **tenants**: A list of strings, used when this platform is set as a configuration value alongside one or multiple tenants for validation.
- **envs**: A list of strings, used when this platform is set as a configuration value alongside one or multiple environments for validation.
- **allowedClaims**: A list of objects describing which TFWorkspace claims are allowed to be deployed to this platform, and which providers and backends they should use. This field should only be set when `type: tfworkspaces`. Each object has the following fields:
  1. **resourceTypes**: a list of strings, each of which is the name of a resource type. Any TFWorkspace claims that have any of these values set as their `resourceType` will be allowed by this platform.
  2. **providers**: a list of strings, each of which is the name of a provider defined in the providers configuration files. If a claim uses one of these providers, it'll be allowed to be deployed to this platform.
  3. **backend**: a string describing the name of the backend configuration that should be used for claims matching this condition.

### 🔧 Providers configuration example and field description

```yaml
name: provider-my-tenant-dev
resourceTypes:
 - resourceType1
 - resourceType2
 ...
```

- **name**: the name of this provider.
- **resourceTypes**: A list of strings, each of which is the name of a resource type this provider applies to.

### 🔧 App validation configuration example and field description

```yaml
name: my-validation
description: "My validation description"
regoFile: path/to_the/rego_file.rego
applyTo: [condition list]
data:
  - key1: value1
  - key2: value2
  ...
```

- **name**: the name of the validation file, which must be unique between them.
- **description**: a brief description of what this validation does. Purely for human readability purpouses.
- **regoFile**: path to the rego file, relative to the policies folder (i.e., this field's value will be concatenated to `.firestartr/validations/policies` like so: `.firestartr/validations/policies/[this_fields_value]`)
- **applyTo**: a list of conditions which describe to which claims this validation applies to. For this, for each value in each element of the list, an AND operation is done with each other value of that element, then for each element an OR operation is done against each other element. See ["About the applyTo field values"](./Validating-our-claims.md#-about-the-applyto-field-values) to learn more about the possible values of this field.
- **data**: key-value pairs, where each key is a variable name and each name its value, to be used inside the `regoFile` file.

### 📢 About validation policies

These are regular `.rego` files and have no custom or special values. You can learn more about Rego [here](https://www.openpolicyagent.org/docs/latest/policy-language/)
