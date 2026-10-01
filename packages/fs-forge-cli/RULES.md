# fs-forge-cli — Package Rules

- `src/commands/create/*.ts`, `src/commands/kinds.ts` and `src/claims/kinds.ts`
  are generated from `schemas/*.json` (`npm run generate`, also run by
  `prebuild`). Never hand-write create flags; change the schema and regenerate.
- After a build or codegen change, regenerate and commit `oclif.manifest.json`
  (`npx oclif manifest`); CI checks it is in sync.
- Tests load schemas from `schemas/*.json` (via `registerValidator()` or a file
  read), never inline them, and invoke commands through `@oclif/test` instead
  of setting up files with raw `fs` calls.

## Validation

After any change, from `packages/fs-forge-cli/`, in order:

```sh
npm run lint-fix
npx tsc --noEmit
npm run build
export ORG=firestartr-test && npm test -- --runInBand
```
