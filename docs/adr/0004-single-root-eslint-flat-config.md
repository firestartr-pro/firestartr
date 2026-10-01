# ADR 0004: Single root ESLint flat config for the monorepo

## Status

Accepted

## Context

Upgrading gts 6 → 7 brings ESLint 9, which drops `.eslintrc*` and `.eslintignore` in favour of a flat `eslint.config.js`. Flat config is resolved by searching upward from the working directory, so a config at the repository root is found when each package runs `gts lint`. The alternatives were a thin per-package `eslint.config.js` re-exporting the root one, or a full config per package.

## Decision

Keep exactly one ESLint config, `eslint.config.js` at the repository root, shared by every package. Package-specific ignores live in that file as `packages/<name>/...` glob patterns; packages have no ESLint config or ignore file of their own. Prettier options live in a root `.prettierrc.json`, not inside the `prettier/prettier` rule. All packages, including `fs-forge-cli`, use the root-hoisted gts version.

## Consequences

- Adding a package-specific ignore means editing the root config, not adding a file to the package.
- Root ignores apply to every package, whereas eslintrc only read the `.eslintignore` of the directory lint ran in. Ignores that were package-local before (e.g. `__tests__/`, `*.js`) must stay scoped to those packages, or they silently drop lint coverage elsewhere.
- A per-package `.eslintignore` or `eslint.config.js` would silently diverge from, or shadow, the shared config — do not reintroduce them.
- The root declares `eslint` ^9 explicitly: root-level plugins otherwise resolve a hoisted ESLint 8, which breaks `gts lint`.
- The root config builds on gts's main export, not `gts/eslint.config.js`, which fails to load in gts 7.0.0.
