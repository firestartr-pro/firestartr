import common from 'catalog_common';
import { pollUntil, retryAsync } from '../../../src/utils/async-control';

describe('async-control', () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 0;

    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    jest.spyOn(common.generic, 'sleep').mockImplementation(async (delay) => {
      nowMs += delay;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries async work with backoff delays', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'))
      .mockResolvedValue('done');
    const onRetry = jest.fn();

    const result = await retryAsync(run, {
      attempts: 3,
      shouldRetry: () => true,
      getDelayMs: (_error, attempt) => attempt * 100,
      onRetry,
    });

    expect(result).toBe('done');
    expect(run).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 100);
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 200);
    expect(common.generic.sleep).toHaveBeenNthCalledWith(1, 100);
    expect(common.generic.sleep).toHaveBeenNthCalledWith(2, 200);
  });

  it('polls until a retryable probe error is cleared', async () => {
    const probe = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce('ready');

    const result = await pollUntil(probe, {
      timeoutMs: 1000,
      intervalMs: 250,
      isDone: (value) => value === 'ready',
      shouldRetryError: (error) =>
        error instanceof Error && error.message === 'temporary',
    });

    expect(result).toBe('ready');
    expect(probe).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledWith(250);
  });

  it('uses the last observed value in timeout errors', async () => {
    const probe = jest
      .fn()
      .mockResolvedValueOnce('pending-a')
      .mockResolvedValueOnce('pending-b');

    await expect(
      pollUntil(probe, {
        timeoutMs: 1000,
        intervalMs: 500,
        isDone: () => false,
        createTimeoutError: (lastValue) =>
          new Error(`timed out after last=${lastValue ?? 'none'}`),
      }),
    ).rejects.toThrow('timed out after last=pending-b');
  });
});
