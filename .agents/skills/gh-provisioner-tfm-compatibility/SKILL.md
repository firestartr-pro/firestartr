---
name: gh-provisioner-tfm-compatibility
description: Check whether a gh_provisioner entity's config document matches a Terraform module's variable "config" contract. Use when adding or changing gh_provisioner entities, updating module refs in packages/gh_provisioner/src/terraform.ts, or investigating mismatched variables between gh_provisioner and prefapp/tfm modules.
---

# gh_provisioner ↔ TFM compatibility

Compare one entity with one module. Map a CR kind to its entity through
`src/entities/index.ts`; if no module is given, use the one pinned in
`src/terraform.ts`.

## First pass

```sh
python3 .agents/skills/gh-provisioner-tfm-compatibility/scripts/analyze_tfm_entity_compatibility.py \
  --repo-root . --entity <entity> --tfm <module> --ref <full-commit-sha>
```

`--tfm` accepts a `prefapp/tfm` module name, a `git::` source or a local path.
The script only clones `https://github.com/prefapp/tfm.git` at a full commit
SHA. Clone anything else (or a branch or tag) yourself, record its commit, and
pass the local path. It outputs `status: compatible` when it finds no obvious
mismatch, which is not proof.

## Manual review

Follow every `patchData` in `loadResources` and its helpers, plus constructor
defaults, against `variable "config"` and every `var.config` use in the module,
its locals and nested modules. Look closely at:

- `any`, loose maps, `lookup`, `try`, locals and nested modules: needs review
  unless the path is clearly accepted;
- `/-` paths (list appends) and template paths (`/config/x/${name}`, meaning
  map keys);
- `optional(...)` and Terraform defaults, which may make an unpatched key safe;
- `patchImportData` and `postProvision`, which say nothing about config
  compatibility.

Validate with at least one compatible and one incompatible case.

## Report

- Verdict: `compatible`, `incompatible` or `needs-review`.
- Entity, module and commit.
- **Incompatible variables:** paths the entity emits that the module doesn't
  accept, or that it names differently.
- **Ignored variables:** required or crucial module keys the entity never
  fills.
- Source locations for every path, the edge cases reviewed, the validation
  commands and results, and anything inferred instead of proven.
