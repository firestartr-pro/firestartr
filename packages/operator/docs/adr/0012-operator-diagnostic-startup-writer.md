# Start the operator diagnostic file at operator startup

Supersedes part of [ADR 0002](../../../../docs/adr/0002-operator-diagnostic-file-flight-recorder.md)
(a root ADR that was already operator-scoped; the diagnostic file belongs to this
package, so new decisions about it are recorded here).

ADR 0002 introduced `/tmp/diagnostic` as the operator's flight recorder, but the
writer was started from the processor loop (`loop()` in `processItem.ts`), so the
first snapshot only existed after the first work item arrived and the loop
started. That gap makes the file useless exactly when it matters for startup
diagnosis: a freshly started operator that never receives a CR, or an e2e run
that wants a baseline snapshot before it provisions anything.

The writer now starts in `runOperator` (`index.ts`), immediately after the
activity log is initialised, and writes its first snapshot right away. The
implementation stays in `src/processItem.diagnostic.ts`, which already owned the
schedule, the document shape and the write path; renaming it to something
operator-wide is a separate, behaviour-free commit.

Decisions taken together with the move:

1. **Queue data comes through a seam.** `processItem.ts` exports
   `getOperatorQueueSnapshot()`, which takes its counts from the existing
   `getQueueMetrics()` seam and adds the two fields the diagnostic documents
   differently: the per-slot assignment (`items_per_slot`) and a `blocked` count
   that keeps the historical `isBlocked`-only meaning instead of the wider
   parent-aware gauge, so existing readers see the same numbers. The writer
   receives that function as an argument and never imports the queue, so there
   is no circular import and the module is unit-testable with a fake source.
   `getQueueMetrics()` is reused but never called by the writer directly, which
   is why the spec's "mock getQueueMetrics in the starter test" is exercised one
   level up, through `getOperatorQueueSnapshot`.

2. **One writer, idempotent start.** `startDiagnosticFile()` returns early when a
   writer is already running, so two call sites can never race on the same file.
   The in-loop call in `loop()` is kept as a rollout hedge: `loop()` is only
   reachable through `processItem`, which only `runOperator` wires, so the call
   has no independent caller today.
   **Removal condition:** delete that call once the startup wiring has shipped;
   because the starter is idempotent, removing it is behaviour-free.

3. **Configurable interval, default 30 seconds.** `OPERATOR_DIAGNOSTIC_INTERVAL_SECONDS`
   tunes the tick; absent or unusable values fall back to 30. "Unusable"
   includes anything above `floor((2^31-1)/1000)` seconds, because
   `setInterval` clamps a larger delay to 1 ms and a misconfigured 30-day
   interval would become a tight write loop. The default moved from 10 to 30
   seconds to keep I/O conservative: the e2e collector reads the file every 15
   seconds and tolerates a repeated snapshot, and the in-memory Prometheus
   endpoint remains the live signal. `DISABLE_DIAGNOSTIC_FILE` still turns the
   writer off entirely, checked once at start.

4. **Best-effort failure handling.** Both a rejected write and a throwing
   snapshot source are logged and retried on the next tick: the source is read
   inside the async snapshot builder so a synchronous throw becomes a rejection
   instead of escaping into `runOperator`. Overlapping writes are skipped while
   one is in flight, and the timer is unref'd so diagnostics never keep the
   process alive nor change termination behaviour — this module installs no
   signal handlers, leaving shutdown to the operator's own handlers.

5. **The file contract is unchanged.** Path (`/tmp/diagnostic`) and YAML shape
   (env, queue, slots, semaphore, errors, crds) stay byte-compatible for
   existing readers. The CRD view is now derived from every retained monitor
   registration instead of from a sample of the active monitors: because the
   first snapshot can precede the CRD monitors, sampling `isStarted()` would let
   a monitor that starts and stops between two ticks - or registers after the
   first snapshot - leave its kind reported as `observed`. A retained
   registration means the kind had no informer attached at startup, and
   `crdMonitor` never reattaches one without an operator restart, so the kind
   must stay out of `crds.observed` for the whole process lifetime. `crds.missing`
   still lists only the monitors that are actively waiting for their CRD.

Alternatives considered and rejected:

- **A second independent timer at startup, keeping the 10-second loop timer.**
  Two writers would truncate and rewrite the same file concurrently and can
  interleave partial content.
- **Extending `getQueueMetrics()` into the diagnostic source.** That object is
  the Prometheus gauge contract, including the parent-aware `nItemsBlocked`
  count and no per-slot data. Using it verbatim would silently change documented
  diagnostic fields; the seam is reused behind `getOperatorQueueSnapshot()`
  instead, which keeps the gauge contract intact.
- **A new `src/diagnostic.ts` module.** Cleaner naming, but it turns ~115 lines of
  untouched rendering into "new" lines and doubles the reviewable surface for no
  behavioural gain. The rename is worth doing on its own, once this behaviour is
  reviewed and merged.
