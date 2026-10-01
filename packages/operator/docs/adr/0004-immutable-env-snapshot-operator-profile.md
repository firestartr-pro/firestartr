# Immutable env snapshot and dedicated `operator` profile

The operator captures an immutable snapshot of its environment once at startup
and creates a GitHub `operator` profile from it, then routes all operator-owned
feedback flows through `github.withProfile('operator')` instead of bare
ambient-env auth helpers. This exists because `gh_provisioner` temporarily
mutates `process.env` to inject provider-specific credentials, and the operator
runs several slots concurrently, so feedback operations reading mutable
`process.env` at token-generation time could authenticate as the wrong GitHub
identity mid-workflow. `gh_provisioner` continues to use explicit
provider-specific profiles, and provider-scoped env overrides remain allowed. The
trade-off: feedback identity is pinned at startup and cannot follow later env
changes, which is exactly the drift this prevents.
