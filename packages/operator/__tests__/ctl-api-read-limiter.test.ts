jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    silly: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../src/connection', () => ({
  __esModule: true,
  getConnection: jest.fn(),
}));

import { getConnection } from '../src/connection';
import {
  getCurrentConcurrentApiCalls,
  getPendingApiCalls,
  getPeakConcurrentApiCalls,
  computeMaxConcurrentApiCalls,
} from '../src/utils/api-read-limiter';
import {
  getItemByItemPath,
  getItemByItemPathOrNull,
} from '../src/ctl';

function response(ok: boolean, statusText: string, body: any, status = 200) {
  return {
    ok,
    status,
    statusText,
    json: jest.fn(async () => body),
  };
}

describe('computeMaxConcurrentApiCalls', () => {
  it('returns default when no env vars are set', () => {
    expect(computeMaxConcurrentApiCalls(undefined, undefined)).toBe(50);
  });

  it('respects explicit MAX_CONCURRENT_API_CALLS when above minimum', () => {
    expect(computeMaxConcurrentApiCalls('25', '1')).toBe(25);
    expect(computeMaxConcurrentApiCalls('30', '5')).toBe(30);
  });

  it('enforces minimum to prevent deadlock when explicit value is too low', () => {
    expect(computeMaxConcurrentApiCalls('5', '5')).toBe(20);
    expect(computeMaxConcurrentApiCalls('10', '10')).toBe(40);
  });

  it('uses default when MAX_CONCURRENT_API_CALLS is invalid', () => {
    expect(computeMaxConcurrentApiCalls('invalid', '1')).toBe(50);
    expect(computeMaxConcurrentApiCalls('-5', '1')).toBe(50);
    expect(computeMaxConcurrentApiCalls('0', '1')).toBe(50);
  });

  it('treats undefined MAX_SLOTS as 1', () => {
    expect(computeMaxConcurrentApiCalls(undefined, undefined)).toBe(50);
    expect(computeMaxConcurrentApiCalls('10', undefined)).toBe(10);
  });

  it('treats invalid MAX_SLOTS as 1', () => {
    expect(computeMaxConcurrentApiCalls('10', 'invalid')).toBe(10);
    expect(computeMaxConcurrentApiCalls('10', '-5')).toBe(10);
    expect(computeMaxConcurrentApiCalls('10', '0')).toBe(10);
  });

  it('raises default when MAX_SLOTS requires more than default', () => {
    expect(computeMaxConcurrentApiCalls(undefined, '10')).toBe(50);
  });
});

describe('ctl api read limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getConnection as jest.Mock).mockResolvedValue({
      kc: {
        currentContext: 'default',
        contexts: [{name: 'default', cluster: 'default'}],
        clusters: [{name: 'default', server: 'https://k8s.test'}],
      },
      opts: {headers: {}},
    });
    global.fetch = jest.fn();
  });

  it('routes both read paths through the shared limiter and updates counters', async () => {
    const deferredResponses: Array<() => void> = [];

    (global.fetch as jest.Mock).mockImplementation(() => {
      return new Promise((resolve) => {
        deferredResponses.push(() => resolve(response(true, 'OK', {name: 'a'})));
      });
    });

    const requests: Array<Promise<any>> = [];

    for (let i = 0; i < 13; i++) {
      requests.push(getItemByItemPath(`default/kind/item-${i}`));
      requests.push(getItemByItemPathOrNull(`default/kind/item-null-${i}`));
    }

    await Promise.resolve();
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledTimes(26);
    expect(getPeakConcurrentApiCalls()).toBe(26);
    expect(getCurrentConcurrentApiCalls()).toBe(26);
    expect(getPendingApiCalls()).toBe(0);

    deferredResponses[0]();
    await requests[0];
    await Promise.resolve();

    expect(global.fetch).toHaveBeenCalledTimes(26);
    expect(getCurrentConcurrentApiCalls()).toBe(25);
    expect(getPendingApiCalls()).toBe(0);

    for (let i = 1; i < deferredResponses.length; i++) {
      deferredResponses[i]();
    }

    await Promise.all(requests);

    expect(getCurrentConcurrentApiCalls()).toBe(0);
    expect(getPendingApiCalls()).toBe(0);
  });
});
