# Claim JSON schemas published dereferenced as an npm package

The official claim schemas live in `cdk8s_renderer` as a nested graph with many
`$ref` links — fine for AJV validation inside the package, awkward for external
consumers. We publish them as a separate, self-contained npm package with one
fully dereferenced JSON schema per top-level claim kind (no `$ref`), so
downstream toolchains like `react-jsonschema-form` and Backstage can consume a
single document per kind without resolving the internal schema graph. The
generator reads schemas from the package source (not copied snapshots) so the
package source stays the single source of truth, and emits a bundler-friendly
ESM entrypoint that avoids `createRequire(...)`.
