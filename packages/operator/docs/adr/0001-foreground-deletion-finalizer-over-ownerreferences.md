# Foreground-deletion finalizer replaces ownerReferences

Parent CRs are kept alive during deletion by a custom
`firestartr.dev/foreground-deletion` finalizer installed on the parent by each
child, rather than native Kubernetes `metadata.ownerReferences` on the children
(ownerReferences suspended per issue #1767). A child installs the finalizer on
its parent on CREATED/UPDATED and removes it on MARKED_TO_DELETION once no
children remain; the informer's `needsBlocking` logic blocks the parent's
deletion work item while the finalizer is present, giving children time to be
cleaned up first. The dummy chain (A→B→C) deliberately mirrors this exact path so
core-machinery validation exercises production deletion behavior. The trade-off:
deletion ordering lives in operator scheduling rather than in Kubernetes garbage
collection, but it gives explicit, debuggable parent/child teardown that native
ownerReferences could not express here.
