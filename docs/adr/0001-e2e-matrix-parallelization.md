# E2E workflow matrix parallelization

- **Status:** accepted
- **Date:** 2026-07-10

## Context

All e2e suites ran sequentially in a single monolithic GitHub Actions job (~45 min),
making failure attribution unclear and individual suite retries impossible. Expensive
suites (massive, crd-upgrade) could not be skipped during iteration.

## Decision

Split the `e2e` workflow into parallel jobs: `unit-tests` (no Kind cluster, always
runs), `build-operator-image` (builds once, shares the image as a tarball artifact),
and `e2e` (matrix over `[github, terraform, massive, crd-upgrade]`, each suite in
its own Kind cluster). A `prepare-matrix` job calls
`.github/scripts/prepare-suite-matrix.js` to build the suite list dynamically —
`github`, `terraform`, and `crd-upgrade` on push, with `massive` available through
`workflow_dispatch`. The
Dagger module (`dagger/etoe`) gains an optional `namePrefix` parameter that is
prepended to test resource names to prevent collisions when multiple suites run
in parallel against the same GitHub org.

## Consequences

Wall-clock time for a full push run drops from ~45 min to ~15 min. Each suite gets
its own job status and can be retried individually. Four concurrent Kind clusters
consume more runner resources and each duplicates cluster creation overhead (~2 min).
