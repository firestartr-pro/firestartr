# fs-forge-cli — Package Rules

- `src/commands/create/*.ts`, `src/commands/kinds.ts` and `src/claims/kinds.ts`
  are generated from the claim schemas of `@firestartr/firestartr-claims_schemas`
  (`npm run generate`, also run by `prebuild`). Never hand-write create flags.
- Claim schemas are not defined here: to change a claim's contract, change
  `packages/cdk8s_renderer`. What belongs to the CLI (kind icon and summary,
  flag descriptions, hidden flags, extra keywords) lives in
  `src/schema/claimOverlay.ts`; a patch whose path no longer exists throws.
  Load claim schemas only through `src/schema/claimSchemas.ts`.
- `schemas/` holds only the CLI's own contracts (`CommandHelpJson`,
  `MutationDiff`, `RelationGraph`).
- After a build or codegen change, regenerate and commit `oclif.manifest.json`
  (`npx oclif manifest`); CI checks it is in sync.
- Tests load claim schemas with `loadClaimSchema(claimSchemasDir(root), kind)` (or
  `createClaimValidator`), never inline them, and invoke commands through `@oclif/test` instead
  of setting up files with raw `fs` calls.

## Validation

After any change, from `packages/fs-forge-cli/`, in order:

```sh
npm run lint-fix
npx tsc --noEmit
npm run build
export ORG=firestartr-test && npm test -- --runInBand
```
