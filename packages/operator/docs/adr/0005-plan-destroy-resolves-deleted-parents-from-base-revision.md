# Plan-destroy resolves deleted parents from the base revision

When both a child CR and its parent are deleted in the same PR, the child's
`plan-destroy` resolves the parent from the pull request **base** revision
(`baseSha`) instead of treating any `FileStatus.DELETED` file as unavailable.
For added, modified, renamed, copied, or changed CRs the deleted parent stays
unavailable, preserving the rule that a live resource must not depend on
something the same PR deletes.

We chose this over the obvious path — treating `DELETED` as unresolvable for all
operations — because a deleted child still needs its deleted parent's prior state
to compute what will be destroyed (issue #2031). The split is surprising and easy
to "fix" back into uniform behavior, so it is recorded here. The rule is generic
across every supported child/parent relationship in the PR-plan resolver, not
hard-coded per CR kind.
