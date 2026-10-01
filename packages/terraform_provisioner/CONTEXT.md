# terraform_provisioner

Prepares and runs Terraform/OpenTofu projects, including mirroring of remote
module repositories and workspace reuse. This glossary covers mirrors and
workspace reuse; other areas are authored lazily via `/domain-modeling` as the
package is touched.

## Language

### Mirrors

**Mirror**:
A local bare git clone of a remote Terraform/OpenTofu module repo under
`/tmp/tfm_mirrors/`.
_Avoid_: cache, copy

**Mirror registry**:
The in-process record of installed Mirrors; source translation only applies to
repos listed here.
_Avoid_: index, store

**Source translation**:
Rewriting a remote git module source to its local `git::file:///` Mirror path.
_Avoid_: rewrite, redirect

**Warmup**:
Explicitly pre-downloading a configured set of Mirrors for the current process;
mirror usage stays off until Warmup runs.
_Avoid_: preload, prefetch

### Workspaces

**Workspace reuse**:
Running multiple Terraform commands against one already-prepared project
directory without rebuilding it (`reuseExistingProject`).
_Avoid_: caching, persistence
