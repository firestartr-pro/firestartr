# Single shared configGit as the source of truth for git auth

All GitHub-backed remote git access in `terraform_provisioner` goes through one
shared `configGit` method that prepares `/home/node/.gitconfig` with an
`insteadOf` rewrite carrying a GitHub App token. That single method is used as-is
by every flow (`project_tf_remote`, `mirror-repos`, warmup, future callers); no
second implementation or wrapper may reproduce it. The token is generated on
demand via the existing GitHub machinery (`github.getGithubAppToken(org)`,
resolving the org from environment) rather than a static or precomputed token, so
auth stays correct as identities change at runtime.
