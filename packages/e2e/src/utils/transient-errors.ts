import { getStatusCode, type StatusCodeError } from '../errors/status-code';

// Status codes that are always treated as transient (excluding 5xx, which is
// handled by the >= 500 check below).
const TRANSIENT_STATUS_CODES = new Set([408, 429]);

// Matches network-layer errors that arrive without an HTTP status code.
const NETWORK_ERROR_REGEX =
  /(http request failed|econnreset|etimedout|enotfound|eai_again|socket hang up|network|timeout)/i;

// Returns true when an error is a transient infrastructure failure that callers
// should retry.  Covers:
//   - HTTP 5xx  (server errors)
//   - HTTP 429  (rate limit) and 408 (request timeout)
//   - Network errors identified by message pattern (no status code)
//
// Domain-specific extras (e.g. GitHub 403 secondary-rate-limit, k8s 401
// auth-refresh) belong in the thin per-domain wrappers that call this.
export function isTransientError(err: unknown): boolean {
  const statusCode = getStatusCode(err as StatusCodeError);
  if (statusCode !== undefined) {
    return statusCode >= 500 || TRANSIENT_STATUS_CODES.has(statusCode);
  }

  // No status code → classify by message.
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err);
  return NETWORK_ERROR_REGEX.test(message);
}
