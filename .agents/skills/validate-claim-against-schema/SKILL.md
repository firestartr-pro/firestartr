---
name: validate-claim-against-schema
description: Validate a claim YAML/JSON file against its Firestartr JSON Schema. Use whenever a claim is created, modified or reviewed, in development or in cdk8s_renderer tests.
---

# validate-claim-against-schema

From `packages/cdk8s_renderer/`:

```sh
tsx src/skills/validate-claim-against-schema.ts <claim-path> [<schema-type>]
```

In tests or TypeScript code, call `validateClaimAgainstSchema({ claimPath,
schemaType })` from `src/skills/validate-claim-against-schema.ts`.

- The schema type defaults to the claim's `kind` (`GroupClaim`,
  `ComponentClaim`, …). Use `firestartr.dev://common/ClaimEnvelope` to check
  only the envelope.
- It uses the renderer's own schema registry (`src/claims/base/schemas/`),
  including the external provider schemas. Don't validate with ad-hoc AJV.
- The result is `{ valid, claimType, errors, message }`. On failure, report
  each invalid field with its error and a suggested fix.
