jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/retry.debug', () => ({
  __esModule: true,
  initRetryDebug: jest.fn(),
  writeEventIfNew: jest.fn(),
}));

jest.mock('../src/ctl', () => ({
  __esModule: true,
  getItemByItemPath: jest.fn(),
}));

import { retry, removeFromRetry, getMaxRetry } from '../src/retry';

const SET_ITEM_PATH = '/path/item';

describe('retry', () => {
  let setTimeoutSpy: jest.SpyInstance;
  let clearTimeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((() => 123) as any);
    clearTimeoutSpy = jest
      .spyOn(global, 'clearTimeout')
      .mockImplementation(() => {});
    delete process.env.OPERATOR_NEXT_RETRY_MS;
    delete process.env.OPERATOR_MAX_RETRY;
  });

  afterEach(() => {
    removeFromRetry(SET_ITEM_PATH);
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
    delete process.env.OPERATOR_NEXT_RETRY_MS;
    delete process.env.OPERATOR_MAX_RETRY;
  });

  describe('UC6 — MAXRETRY enforcement', () => {
    it('stops scheduling retries after the configured limit', () => {
      process.env.OPERATOR_NEXT_RETRY_MS = '10';
      process.env.OPERATOR_MAX_RETRY = '3';

      const maxRetry = getMaxRetry();

      for (let i = 0; i < maxRetry; i++) {
        retry(SET_ITEM_PATH);
      }

      expect(setTimeoutSpy).toHaveBeenCalledTimes(maxRetry);

      setTimeoutSpy.mockClear();

      retry(SET_ITEM_PATH);

      expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('respects the default limit of 5 when no env var is set', () => {
      process.env.OPERATOR_NEXT_RETRY_MS = '10';

      const maxRetry = getMaxRetry();
      expect(maxRetry).toBe(5);

      for (let i = 0; i < maxRetry; i++) {
        retry(SET_ITEM_PATH);
      }

      expect(setTimeoutSpy).toHaveBeenCalledTimes(maxRetry);

      setTimeoutSpy.mockClear();

      retry(SET_ITEM_PATH);

      expect(setTimeoutSpy).not.toHaveBeenCalled();
    });
  });

  describe('UC4 — removeFromRetry resets counter to 0', () => {
    it('reverts to base delay after removeFromRetry', () => {
      process.env.OPERATOR_NEXT_RETRY_MS = '50';

      retry(SET_ITEM_PATH);
      const baseDelay = setTimeoutSpy.mock.calls[0][1];

      retry(SET_ITEM_PATH);
      const doubledDelay = setTimeoutSpy.mock.calls[1][1];
      expect(doubledDelay).toBe(baseDelay * 2);

      removeFromRetry(SET_ITEM_PATH);

      retry(SET_ITEM_PATH);
      const freshDelay = setTimeoutSpy.mock.calls[2][1];
      expect(freshDelay).toBe(baseDelay);
    });

    it('retry counter starts at 0 even after multiple removeFromRetry cycles', () => {
      process.env.OPERATOR_NEXT_RETRY_MS = '10';

      for (let cycle = 0; cycle < 3; cycle++) {
        retry(SET_ITEM_PATH);
        const expectedBaseDelay = 10 * Math.pow(2, 0);
        expect(setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1][1]).toBe(
          expectedBaseDelay,
        );

        removeFromRetry(SET_ITEM_PATH);
      }
    });
  });
});
