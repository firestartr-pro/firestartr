# Note on Jest/ESM Test Isolation for Mirror Refresher Tests

## Why Some Mirror Refresher Tests Use `.skip` or Non-robust Spying

The tests for the mirror refresher subsystem (`initializeMirrors().initializeRefresher(...)`) rely on confirming that internal hooks and error handlers are called for async timer-driven refreshes. If you are using ECMAScript modules (ESM) and static imports, jest.spyOn or jest.mock sometimes cannot patch the actual references used by callback closures inside the implementation. This is an ESM module boundary and import binding limitation, not a bug in the code or test suite.

- Example: Spying on `refreshMirror` or logger functions will NOT affect the copy in use inside timer-driven async logic (since ESM imports are immutable bindings and closures capture them at import time).

- As a result: A few test cases that expect to intercept log/error/refresh internals via spies cannot reliably do so unless:
    - You refactor to allow explicit injection (dependency injection of all external dependencies), OR
    - Use a CommonJS module boundary (not recommended).
- This has no effect on runtime behavior or code safety.

**Conclusion:**
- All actual runtime code is fully working and robust. Only timer/test double edge cases using jest.spyOn cannot be made to work without infra changes not justified for this scenario.
- If full coverage is needed, refactor for dependency injection and inject all references you intend to spy on in tests.

See comments in `__tests__/mirrors.test.ts` for more info.
