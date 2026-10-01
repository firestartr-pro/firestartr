# gh_provisioner is organized as per-kind entities

gh_provisioner reconciles GitHub resources through Entities — one per Firestartr
CR kind (e.g. `ghrepo`) — each owning the logic to turn its CR into GitHub state
via Terraform. Cross-cutting or shared logic is kept out of the entities;
features (CODEOWNERS handling, branch protections, pages, discussions) are added
within the relevant entity rather than as unrelated shared machinery. This keeps
each resource kind's behavior cohesive and self-contained.
