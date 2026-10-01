# Move feature patches from CR tier to claim stitching

## Status

Accepted — implements #2648

## Context

Features patched rendered CRs via `FeaturesOverrider` (`isPostPatch: true`) in the post-render patch pipeline (`src/overriders/featureOverride.ts:160`, `src/renderer/patches-extractor.ts:38`, `src/charts/github/featureRenderer.ts:4`). This was wrong for four reasons:

1. **Wrong surface.** The claim is the user-authored surface; the CR is an internal artefact the user never writes. Features are user-selected extensions of user intent and belong on the claim.
2. **No validation gate.** CR patches bypassed AJV. Fields injected by a feature were never validated; the claim schema is the single quality gate.
3. **No fan-out.** A feature patching one CR had to know which CRs a claim produces. Patching the claim gives all rendered CRs for free via the normal chart pipeline.
4. **Unlimited blast radius.** CR patching gave features write access to operator-managed fields (`tfStateKey`, `revision`, finalizers, `metadata.name`). Claim patching limits features to the user-writable surface.

Alternatives considered: keep CR patching with an allow-list of CR paths, or a transition window accepting both `patches` shapes. Both keep the blast radius and the bypass.

Audited `prefapp/features` (20 packages): 18× `patches: {}` (no migration), 1× `release_please` empty arrays (`catalog: [], github: []`), 1× `tech_docs` one real patch (`/metadata/annotations/backstage.io~1techdocs-ref`). 10 features use `$ref`; all map cleanly to claim paths (see table below). `previousCR`/`UUIDInitializer:50` (`tfStateKey` from `previousCR → claim.providers[provider].tfStateKey → uuidv4()`) is a render-phase lifecycle concern not touched by stitching; no feature references it.

## Decision

Apply feature patches to the **claim during claim stitching**, before AJV.

Pipeline order:

```
[1] claim defaults        (add-only, via loader/claimsDefaulter.ts:13, loader.ts:243)
[2] feature claim-patches (gates, collect-all, via claims/stitching/)
[3] AJV validation        (claims/base/validation.ts:4, single gate, sees everything)
[4] render pipeline       (pure function of the stitched claim)
```

### Gates enforced before any patch is applied

Because all feature patches are collected and inspected before any is applied, the engine enforces (all gates are collect-all: `StitchingError` aggregates every violation with `feature, op, path, reason` and a human sentence (`claims/stitching/errors.ts`), thrown at `loader/lazy_loader.ts:113` so `renderClaims` fails fast with actionable output):

1. **Path protection** (`claims/stitching/protectedPaths.ts`). Hardcoded `PROTECTED_CLAIM_PATHS` (e.g. `/kind`, `/name`, `/providers/github/org`, `/providers/github/name`, `/metadata/name`) — any feature patch targeting a protected pointer is rejected with a clear error. Schema defines what is valid; protected paths define what features may touch.
2. **Patch precedence** (`claims/stitching/stitching.ts`). The stitching input is the claim after defaults (`raw ∪ defaults`), and the engine keeps the **raw claim** as a third argument (`loader/lazy_loader.ts:120` → `stitchClaim(claim, envelopes, rawClaim)`) so it can tell user-declared values from default-supplied ones. Precedence depends on the patch target:
   - **Array appends (claim wins):** an `add ... /-` whose element already exists in the claim's target array (matched by a `name` field, e.g. labels) is silently dropped. A type's declared array values can never be duplicated by a feature. Protected claim paths are exempt from this silent drop so every attempt on them is rejected instead.
   - **User-declared non-array paths (user wins):** an `add`/`replace`/`remove` targeting a non-array path the user declared in the raw claim is rejected with reason `user-declared-path`. A feature can never overwrite raw user intent.
   - **Default-only non-array paths (patch wins):** an `add`/`replace` targeting a path absent from the raw claim but present via `claims_defaults.yaml` is applied and overwrites the default value.
   - **Absent-path `replace`/`remove` is rejected:** a `replace`/`remove` targeting a path that does not exist in the feature's own mutation sequence (tracked via a per-feature shadow document initialized from `claimAfterDefaults`) is rejected with reason `overwrite-protected`. This allows valid ordered sequences like `add` followed by `replace` within one feature, while still rejecting cross-feature replacements targeting paths only created by other features.
3. **Patch deduplication with region-based conflicts** (`claims/stitching/stitching.ts`). Dedup and conflict detection use different keys. **Silent deduplication** only applies to identical intent — same JSON Pointer (+ appended element `name` for array appends), same operation, and same value — in which case the later patch is dropped. **Conflicts (`duplicate-path`)** are keyed by the **write region**: the set of claim-tree nodes a patch writes (`writeRegion`). A whole-pointer write covers the pointer and every descendant; an array append carrying a `name` writes the pointer plus that element's name. Two features conflict (`regionsOverlap`) whenever one write region is a prefix of the other or they are equal — an `add` on `/annotations` and another feature's `add` on `/annotations/x` are a violation in either order, and so is a whole-array write competing with a named append on the same array. This deliberately ignores the operation, so feature order never changes the stitched value — last-wins is impossible. JSON-Pointer escaping is decoded before comparison (`~1` → `/`), so sibling pointers that merely share an escaped prefix compose. The only carve-out is distinct-name array appends, which never compete for write regions. Dedup and conflict detection apply across features only: a single feature's ordered patch list is preserved verbatim, so repeated appends, sequential replaces, or any other within-feature ordered mutation operates in the author's intended sequence. Deterministic ordering is not used — fail-closed surfaces composition bugs while identical intent is allowed.

