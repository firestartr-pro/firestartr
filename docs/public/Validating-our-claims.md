1. Go to the `.firestartr` repository and create the `validations` folder structure. More info [here](./The-dot-firestartr-repository.md)
2. Inside the `validations/policies` folder, create the policy as a `.rego` file. You can learn more about Rego [here](https://www.openpolicyagent.org/docs/latest/policy-language/)
3. Inside the `apps/[app-name]/[claim-kind]` folder create a YAML file as follows:

```yaml
name: my-validation
description: "My validation description"
regoFile: path/to_the/rego_file.rego
applyTo:
  - app: sample-app
data:
  data1: test-data1
  data2: test-data2
  ...
```

Description of each field:

- **name**: the name of the validation file, which must be unique between them.
- **description**: a brief description of what this validation does. Purely for human readability purpouses.
- **regoFile**: path to the rego file, relative to the policies folder (i.e., this field's value will be concatenated to `.firestartr/validations/policies` like so: `.firestartr/validations/policies/[this_fields_value]`)
- **applyTo**: a list of conditions which describe to which claims this validation applies to. For this, for each value in each element of the list, an AND operation is done with each other value of that element, then for each element an OR operation is done against each other element. See ["About the applyTo field values"](#-about-the-applyto-field-values) to learn more about the possible values of this field.
- **data**: key-value pairs, where each key is a variable name and each name its value, to be used inside the `regoFile` file.

# ❗ About the applyTo field values

Each element of the `applyTo` field can have the following values:

- *App*: apply only to claims who will deploy to exactly the `app` with this value as its name
- *Name*: apply only to the claim with this value as its name (no two claims can have the same name as each other)
- *Kind*: apply only to the claims with this value as their kind
- *ResourceType*: apply only to the claims with this value as their ResourceType
- *Environment*: apply only to claims who will deploy to exactly the `env` with this value as its name
- *Tenant*: apply only to claims who will deploy to exactly the `tenant` with this value as its name
- *Platform*: apply only to claims who will deploy to exactly the `platform` with this value as its name

### ‼️ Example of the applyTo field criteria

```yaml
...
applyTo:
  - app: app1
    kind: TFWorkspace
    env: dev
  - platform: kubernetes
    app: app2
    env: pre
  - name: my-claim-1
```

will be converted to:

`(app == app1 && kind == TFWorkspace && env == dev) || (platform == kubernetes && app == app2 && env == pre) || (name == my-claim-1)`

which means "Apply this validation to:

the claim which deploys to the application `app1` AND the environment `dev` AND has the kind `TFWorkspace` 

OR

the claim which deploys to the platform `kubernetes` AND the application `app2` AND the environment `pre`

OR

the claim with the name `my-claim-1`"

### 🧪 Test your validations quickly

1. Create your data rule
```yaml
# my-data-rule.yaml
---
name: "prefix-test-app"
description: "Prefix all claim names with test- in test app"
regoFile: claim_prefix_name.rego
applyTo:
  - app: test
data:
  prefixName: test-
``` 
2. Create your policy `.rego`
```rego
package main

deny contains msg if {
    not startswith(input.name, data.data.prefixName)
    msg := sprintf("Claim name must start with '%v', but got: '%v'", [data.data.prefixName, input.name])
}
```
3. Create the claim
```yaml
# claim.yaml
---
kind: TFWorkspaceClaim
lifecycle: production
name: test-tenant-pre-vmss
resourceType: az-vmss
system: "system:test"
version: "1.0"
providers:
  terraform:
    tfStateKey: e951e631-305a-414e-be4f-5562fc952122
    policy: apply
    name: test-tenant-pre-vmss
    source: remote
    module: git::https://github.com/test/tfm.git//modules/vmss-demo?ref=vmss-demo-v0.3.5
    values:
      common:
        resource_group_name: "tenant-test-pre"
        location: "westeurope"
      vmss:
        name: "tenant-demo-pre"
        sku: "Standard_D2as_v5"
        instances: 1
```
3. Run docker command
```shell
echo "
---
name: \"prefix-test-app\"
description: \"Prefix all claim names with test- in test app\"
regoFile: claim_prefix_name.rego
applyTo:
  - app: test
data:
  prefixName: test-
" > my-data-rule.yaml &&

echo '
package main

deny contains msg if {
    not startswith(input.name, data.data.prefixName)
    msg := sprintf("Claim name must start with '\''%v'\'', but got: '\''%v'\''", [data.data.prefixName, input.name])
}
' > claim_prefix_name.rego &&

echo '
---
kind: TFWorkspaceClaim
lifecycle: production
name: test-tenant-pre-vmss
resourceType: az-vmss
system: "system:test"
version: "1.0"
providers:
  terraform:
    tfStateKey: e951e631-305a-414e-be4f-5562fc952122
    policy: apply
    name: test-tenant-pre-vmss
    source: remote
    module: git::https://github.com/test/tfm.git//modules/vmss-demo?ref=vmss-demo-v0.3.5
    values:
      common:
        resource_group_name: "tenant-test-pre"
        location: "westeurope"
      vmss:
        name: "tenant-demo-pre"
        sku: "Standard_D2as_v5"
        instances: 1
' > claim.yaml &&

docker run --rm \
  -v $(pwd)/claim_prefix_name.rego:/validation/claim_prefix_name.rego \
  -v $(pwd)/my-data-rule.yaml:/validation/my-data-rule.yaml \
  -v $(pwd)/claim.yaml:/validation/claim.yaml \
  -w /validation \
  openpolicyagent/conftest \
  --rego-version v1 --output stdout test claim.yaml --data my-data-rule.yaml --policy claim_prefix_name.rego
```
