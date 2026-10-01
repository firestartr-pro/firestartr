# Semaphore saturation counters for diagnostic observability

The `Semaphore` class gained three new getters: `max`, `totalAcquisitions`, and
`timesSaturated`. These are increment-only counters with no runtime cost beyond
a single integer increment per `acquire()` call.

`timesSaturated` counts how many times an `acquire()` had to wait because all
slots were occupied. This is the single most useful signal for diagnosing API
read bottlenecks: if the semaphore is frequently saturated, the
`OPERATOR_MAX_CONCURRENT_API_CALLS` limit is too low for the workload; if it
never saturates, the limit is not the bottleneck.

The counters are exposed to the diagnostic file via the existing
`api-read-limiter` module. They are not exposed to Prometheus — the diagnostic
file is the intended consumer, and adding OTel counters would duplicate existing
per-slot processing metrics without adding value.
