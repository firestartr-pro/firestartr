import common from 'catalog_common';
import { forceDeleteCr } from '../../../src/k8s/force-delete';
import * as wait from '../../../src/k8s/wait';

import type { CrHandle } from '../../../src/k8s/cr-handle';

function makeHandle(overrides: Partial<CrHandle> = {}): CrHandle {
  return {
    info: { plural: 'myresources', namespaced: true },
    apiVersion: API_VERSION,
    kind: KIND,
    provider: PROVIDER,
    read: jest.fn(),
    list: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    patch: jest.fn().mockResolvedValue(undefined),
    clearFinalizers: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as CrHandle;
}

const PROVIDER = jest.fn();
const NS = 'test-ns';
const NAME = 'my-resource';
const API_VERSION = 'example.com/v1';
const KIND = 'MyResource';
const TIMEOUT = 30;

describe('forceDeleteCr', () => {
  let waitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(common.logger, 'warn').mockImplementation(() => undefined);
    waitSpy = jest
      .spyOn(wait, 'waitForResourceDeletion')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls delete → clearFinalizers → delete → waitForResourceDeletion in order', async () => {
    const calls: string[] = [];
    const handle = makeHandle({
      delete: jest
        .fn()
        .mockImplementation(() => Promise.resolve(calls.push('delete'))),
      clearFinalizers: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(calls.push('clearFinalizers')),
        ),
    });
    waitSpy.mockImplementation(async () => {
      calls.push('wait');
    });

    await forceDeleteCr(handle, NS, NAME, TIMEOUT);

    expect(calls).toEqual(['delete', 'clearFinalizers', 'delete', 'wait']);
  });

  it('passes correct resource shape to waitForResourceDeletion', async () => {
    const handle = makeHandle();

    await forceDeleteCr(handle, NS, NAME, TIMEOUT);

    expect(waitSpy).toHaveBeenCalledWith(
      PROVIDER,
      NS,
      {
        apiVersion: API_VERSION,
        kind: KIND,
        metadata: { name: NAME, namespace: NS },
      },
      TIMEOUT,
    );
  });

  it('tolerates 404 on delete and continues (idempotent — already absent)', async () => {
    const handle = makeHandle({
      delete: jest
        .fn()
        .mockRejectedValue({ statusCode: 404, message: 'Not Found' }),
    });

    await expect(
      forceDeleteCr(handle, NS, NAME, TIMEOUT),
    ).resolves.toBeUndefined();

    // clearFinalizers and wait still called
    expect(handle.clearFinalizers).toHaveBeenCalledTimes(1);
    expect(waitSpy).toHaveBeenCalledTimes(1);
  });

  it('tolerates 410 on delete and continues', async () => {
    const handle = makeHandle({
      delete: jest.fn().mockRejectedValue({ statusCode: 410, message: 'Gone' }),
    });

    await expect(
      forceDeleteCr(handle, NS, NAME, TIMEOUT),
    ).resolves.toBeUndefined();

    expect(handle.clearFinalizers).toHaveBeenCalledTimes(1);
    expect(waitSpy).toHaveBeenCalledTimes(1);
  });

  it('tolerates 404 on clearFinalizers and continues to re-delete + wait', async () => {
    const handle = makeHandle({
      clearFinalizers: jest
        .fn()
        .mockRejectedValue({ statusCode: 404, message: 'Not Found' }),
    });

    await expect(
      forceDeleteCr(handle, NS, NAME, TIMEOUT),
    ).resolves.toBeUndefined();

    expect(handle.delete).toHaveBeenCalledTimes(2);
    expect(waitSpy).toHaveBeenCalledTimes(1);
  });

  it('warns (does not throw) on unexpected error from delete', async () => {
    const handle = makeHandle({
      delete: jest
        .fn()
        .mockRejectedValue({ statusCode: 500, message: 'Server Error' }),
    });

    await expect(
      forceDeleteCr(handle, NS, NAME, TIMEOUT),
    ).resolves.toBeUndefined();

    expect(common.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(KIND),
    );
    // continues to clearFinalizers
    expect(handle.clearFinalizers).toHaveBeenCalledTimes(1);
  });

  it('warns (does not throw) on unexpected error from clearFinalizers', async () => {
    const handle = makeHandle({
      clearFinalizers: jest
        .fn()
        .mockRejectedValue({ statusCode: 500, message: 'Server Error' }),
    });

    await expect(
      forceDeleteCr(handle, NS, NAME, TIMEOUT),
    ).resolves.toBeUndefined();

    expect(common.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('finalizers'),
    );
    // second delete and wait still called
    expect(handle.delete).toHaveBeenCalledTimes(2);
    expect(waitSpy).toHaveBeenCalledTimes(1);
  });
});
