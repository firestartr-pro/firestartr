# watch-checks --current mode for point-in-time reconciliation status

Beyond watching wet PR check runs during provisioning, users need to check the
reconciliation status of already-hydrated claims. The rendered CRs on a state
repo's main branch carry a `firestartr.dev/last-state-pr` annotation pointing
to the PR that last modified them.

We extend `watch-checks` with a `--current` mode that reads the CR from main,
follows the annotation to the PR, and reports its check run status plus the CR
content. This covers merged, open, and closed PR states, and gracefully handles
missing annotations by showing the CR content with a warning.
