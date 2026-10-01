# gh_provisioner — Package Rules

- Every CR kind is an entity in `src/entities/<name>/` that extends `Entity`
  and is registered in `src/entities/index.ts`. No provisioning, transformation
  or GitHub API logic outside entities; the `src/` root is infrastructure only.
- An entity's document is a single `config` object, which is the input of its
  Terraform module. A module without a `config` input is incompatible: reject
  the request instead of writing code.
- For new entities, module ref updates or compatibility questions, use the
  `gh-provisioner-tfm-compatibility` skill and report both incompatible
  variables and ignored required TFM variables.
- Keep logic in the entity class. Extract to `<entity>/helpers/` (re-exported
  from `helpers/index.ts`) only when complexity demands it; helpers are never
  shared between entities. Shared logic goes in the `Entity` base class or
  `src/utils/`.
- Post-provision side effects go in `postProvision` (a no-op when unused), or
  in `<entity>/post/` when complex.
- Entities never touch the file system or network directly; use
  `runWithGithubProvider`, `refResolver` and `patchData`.
