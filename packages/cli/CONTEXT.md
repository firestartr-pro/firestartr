# cli

_Stub — this package's glossary is authored lazily via `/domain-modeling` as the
package is touched._

## Language

### Terms

- **CLI version** — the version of the `@firestartr/cli` package itself, sourced from `packages/cli/package.json` (`version` field).
- **Version constraint** — a semver range expression (e.g. `>=2.6.4`, `^2.5.0`, `~2.6.4`) that defines a condition a version must satisfy.
- **--validate** — a flag on `firestartr-cli version` that accepts a version constraint and evaluates it against the CLI version (or an optionally provided version), exiting non-zero if the constraint is not met.
- **--ignore-snapshots** — a flag that allows snapshot versions (e.g. `v2.9.0-snapshot-01`) to bypass semver constraint validation. Without this flag, snapshot versions cause a hard error.
