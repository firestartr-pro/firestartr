# ADR 0015: Claim schemas come from the published npm package

## Status
Accepted. Part of [#185](https://github.com/firestartr-pro/firestartr/issues/185),
implemented by [#208](https://github.com/firestartr-pro/firestartr/issues/208).

## Context

The claim contract is authored in `packages/cdk8s_renderer`
(`src/claims/base/schemas`). `@firestartr/firestartr-claims_schemas` is built
from it on every release (`scripts/schema-npm-producer.ts`) and published to npm
with the firestartr version. fs-forge-cli did not use it: it kept ten
hand-written `schemas/*Claim.json` copies, so the contract existed twice and the
two could drift without any check noticing.

The copies already differed from the source: the CLI's lacked fields the source
defines (`tfStateKey`, `sync`, `files`, `variants`, ...), had looser `name`
patterns, and carried CLI-only keywords (`x-fs-forge-icon`, `x-fs-forge-summary`,
`x-fs-forge-unique-item-property`).

## Decision

fs-forge-cli reads its claim schemas from `@firestartr/firestartr-claims_schemas`
and keeps nothing of the contract itself. The ten local copies are deleted.
`schemas/` holds only the CLI's own output contracts (`CommandHelpJson`,
`MutationDiff`, `RelationGraph`).

Two files in `src/schema/` carry the change:

- `claimSchemas.ts` is the only reader of claim schemas. It locates the package
  directory (`claimSchemasDir`), lists the kinds from the `*Claim.json` files it
  finds (`listClaimKinds`) and returns a schema with the CLI patches applied
  (`loadClaimSchema`). The validator, the codegen, `validate`, `features` and the
  mutations all go through it.
- `claimOverlay.ts` is the only place where fs-forge adds anything on top of the
  package: the kind icon and summary (`CLAIM_PRESENTATION`), flag descriptions
  and extra keywords (`SCHEMA_PATCHES`), and the package fields that stay valid
  in a claim but get no `create` flag (`HIDDEN_FLAGS`).

A patch is addressed by a dotted property path and is merged into the node it
finds. A path that matches nothing throws, so an overlay that has fallen out of
step with the package fails loudly instead of being skipped.

The package wins wherever the two contracts disagree. A required leaf that can
also arrive through an ancestor `<path>.json` flag is not an oclif `required`
flag, because oclif checks required flags before it decodes that JSON; the
schema validation of the built claim enforces it.

## Alternatives considered

### Put `x-fs-forge-*` in the source schemas
It would remove the overlay, but it puts the CLI's presentation (icons, help
text) into the contract that the renderer, the Backstage plugin and the docs
repo also consume. The overlay keeps the contract single-purpose.

### Keep the copies and add a drift check
It detects the problem but keeps two sources of truth, which is what #185 asks
to remove.

### Expose every field the package adds as a flag
It adds around twenty flags (`tfStateKey`, `sync.*`, `files`, `variants`, ...)
that `create` never had. They stay valid in a claim and can be hidden now and
exposed later one by one.

### Import the package entry instead of resolving its directory
The entry point is a bundle of JSON imports; the CLI only needs the files, and
resolving the directory does not run package code.

## Consequences

- The claim contract has one source. A change to it reaches the CLI by bumping
  one dependency.
- The contract the CLI enforces is now the package's, so it is stricter than the
  old copies (`name` patterns, `maxLength`, `required`). `owner` became required
  for `OrgWebhookClaim` and `SecretsClaim`, and the
  `providers.github.{name,org,billing_email}` flags of `OrgSettingsClaim` are no
  longer required by oclif. Tightening them is a change to the source schema, not
  to the CLI.
- The CLI needs the package at build time, because the codegen reads it.

## When a schema changes

The package is built by `scripts/schema-npm-producer.ts` when a release `v*` is
published, or by a manual run of the publish workflow. A change merged into
`cdk8s_renderer` is therefore invisible to fs-forge-cli until a package version
that contains it is published and the dependency is bumped.

### A claim schema is modified

1. **Publish.** The next package version carries the change. fs-forge-cli picks
   it up by bumping its `@firestartr/firestartr-claims_schemas` dependency and
   the lockfile; a new major version also needs the range changed.
2. **Regenerate.** `npm run build` runs the codegen (`prebuild`). Added fields
   become `create` flags, removed fields disappear, and a field that became
   required becomes a required flag. The test that regenerates the committed
   commands byte for byte fails until `npm run generate` is run and the result
   is committed, together with `oclif.manifest.json`.
3. **Overlay.** A patch or hidden flag whose path was renamed or removed throws
   with the schema and path. Update or delete the entry in `claimOverlay.ts`.
   A new field that the package adds but `create` should not expose goes into
   `HIDDEN_FLAGS`.
4. **Release.** Changing a field from optional to required, or removing a flag,
   changes what `create` accepts, so the fs-forge-cli release is a breaking one.

### A claim schema is created

1. **Package.** The new kind is added to `CLAIM_KINDS` in the producer, and
   ideally to `SMOKE_FIXTURES`. A kind missing from `CLAIM_KINDS` is not
   published, so the CLI does not see it.
2. **Discovery.** `listClaimKinds` picks up any `<Kind>Claim.json` on its own, so
   the codegen emits a `create` command for it with no change to the loader.
3. **Required edits in the CLI.** These fail instead of being skipped:
   - `CLAIM_PRESENTATION` needs the icon and summary, or the codegen throws
     `<Kind> has no entry in CLAIM_PRESENTATION`.
   - `KIND_OVERRIDES` in `src/claims/kindRegistry.ts` needs the kind's
     capabilities (claims directory, hydration, delete workflow, references). It
     is typed over the generated kinds, so a missing entry is a compile error.
   - `mutations/definitions.ts` registers the generated create command.
4. **Optional edits.** Descriptions for its flags go in `SCHEMA_PATCHES`;
   package fields to keep off `create` go in `HIDDEN_FLAGS`.

A schema that is not a claim (it does not end in `Claim.json`, such as the
`dot-firestartr` and `actions` sets the package also publishes) is ignored by
fs-forge-cli.
