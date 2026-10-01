# The CR spec is the sole source of truth for reconciliation

gh_provisioner derives desired GitHub state exclusively from the Firestartr CR
spec, never from live GitHub API state. Branch protection planning reads only
`FirestartrGithubRepository.spec.branchProtections`; pages, discussions, and
other settings likewise come from the CR. Import planning and reconciliation do
not query live repository state to decide desired configuration. This keeps
reconciliation deterministic and GitOps-driven — the cluster CR is authoritative,
so the same CR always produces the same intended GitHub configuration regardless
of drift in the live repo.
