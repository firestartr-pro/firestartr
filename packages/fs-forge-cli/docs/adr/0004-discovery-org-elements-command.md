# Discovery command for org elements via the claims repo

`fs-forge discovery org-elements` lists all claims in an org's claims repo by reading the
`claims-map.json` from the `claims-index` orphan branch. It is a read-only, non-mutating
command that surfaces the current claims inventory.

The command accepts:

- `--org` / `FSCRT_ORG` — GitHub org owning the claims repo (required)
- `--claims-repo` — repository name, defaults to `claims` (matches the existing default claims repo name)
- `--json` — output structured JSON grouped by claim kind instead of a human-readable table
- `--kind` — repeatable, filters output to one or more claim kinds (e.g. `--kind component --kind group`)

Human-readable output is an aligned table with columns: KIND, NAME, FILE PATH.

JSON output groups entries by claim kind:

```json
{
  "org": "my-org",
  "claimsRepo": "claims",
  "claimsMapSha": "abc123def",
  "claims": {
    "ComponentClaim": [
      { "name": "my-service", "filePath": "components/my-service.yaml" }
    ],
    "GroupClaim": [
      { "name": "platform-team", "filePath": "groups/platform-team.yaml" }
    ]
  }
}
```

## Library changes

`claimsRepo()` (in `src/claims/claimsRepo.ts`) defaults the repository name to
`'claims'`; `--claims-repo` overrides it.

## Consequences

- Users get a single command to see what the system already knows about — no need to clone
  the claims repo or navigate the claims-index branch manually.
- The `--kind` filter lets platform engineers focus on resources of a specific type without
  post-processing the output.
- Because the command reads the pre-built `claims-map.json`, it is fast (one API call to
  get the map, zero additional calls per entry) and does not trigger GitHub API rate limits
  proportionally to the number of claims.
- Stale claims-map detection is inherited from `loadClaimsMap()`: if the map is stale the
  command errors with a clear message advising to wait for the generate-claims-map workflow.
- Configuring `--claims-repo` allows the same command to work with non-standard claims repo
  names, useful for testing or migration scenarios.
