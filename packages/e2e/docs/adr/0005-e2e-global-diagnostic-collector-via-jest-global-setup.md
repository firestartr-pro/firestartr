# e2e global diagnostic collector via Jest globalSetup

The e2e package now uses Jest `globalSetup` / `globalTeardown` to run a
diagnostic collector that spans all test suites. The collector polls the
operator pod's `/tmp/diagnostic` file every 15 seconds via `kubectl exec` and
appends each snapshot (with a `---` separator and collection timestamp) to
`/tmp/diagnosis` on the test runner host.

This is the first use of `globalSetup` in the e2e package. Previously, each
suite managed its own lifecycle in `beforeAll` / `afterAll`. The collector was
placed in `globalSetup` rather than per-suite hooks because the diagnostic
timeline is most useful when it covers the full run, including gaps between
suites and the setup/teardown phases themselves.

The collector uses `child_process.execSync` with `kubectl` rather than the
`@kubernetes/client-node` Exec API because: (a) `globalSetup` runs outside
Jest's module mapper, so workspace imports like `catalog_common` are unavailable;
(b) a synchronous `kubectl exec` every 15 seconds is simpler and more reliable
than maintaining a WebSocket exec stream across suite boundaries.

The collector is opt-out (`DISABLE_DIAGNOSTIC_COLLECTOR`). It silently skips
snapshots when the operator pod is not found or the diagnostic file does not
exist yet, so it does not interfere with suites that run without a live operator.
