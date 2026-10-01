# Feature discovery through source roots

`fs-forge features discover` reads a Feature source rooted at either a URL or local
directory. The default source is
`https://raw.githubusercontent.com/firestartr-pro/docs/main/site/raw/features`; custom
sources are used directly rather than translated through a GitHub URL template.

A source has an `index.json` plus per-Feature version history, schemas, README, and
CHANGELOG files. Discovery is read-only, performs no caching or authentication, and
prints tables by default or structured JSON with `--json`. Detail flags select one
Feature resource at a time and raw Markdown is written unchanged.

## Consequences

- Local Feature sources provide the same behavior without network access.
- Failures are immediate and non-zero; missing or malformed data is not partially shown.
- Installation, caching, authentication, and interactive rendering remain outside this
  command.
