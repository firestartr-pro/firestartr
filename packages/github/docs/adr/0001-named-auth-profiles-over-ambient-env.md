# Named auth profiles over ambient process.env

`packages/github` resolves auth through named Profiles (`createProfile` /
`withProfile`) instead of reading `process.env` directly at token-generation
time. The operator runs several slots concurrently and gh_provisioner may mutate
`process.env` mid-execution, so ambient env reads let identities bleed across
calls. Snapshot-backed Profiles capture env once and are immune to later
mutation; ambient-compatible Profiles preserve the legacy `withEnv` behavior for
callers that intentionally rely on live env. We chose an in-memory profile store
over a disk-backed `.env` file, and kept the existing public auth signatures so
callers migrate incrementally rather than in one breaking change.
