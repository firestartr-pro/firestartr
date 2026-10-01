# cdk8s_renderer — Package Rules

## Tests

- Claims come only from `__tests__/fixtures/base_claims/`, which is never
  modified. Copy and patch them through `createTestContext()` from
  `__tests__/auxiliar.ts` (`applyPatches`, `addFile`, `renderClaims`,
  `testRenderedCR`, …): no claim YAML in test bodies and no raw `fs` setup.
- A new base claim fixture goes in the right `base_claims/<kind>/` directory
  and must work for every test.
- Validate claims (in development and in tests) with the
  `validate-claim-against-schema` skill and its
  `src/skills/validate-claim-against-schema.ts` helper, not ad-hoc AJV.

## Where render logic goes

Charts define the base CR. After that, patches run in this order, and each
stage has one job:

| Stage | Directory | Use it for | Not for |
|---|---|---|---|
| Normalizers | `src/normalizers` | Rewriting rendered fields from claim values, `previousCR` or file content (stable names, revisions, references, module content) | Bootstrap metadata, overrides, checks |
| Initializers | `src/initializers` | Additive baseline every applicable CR gets (claim refs, UUID state keys) | Base structure, overrides, checks |
| Overriders | `src/overriders` | Changes the claim explicitly asks for (`providers.*.overrides`, extra permissions, features) | Anything that applies to every claim |
| Globals | `src/globals` | Behavior from central config that applies to every matching claim | Per-claim customization, bootstrap |
| Validations | `src/validations` | Read-only checks on the final rendered set (`tfStateKey` collisions, CR size, cross-resource consistency) | Raw claim schema checks, any mutation |

Defaults from configuration (`src/defaults`) fill omitted values: claim
defaults before rendering; `InitializerDefault` adds values only when absent,
while `GlobalDefault` may replace them.

Scope every new normalizer, initializer or overrider to the narrowest provider
and kind.
