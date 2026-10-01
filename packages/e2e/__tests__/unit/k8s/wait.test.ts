import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';
import {
  createWaitFunction,
  waitForResourceDeletion,
} from '../../../src/k8s/wait';

describe('createWaitFunction', () => {
  let nowMs = 0;

  beforeEach(() => {
    nowMs = 0;

    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    jest.spyOn(common.generic, 'sleep').mockImplementation(async (delay) => {
      nowMs += delay;
    });
    jest.spyOn(common.logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes Kubernetes clients after unauthorized reads and retries', async () => {
    const read = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 401, message: 'unauthorized' })
      .mockResolvedValueOnce({
        apiVersion: 'v1',
        kind: 'ConfigMap',
        status: {
          conditions: [{ type: 'Ready', status: 'True' }],
        },
      });
    const api = { read } as unknown as k8s.KubernetesObjectApi;
    const makeApiClient = jest
      .spyOn(k8s.KubernetesObjectApi, 'makeApiClient')
      .mockReturnValue(api);
    const waitFor = createWaitFunction(() => ({}) as k8s.KubeConfig, 'default');

    const result = await waitFor('ConfigMap', 'demo', 'Ready', 10000, {
      apiVersion: 'v1',
      pollIntervalMs: 5000,
    });

    expect(result.status?.conditions?.[0]).toMatchObject({
      type: 'Ready',
      status: 'True',
    });
    expect(makeApiClient).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledWith(5000);
    expect(common.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Unauthorized while reading default/ConfigMap/demo',
      ),
    );
  });

  it('fails fast when the resource reports ERROR=True', async () => {
    const read = jest.fn().mockResolvedValue({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      status: {
        conditions: [
          {
            type: 'ERROR',
            status: 'True',
            reason: 'ApplyFailed',
            message: 'claim failed',
          },
        ],
      },
    });

    jest
      .spyOn(k8s.KubernetesObjectApi, 'makeApiClient')
      .mockReturnValue({ read } as unknown as k8s.KubernetesObjectApi);
    const waitFor = createWaitFunction(() => ({}) as k8s.KubeConfig, 'default');

    await expect(
      waitFor('ConfigMap', 'demo', 'PROVISIONED', 10000, {
        apiVersion: 'v1',
        pollIntervalMs: 5000,
      }),
    ).rejects.toThrow(
      "Resource default/ConfigMap/demo reported ERROR=True while waiting for status 'PROVISIONED'. reason='ApplyFailed' message='claim failed'.",
    );

    expect(common.generic.sleep).not.toHaveBeenCalled();
  });

  it('includes the last observed status in timeout errors', async () => {
    const read = jest.fn().mockResolvedValue({
      apiVersion: 'v1',
      kind: 'ConfigMap',
      status: {
        status: 'PENDING',
        conditions: [
          {
            type: 'Reconciling',
            status: 'True',
            reason: 'Waiting',
          },
        ],
      },
    });

    jest
      .spyOn(k8s.KubernetesObjectApi, 'makeApiClient')
      .mockReturnValue({ read } as unknown as k8s.KubernetesObjectApi);
    const waitFor = createWaitFunction(() => ({}) as k8s.KubeConfig, 'default');

    await expect(
      waitFor('ConfigMap', 'demo', 'PROVISIONED', 10000, {
        apiVersion: 'v1',
        pollIntervalMs: 5000,
      }),
    ).rejects.toThrow(
      "Timed out waiting for default/ConfigMap/demo to reach status 'PROVISIONED' after 10000ms. Last observed: status=PENDING conditions=[Reconciling=True(Waiting)].",
    );

    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('waitForResourceDeletion', () => {
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

  it('returns once the resource read reports 404', async () => {
    const read = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ statusCode: 404, message: 'not found' });

    jest
      .spyOn(k8s.KubernetesObjectApi, 'makeApiClient')
      .mockReturnValue({ read } as unknown as k8s.KubernetesObjectApi);

    await waitForResourceDeletion(
      () => ({}) as k8s.KubeConfig,
      'default',
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'demo' },
      },
      10,
    );

    expect(read).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledTimes(1);
    expect(common.generic.sleep).toHaveBeenCalledWith(5000);
  });

  it('retries transient delete probe errors before succeeding', async () => {
    const read = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 429, message: 'rate limited' })
      .mockRejectedValueOnce({ statusCode: 404, message: 'not found' });

    jest
      .spyOn(k8s.KubernetesObjectApi, 'makeApiClient')
      .mockReturnValue({ read } as unknown as k8s.KubernetesObjectApi);

    await waitForResourceDeletion(
      () => ({}) as k8s.KubeConfig,
      'default',
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'demo' },
      },
      10,
    );

    expect(read).toHaveBeenCalledTimes(2);
    expect(common.generic.sleep).toHaveBeenCalledTimes(1);
  });

  it('surfaces non-retryable probe errors with resource context', async () => {
    const read = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('bad request'), { statusCode: 400 }),
      );

    jest
      .spyOn(k8s.KubernetesObjectApi, 'makeApiClient')
      .mockReturnValue({ read } as unknown as k8s.KubernetesObjectApi);

    await expect(
      waitForResourceDeletion(
        () => ({}) as k8s.KubeConfig,
        'default',
        {
          apiVersion: 'v1',
          kind: 'ConfigMap',
          metadata: { name: 'demo' },
        },
        10,
      ),
    ).rejects.toThrow(
      'Failed while waiting for deletion of default/ConfigMap/demo: bad request',
    );
  });
});
