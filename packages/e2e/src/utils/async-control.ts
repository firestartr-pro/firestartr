import common from 'catalog_common';

const RETRYABLE_ERROR = Symbol('retryableError');

// =============================================================================
// retryAsync vs pollUntil - when to use which
// =============================================================================
//
// retryAsync: Use when you want to retry an operation N times with optional backoff.
//             The operation is expected to succeed eventually or fail after max attempts.
//             Example: calling an API that may return 401, retry after auth refresh.
//
// pollUntil:  Use when you want to poll a condition until it becomes true or timeout.
//             The operation returns a value that you check with isDone().
//             Example: waiting for a K8s resource to reach status 'Ready'.

// Options for retryAsync - see comparison above.
export interface RetryAsyncOptions {
  // Maximum number of attempts before giving up
  attempts: number;

  // Return true to retry the error, false to propagate it
  shouldRetry: (error: unknown, attempt: number) => boolean;

  // Optional: calculate delay in ms before next attempt. Default: 0 (no delay)
  getDelayMs?: (error: unknown, attempt: number) => number;

  // Optional: hook called before each retry (for logging, metrics, etc)
  onRetry?: (
    error: unknown,
    attempt: number,
    delayMs: number,
  ) => void | Promise<void>;
}

// Options for pollUntil - see comparison above.
export interface PollUntilOptions<T> {
  // Maximum time to wait in milliseconds
  timeoutMs: number;

  // Time between each poll attempt in milliseconds
  intervalMs: number;

  // Return true when the condition is met (e.g., resource.status === 'Ready')
  isDone: (value: T) => boolean;

  // Optional: return true to retry a failed probe, false to propagate the error.
  // Use with createRetryableError() for transient errors (network timeouts, 429, 5xx)
  // that should be retried within the polling window.
  shouldRetryError?: (error: unknown) => boolean;

  // Optional: hook called before each retry (for logging, metrics, etc)
  onRetryError?: (error: unknown, intervalMs: number) => void | Promise<void>;

  // Optional: custom timeout error message with access to last observed value
  createTimeoutError?: (lastValue: T | undefined) => Error;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message?: unknown }).message);
  }

  return String(error);
}

// Wraps an error to mark it as retryable for pollUntil.
//
// Use this when a probe() throws a transient error (e.g., network timeout,
// 429 rate limit, 5xx server error) that should be retried rather than
// immediately propagated.
//
// Example:
//
//   try {
//     await probe();
//   } catch (err) {
//     if (isTransient(err)) {
//       throw createRetryableError(err);
//     }
//     throw err;
//   }
export function createRetryableError(error: unknown): Error {
  const wrappedError = new Error(getErrorMessage(error)) as Error & {
    cause?: unknown;
    [RETRYABLE_ERROR]: true;
  };

  wrappedError.cause = error;
  wrappedError[RETRYABLE_ERROR] = true;

  return wrappedError;
}