### Feature descriptor validation before any download

`collectFeaturePatches` (`claims/stitching/stitching.ts`) shape-validates every feature descriptor (`name`, `repo`, `ref`/`version`, `args`) with a dedicated AJV instance compiled against the `GithubComponentFeatureClaim` definition (`claims/stitching/validateFeatureDescriptors.ts`) **before** the preparer loop runs. A malformed descriptor (bad `owner/repository` shape, non-string `repo`, a `ref` that is not a GitHub reference, both/neither `ref` and `version`, missing `name`, unknown keys) aborts stitching before any GitHub auth or network work happens for that feature, and no preparer is called.

### Import boundary parity and once-only stitching

`renderFromImports` (`renderer/import-renderer.ts`) runs the same `defaults → feature claim-patches → AJV` pipeline as `loadClaim`, so claims produced by the importer cannot skip the feature gates. Stitching is **once-only**: `stitchClaim` stamps the result with a non-enumerable `STITCHED_CLAIM` symbol, and a stamped claim is only re-checked by AJV, never re-stitched (no feature re-download, no gates re-applied). The importer-built claim is passed as the raw claim (`stitchClaim(claim, undefined, rawClaim)`), so user-precedence and overwrite-protection rules hold at the import boundary exactly as in `loadClaim`.

### config.yaml API (migration with backward-compatible `patches` acceptance)

**`patches` → `claimPatches`: flat array**

Before:
```yaml
patches:
  catalog:
    - op: add
      path: /metadata/annotations/backstage.io~1techdocs-ref
      value: '...'
```

After:
```yaml
claimPatches:
  - op: add
    path: /annotations/backstage.io~1techdocs-ref
    value: '...'
```

`features_renderer/src/schema.ts` now validates `claimPatches: Patch[]`; `Patch.value` accepts `string|object|array|number|boolean|null`. `claimPatches` is optional — when absent it is treated as an empty array. The legacy `patches` field is still accepted by the schema for backward compatibility but is ignored by the renderer for claim-level behaviour. `features_renderer/src/validate.ts` detects an old provider-keyed `claimPatches` object and throws a migration hint listing the affected keys. `fast-json-patch` validates each patch after schema.

**`$ref` paths: CR paths → claim paths**

`features_renderer/src/render.ts:142 buildContext(stitchedClaim, ...)` now reads `_.get(stitchedClaim, claimPointer)`. Any `$ref` reading a pipeline-computed value (UUID, `revision`) is a design mistake — rewrite to `$arg`.

| Current (CR path) | Migrated (claim path) |
|---|---|
| `[spec, org]` | `[providers, github, org]` |
| `[spec, repo, defaultBranch]` | `[providers, github, branchStrategy, defaultBranch]` |
| `[metadata, annotations, firestartr.dev/external-name]` | `[providers, github, name]` |

### Migration, not a clean cut

The 18/20 empty audit makes a runtime shim unnecessary, but backward compatibility is still respected: the legacy `patches` field remains accepted by `features_renderer/src/schema.ts` (now validated as a provider-keyed object of `Patch[]`) and is ignored by the renderer for claim-level behaviour. Authors migrate by moving entries to the flat `claimPatches` array and rewriting CR paths to claim paths (the `tech_docs` example above and the `validate.ts` migration hint). Shimming `patches` into claim-level behaviour would keep the CR blast radius alive and defeat the three gates, so it is deliberately not applied.

## Consequences

- `FeaturesOverrider` `isPostPatch` JSON-patch path removed (`src/overriders/featureOverride.ts:160`); the overrider now only creates the `FirestartrGithubRepositoryFeature` extra chart (file rendering). `features_renderer.buildContext` receives the stitched claim.
- `claimPatches` in `features_renderer/src/schema.ts` is a flat array.
- Stitching enforces path protection, patch precedence, and region-based conflict detection with op- and value-aware deduplication before AJV; the render pipeline is a pure function of the stitched claim. Feature descriptors are shape-validated before any feature is downloaded, and the import boundary runs the identical pipeline with once-only stitching (`STITCHED_CLAIM`).
- If a feature needs a field not in the claim schema, the claim schema is extended — never worked around via CR patching.
- `UUIDInitializer`/`previousCR` lifecycle unchanged; claim stitching never touches it.
- `TFWorkspaceClaim` variants inherit the stitched parent claim before cloning (`loader/lazy_loader.ts:199`); variants are not re-stitched.
- Glossary: `Claim stitching`, `Stitched claim`, `Protected claim path`, `Overwrite protection`, `Write region` in `cdk8s_renderer/CONTEXT.md`; `Feature claim-patch` in `features_renderer/CONTEXT.md`.
