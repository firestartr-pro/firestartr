# Operator diagnostic file: /tmp/diagnostic as the flight recorder

The operator now writes a `/tmp/diagnostic` file every 10 seconds (overwrite,
not append) containing a YAML snapshot of its internal state: queue counts, slot
assignments, semaphore usage, and a cumulative error counter. The e2e global
collector reads this file periodically via `kubectl exec` and appends each
snapshot to `/tmp/diagnosis` on the host, building a timestamped timeline of
operator behavior across the entire suite run.

Two alternatives were considered and rejected:

1. **Prometheus metrics endpoint.** The operator already exposes counters on
   `:9464/metrics`, but those are aggregated totals designed for alerting, not
   point-in-time snapshots of what each slot is doing. A human reading a failure
   diagnosis wants "slot-2 was processing DummyCR/foo-7 at T+90s", not a counter
   delta. The diagnostic file provides that without duplicating Prometheus
   concerns.

2. **Operator log parsing.** Grepping operator stdout for errors and queue state
   is fragile, format-dependent, and produces noisy output. A dedicated file with
   a fixed structure is cheaper to read and cheaper to produce.

The diagnostic file is always on by default. `DISABLE_DIAGNOSTIC_FILE` disables
the operator-side writer; `DISABLE_DIAGNOSTIC_COLLECTOR` disables the e2e-side
reader. Both are opt-out rather than opt-in because the file has negligible cost
(one small write every 10s) and its value only appears when something fails —
exactly when you forgot to enable it.
