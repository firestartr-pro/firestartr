# Skip hydration for catalog-only claims

Systems and domains are catalog-only claims — they produce only Backstage catalog entities, not GitHub CRs. Dispatching the full provision-workflow for these kinds triggers unnecessary hydration steps (hydrate-github-claim, wet PR creation, wet PR merge) that have no effect.

The CLI now passes `skipHydration: true` to the provision workflow when `claimType` is `SystemClaim` or `DomainClaim`. The provision workflow conditionally skips the hydrate dispatch, wet PR discovery, and wet PR merge steps. Catalog hydration is handled downstream by the claims-index workflow regenerating `claims-map.json` on merge to the default branch.

This is a simple kind-based check in `client.publishClaim()` — one constant, one `Set.has()` call, one additional workflow input.
