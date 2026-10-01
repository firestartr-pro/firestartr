# Local bare-git mirrors for remote Terraform modules

`terraform_provisioner` can serve remote Terraform/OpenTofu module repos from
local bare-git Mirrors under `/tmp/tfm_mirrors/` instead of fetching upstream on
every run. A process-local Mirror registry tracks installed Mirrors, and Source
translation rewrites eligible remote git module sources to `git::file:///` paths
pointing at those Mirrors. Mirror usage is opt-in and off by default: the remote
flow keeps using the original upstream source unless `warmupMirrors(...)` /
`initializeMirrors(...)` was called earlier in the same process. This reduces
repeated network dependency on upstream git hosts and gives deterministic local
paths, at the cost of process-wide global mirror state.
