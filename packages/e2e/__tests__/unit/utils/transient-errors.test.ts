import { isTransientError } from '../../../src/utils/transient-errors';

describe('isTransientError', () => {
  // ── HTTP status codes ──────────────────────────────────────────────────────

  describe('5xx server errors', () => {
    it.each([500, 502, 503, 504, 599])(
      'returns true for status %d',
      (status) => {
        expect(isTransientError({ status })).toBe(true);
      },
    );
  });

  describe('transient non-5xx codes', () => {
    it('returns true for 408 (request timeout)', () => {
      expect(isTransientError({ status: 408 })).toBe(true);
    });

    it('returns true for 429 (rate limit)', () => {
      expect(isTransientError({ status: 429 })).toBe(true);
    });
  });

  describe('non-transient status codes', () => {
    it.each([400, 401, 403, 404, 409, 422, 423])(
      'returns false for status %d',
      (status) => {
        expect(isTransientError({ status })).toBe(false);
      },
    );
  });

  // ── Network-error message patterns (no status code) ───────────────────────

  describe('network error messages', () => {
    it.each([
      'http request failed',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'socket hang up',
      'network error occurred',
      'operation timeout',
    ])('returns true for message: %s', (message) => {
      expect(isTransientError(new Error(message))).toBe(true);
    });
  });

  // ── Non-matching cases ─────────────────────────────────────────────────────

  describe('non-transient errors', () => {
    it('returns false for a plain unknown error message', () => {
      expect(isTransientError(new Error('something broke'))).toBe(false);
    });

    it('returns false for a string primitive', () => {
      expect(isTransientError('some string error')).toBe(false);
    });

    it('returns false for null', () => {
      expect(isTransientError(null)).toBe(false);
    });

    it('returns false for an object with no status and no matching message', () => {
      expect(isTransientError({ message: 'permission denied' })).toBe(false);
    });
  });

  // ── status code wins over message ─────────────────────────────────────────

  it('uses status code (not message) when both are present', () => {
    // 404 with a "timeout" message — not transient because status says 404
    expect(isTransientError({ status: 404, message: 'ETIMEDOUT' })).toBe(false);
  });

  it('falls back to message when status is undefined', () => {
    expect(isTransientError({ message: 'ECONNRESET reading stream' })).toBe(
      true,
    );
  });
});
