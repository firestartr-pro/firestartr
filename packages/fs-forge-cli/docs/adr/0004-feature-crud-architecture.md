# Feature CRUD — schema-driven flags from the latest Feature schema

Feature references live in a ComponentClaim, while their `args` contract lives in
the Feature source. The CLI therefore treats Feature-reference mutation and Feature-args
validation as separate concerns.

## Decisions

### 1. Always resolve the latest Feature schema

`features add`, `features edit`, and deep `validate` resolve the Feature name through
the source index and validate `args` against that Feature's latest published schema.
The reference's `version` or `ref` only controls what the claim pins; it does not select
the schema used by the CLI.

Schemas are cached locally by Feature name. `FS_FORGE_FEATURE_CACHE_DIR` overrides the
cache location and `--refresh` bypasses the cached value. `features list`, `features
remove`, `create --feature`, and general `edit` Feature flags do not access a Feature
source.

### 2. Dedicated CRUD plus unvalidated convenience flags

- `features add`, `features edit`, `features remove`, and `features list` operate on one
  Feature reference at a time. Add/edit expose fixed reference flags plus ephemeral
  `args.*` flags derived from the latest Feature schema.
- `create component --feature` and general `edit --add-feature`/`--remove-feature`
  mutate references without fetching a schema. Inline additions use
  `name@version:{...}` or `name#ref:{...}` and may be repeated.
- `validate` is the single command that combines structural claim validation with
  latest-schema validation of every attached Feature's args.

This preserves deterministic claim creation while retaining an explicit full-validation
path.

### 3. Mutate the Feature array by name

Dotted-path mutation continues to build nested Feature args. A separate, narrow
array-by-name primitive adds, replaces, or removes one reference without replacing
sibling references. Add rejects duplicate names; edit and remove reject missing names.

### 4. ComponentClaim targets only

Feature CRUD accepts either a bare component name resolved as
`ComponentClaim-<name>` or a local YAML file via `-f`. The loaded claim must identify as
a `ComponentClaim`. Publishing a local file computes its deterministic claims-repo path
and current SHA directly, without a claims-map lookup.
