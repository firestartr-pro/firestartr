# github

GitHub access layer: authentication, API clients, and check runs. This glossary
covers the auth-profile model; other areas are authored lazily via
`/domain-modeling` as the package is touched.

## Language

### Auth profiles

**Profile**:
A named auth identity in `packages/github`, either snapshot-backed or
ambient-compatible.
_Avoid_: account, credential, identity

**Snapshot-backed Profile**:
A Profile that captures auth env at creation time and is immune to later
`process.env` mutation.
_Avoid_: frozen, static profile

**Ambient-compatible Profile**:
A Profile that intentionally observes live `process.env` (for `withEnv`
callers).
_Avoid_: dynamic, live profile

**Config resolver**:
The shared, profile-aware resolver all profiled auth reads go through, instead
of ad-hoc `process.env` access.
_Avoid_: env reader, config loader
