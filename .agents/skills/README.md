# Skills

Repo-specific agent skills. Each `SKILL.md` is the source of truth. General
workflow skills come from [`prefapp/skills`](https://github.com/prefapp/skills).

| Skill | What it does |
|---|---|
| `cdk8s-renderer-validator` | Validate a `cdk8s_renderer` change: tests, renders, schemas, cluster dry-runs, flood tests. |
| `validate-claim-against-schema` | Validate a claim against its JSON Schema. |
| `gh-provisioner-entity-from-crd-tfm` | Implement a `gh_provisioner` entity from a CRD and a Terraform module. |
| `gh-provisioner-tfm-compatibility` | Check a `gh_provisioner` entity against a Terraform module's `config` contract. |
| `dependabot-smoke-test` | Test Dependabot PRs and recommend MERGE or DO NOT MERGE. |
| `deploy-snapshot-on-pre` | Deploy an operator snapshot of a branch to a pre org. |
| `publish-cli-snapshot-on-pre` | Publish a CLI snapshot of a branch and point a pre org at it. |
| `rollout-functionality` | Test a branch, issue or release end to end on a pre org. |
| `smoke-test-renderer` | Live smoke tests of GitHub claims on a pre org. |
| `smoke-test-tfworkspace` | Live smoke tests of TFWorkspace claims on a pre org. |
