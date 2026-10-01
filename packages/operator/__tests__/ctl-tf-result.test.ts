jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    error: jest.fn(),
    silly: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@kubernetes/client-node', () => ({
  __esModule: true,
  KubeConfig: jest.fn().mockImplementation(() => ({
    loadFromDefault: jest.fn(),
    applyToHTTPSOptions: jest.fn(async (opts: any) => {
      opts.headers = {};
    }),
    currentContext: 'default',
    contexts: [{name: 'default', cluster: 'default'}],
    clusters: [{name: 'default', server: 'https://k8s.test'}],
    makeApiClient: jest.fn(),
  })),
  CoreV1Api: jest.fn(),
}));

import log from '../src/logger';
import {upsertResult} from '../src/ctl';

const item = {
  kind: 'FirestartrGithubGroup',
  metadata: {
    name: 'group-a',
    namespace: 'default',
  },
};

function response(ok: boolean, statusText: string, body: any, status = 200) {
  return {
    ok,
    status,
    statusText,
    json: jest.fn(async () => body),
  };
}

describe('TFResult ctl compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it('creates TFResult and writes status when the status subresource exists', async () => {
    const created = {
      metadata: {
        name: 'firestartrgithubgroup-group-a',
        resourceVersion: '10',
      },
      spec: {
        result: 'ok',
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(false, 'Not Found', {}, 404))
      .mockResolvedValueOnce(response(true, 'Created', created, 201))
      .mockResolvedValueOnce(response(true, 'OK', {...created, status: {}}, 200));

    await expect(upsertResult('default', item, 'ok', 0)).resolves.toBe(created);

    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://k8s.test/apis/firestartr.dev/v1/namespaces/default/tfresults/firestartrgithubgroup-group-a/status',
      expect.objectContaining({method: 'PUT'}),
    );
  });

  it('keeps TFResult creation successful when old CRDs do not expose status', async () => {
    const created = {
      metadata: {
        name: 'firestartrgithubgroup-group-a',
        resourceVersion: '11',
      },
      spec: {
        result: 'ok',
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(false, 'Not Found', {}, 404))
      .mockResolvedValueOnce(response(true, 'Created', created, 201))
      .mockResolvedValueOnce(response(false, 'Not Found', {}, 404));

    await expect(upsertResult('default', item, 'ok', 0)).resolves.toBe(created);

    expect(log.warn).toHaveBeenCalledWith(
      'TFResult status subresource unavailable; keeping result in spec only. TFResult/firestartrgithubgroup-group-a',
    );
  });

  it('still fails when TFResult status write fails for reasons other than missing status subresource', async () => {
    const created = {
      metadata: {
        name: 'firestartrgithubgroup-group-a',
        resourceVersion: '12',
      },
      spec: {
        result: 'ok',
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(false, 'Not Found', {}, 404))
      .mockResolvedValueOnce(response(true, 'Created', created, 201))
      .mockResolvedValueOnce(response(false, 'Forbidden', {}, 403));

    await expect(upsertResult('default', item, 'ok', 0)).rejects.toBe(
      'Forbidden',
    );
  });

  it('falls back to update on 409 conflict during TFResult creation', async () => {
    const existing = {
      metadata: {
        name: 'firestartrgithubgroup-group-a',
        resourceVersion: '10',
      },
      spec: {
        result: 'previous-output',
        reference: {
          refKind: 'FirestartrGithubGroup',
          refName: 'group-a',
        },
      },
    };

    const updated = {
      ...existing,
      spec: {
        ...existing.spec,
        result: 'ok',
      },
      metadata: {
        ...existing.metadata,
        resourceVersion: '11',
      },
    };

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(response(false, 'Not Found', {}, 404))
      .mockResolvedValueOnce(response(false, 'Conflict', {}, 409))
      .mockResolvedValueOnce(response(true, 'OK', existing, 200))
      .mockResolvedValueOnce(response(true, 'OK', updated, 200))
      .mockResolvedValueOnce(response(true, 'OK', {...updated, status: {}}, 200));

    await expect(upsertResult('default', item, 'ok', 0)).resolves.toMatchObject({
      spec: {result: 'ok'},
    });

    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect((global.fetch as jest.Mock).mock.calls[1][1].method).toBe('POST');
    expect((global.fetch as jest.Mock).mock.calls[2][0]).toBe(
      'https://k8s.test/apis/firestartr.dev/v1/namespaces/default/tfresults/firestartrgithubgroup-group-a',
    );
    expect((global.fetch as jest.Mock).mock.calls[2][1].method).toBe('GET');
    expect((global.fetch as jest.Mock).mock.calls[3][1].method).toBe('PUT');
    expect((global.fetch as jest.Mock).mock.calls[4][0]).toContain('/status');
    expect((global.fetch as jest.Mock).mock.calls[4][1].method).toBe('PUT');
  });
});
