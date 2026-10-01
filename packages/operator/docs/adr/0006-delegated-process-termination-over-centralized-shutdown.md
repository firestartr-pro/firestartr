# Delegated process termination over centralized shutdown coordination

The operator's shutdown role is limited to stopping new work intake and passively
waiting for processing slots to drain (`podIsTerminating` flag + idle-slot check),
rather than implementing a centralized AbortController-based shutdown coordinator
that actively cancels in-flight operations. Each provisioner owns its own process
lifecycle via the `ProcessHandler` callback pattern (escalating SIGINT -> SIGTERM ->
SIGKILL with configurable timeouts), and Kubernetes `terminationGracePeriodSeconds`
acts as the hard backstop via SIGKILL. This was chosen because the provisioner
already enforces per-operation hard timeouts on child tofu processes independently
of operator lifecycle, making centralized cancellation redundant plumbing that would
couple the operator to provisioner internals. The trade-off: the operator cannot
actively shrink the grace window or prioritize which in-flight operations to cancel
first -- it simply waits and relies on Kubernetes to force-kill if slots don't drain
in time.
