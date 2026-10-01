# Migrating from the old cdktf system to the gh-provisioner operator

If you are moving existing GitHub resources from the previous **cdktf-based** flow to the new `gh-provisioner` operator, use a **state re-import migration**.

## Why migration is required

- The Terraform state layout used by `gh-provisioner` is not compatible with the old cdktf state.
- Because of that incompatibility, resources must be migrated through a controlled re-import process.

## 0. CRs state

⚠ It is crucial that all the CRs to be migrated are in the PROVISIONED state. If a GitHub CR is in the ERROR state, the re-import process may leave the CR in an unexpected state.

## 1. Version updates required

First, you need to make the following updates:

- Update your claims_repo to the last available version (see [CHANGELOG](https://docs.firestartr.dev/docs/features/claims_repo/CHANGELOG/)).
- Update the organization variable `FIRESTARTR_CLI_VERSION` with the cli version >= 2.x.
- Run validate claims action inside the claims repo.
- Update the firestartr image to the `gh_provisioner` version (version >= 2.x) by updating it in the repo `app-firestartr` and set the replicas to 0 (value ```controller.replicaCount = 0```).


## 2. Migration workflow (`reimport`)

A dedicated `reimport` workflow has been added at the `claim_repo` feature level. It is called `Reimport Github resources`. 

- It accepts the same kind of filters used by the import workflow.
- It does not create new resources. It starts from existing CRs and adds these two annotations:

```yaml
metadata:
  annotations:
    firestartr.dev/import: "true"
    firestartr.dev/needs-re-import: "true"
    firestartr.dev/reconcile-at: "<ISO DATE>"  # ex. 2026-04-21T07:17:06Z
```

- The workflow opens a single PR in `state-github` containing the annotation updates.
- Check in argocd that everything is updated for the state-github.

For each annotated CR, the operator will execute:

1. **State wipe**: remove current Terraform state addresses.
2. **Re-import**: import the existing GitHub resources back into state using entity import addresses.


## 3. Reimporting orgwebhooks

The migration workflow does not automatically update orgwebhooks. Thus, you need to manually add the annotations to their CRs:

```yaml
metadata:
  annotations:
    firestartr.dev/import: "true"
    firestartr.dev/needs-re-import: "true"
    firestartr.dev/reconcile-at: <copy from other CR to reimport in the same PR>
```

Important! it should be in the same PR

That will tell the operator that those resources need to be re-imported as well.

## 4. Set the replicas of the operator to 1
- Update the `firestartr-<env>/app-firestartr` deploy and set `replicaCount = 1`


## 5. Finish migration

You need to remove the annotations once the reimport is finished. For this, you need to:

### 1. All the resources have been effectively re-imported

Check that all the resources are reimported. You can verify that there aren't any pending actions in the file /tmp/queue of the controller.

### 2. PR revert
- Revert the reimport PR so all the annotations are removed. 
- Merge it. 

### 3. Await for the resources to be updated