// Checks if an error was marked as retryable via createRetryableError().
//
// Use as the shouldRetryError option in pollUntil to distinguish transient
// errors (should retry) from permanent errors (should throw immediately).
export function isRetryableError(error: unknown): boolean {
  return Boolean(
    typeof error === 'object' &&
    error !== null &&
    (error as Record<PropertyKey, unknown>)[RETRYABLE_ERROR],
  );
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

// Retries an async operation with optional backoff until success or max attempts.
//
// Use retryAsync when:
// - You have an operation that may fail transiently (network, rate limits, auth)
// - You want bounded retries (N attempts, then give up)
// - You want optional backoff between attempts
//
// Example:
//
//   // Retry 401 errors with client refresh
//   await retryAsync(() => api.request(), {
//     attempts: 3,
//     shouldRetry: (err) => getStatusCode(err) === 401,
//     onRetry: () => refreshClient(),
//   });
//
// Example:
//
//   // Retry with exponential backoff
//   await retryAsync(() => api.request(), {
//     attempts: 5,
//     shouldRetry: (err) => isRetryable(err),
//     getDelayMs: (_, attempt) => Math.pow(2, attempt) * 100,
//   });
export async function retryAsync<T>(
  run: () => Promise<T>,
  options: RetryAsyncOptions,
): Promise<T> {
  assertPositiveInteger(options.attempts, 'attempts');

  for (let attempt = 1; ; attempt += 1) {
    try {
      console.log(`[retryAsync] attempt #${attempt}/${options.attempts}`);
      const result = await run();
      console.log(
        `[retryAsync] attempt #${attempt}/${options.attempts} -> SUCCESS`,
      );
      return result;
    } catch (error) {
      const retryable =
        attempt < options.attempts && options.shouldRetry(error, attempt);
      console.log(
        `[retryAsync] attempt #${attempt}/${options.attempts} -> FAILED: ${error instanceof Error ? error.message : String(error)} | willRetry=${retryable}`,
      );

      if (!retryable) {
        throw error;
      }

      const delayMs = Math.max(0, options.getDelayMs?.(error, attempt) ?? 0);
      await options.onRetry?.(error, attempt, delayMs);

      if (delayMs > 0) {
        console.log(`[retryAsync] sleeping ${delayMs}ms before retry`);
        await common.generic.sleep(delayMs);
      }
    }
  }
}

// Polls a condition until it becomes true or a timeout is reached.
//
// Use pollUntil when:
// - You need to wait for an async condition to become true
// - You want to poll at regular intervals
// - You want a clear timeout with a meaningful error message
//
// The probe() function should return a value that isDone() checks.
//
// Example:
//
//   // Wait for K8s resource to reach Ready status
//   await pollUntil(
//     () => k8s.read(name),
//     {
//       timeoutMs: 60000,
//       intervalMs: 5000,
//       isDone: (resource) => resource.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'),
//     }
//   );
//
// Example:
//
//   // Wait with retryable probe errors (transient network issues)
//   await pollUntil(
//     () => k8s.read(name),
//     {
//       timeoutMs: 60000,
//       intervalMs: 5000,
//       isDone: (resource) => resource.status === 'Ready',
//       shouldRetryError: isRetryableError,
//     }
//   );
//
// Example:
//
//   // Include last observed state in timeout error
//   await pollUntil(
//     () => k8s.read(name),
//     {
//       timeoutMs: 60000,
//       intervalMs: 5000,
//       isDone: (resource) => resource.status === 'Ready',
//       createTimeoutError: (last) => new Error(`Timed out. Last state: ${last?.status}`),
//     }
//   );
export async function pollUntil<T>(
  probe: () => Promise<T>,
  options: PollUntilOptions<T>,
): Promise<T> {
  assertPositiveInteger(options.timeoutMs, 'timeoutMs');
  assertPositiveInteger(options.intervalMs, 'intervalMs');

  const deadline = Date.now() + options.timeoutMs;
  const startTime = Date.now();
  let lastValue: T | undefined;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, deadline - Date.now());
    console.log(
      `[pollUntil] attempt #${attempt} | elapsed=${Math.round(elapsed / 1000)}s | remaining=${Math.round(remaining / 1000)}s`,
    );

    try {
      const value = await probe();
      lastValue = value;

      if (options.isDone(value)) {
        console.log(
          `[pollUntil] attempt #${attempt} -> DONE after ${Math.round(elapsed / 1000)}s`,
        );
        return value;
      }

      console.log(
        `[pollUntil] attempt #${attempt} -> condition not met, sleeping ${options.intervalMs}ms`,
      );
    } catch (error) {
      const isRetryable = options.shouldRetryError?.(error) ?? false;
      console.log(
        `[pollUntil] attempt #${attempt} -> error: ${error instanceof Error ? error.message : String(error)} | retryable=${isRetryable}`,
      );

      if (!isRetryable) {
        throw error;
      }

      await options.onRetryError?.(error, options.intervalMs);
    }

    await common.generic.sleep(options.intervalMs);
  }

  console.log(
    `[pollUntil] TIMEOUT after ${Math.round((Date.now() - startTime) / 1000)}s (${attempt} attempts)`,
  );

  throw (
    options.createTimeoutError?.(lastValue) ??
    new Error(`Timed out after ${options.timeoutMs}ms.`)
  );
}
