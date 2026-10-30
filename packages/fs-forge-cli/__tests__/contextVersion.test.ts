import { describe, expect, it, jest } from '@jest/globals';

import { latestCliVersion } from '../src/context/version';

import type { FetchLike } from '../src/context/version';

function fetchReturning(body: unknown, ok = true): FetchLike {
  return jest.fn(async () => ({
    ok,
    json: async () => body,
  }));
}

describe('cli version lookup', () => {
  it('reads the registry dist-tag latest for the CLI package', async () => {
    const fetch = fetchReturning({ version: '2.0.1' });

    await expect(latestCliVersion({ fetch })).resolves.toBe('2.0.1');
    expect(fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@firestartr/fs-forge-cli/latest',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns null instead of throwing when the registry fails', async () => {
    const failing: FetchLike = jest.fn(async () => {
      throw new Error('offline');
    });
    const notFound = fetchReturning({}, false);
    const garbled = fetchReturning({ unexpected: true });

    await expect(latestCliVersion({ fetch: failing })).resolves.toBeNull();
    await expect(latestCliVersion({ fetch: notFound })).resolves.toBeNull();
    await expect(latestCliVersion({ fetch: garbled })).resolves.toBeNull();
  });

  it('bounds the lookup with a short timeout', async () => {
    const fetch = fetchReturning({ version: '2.0.1' });

    await latestCliVersion({ fetch, timeoutMs: 10 });

    const [, init] = (fetch as unknown as jest.Mock).mock.calls[0] as [
      string,
      { signal: AbortSignal },
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });
});
