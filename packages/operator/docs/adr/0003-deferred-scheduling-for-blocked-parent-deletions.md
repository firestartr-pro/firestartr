# Deferred scheduling for blocked parent deletions

A parent deletion repeatedly blocked by surviving children is moved into a
deferred segment once it has been detected blocked more than 5 times, tracked by
a dedicated in-memory block counter that is independent of the retry subsystem
and not persisted across restarts. Deferred items stay in the queue but are never
eligible ahead of any non-deferred work, in stable insertion order, and never
regain priority even if their children later disappear. This keeps mass-deletion
waves from stalling the whole queue while preserving every other queue, retry,
and deletion semantic unchanged. The trade-off: a magic threshold (6) and
process-local state with no new metrics or events, chosen deliberately to keep
the change minimal and add no new observability or persistence surface.
