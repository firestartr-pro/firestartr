import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';
import { resolveCrHandle } from '../../../src/k8s/cr-handle';
import {
  JSON_PATCH_HEADERS,
  MERGE_PATCH_HEADERS,
} from '../../../src/k8s/constants';
import * as crd from '../../../src/k8s/crd';

const NAMESPACED_INFO = { plural: 'myresources', namespaced: true };
const CLUSTER_INFO = { plural: 'clusterresources', namespaced: false };

function makeCustomApi(overrides: Partial<k8s.CustomObjectsApi> = {}) {
  return {
    getNamespacedCustomObject: jest
      .fn()
      .mockResolvedValue({ kind: 'MyResource' }),
    getClusterCustomObject: jest
      .fn()
      .mockResolvedValue({ kind: 'ClusterResource' }),
    listNamespacedCustomObject: jest.fn().mockResolvedValue({ items: [] }),
    listClusterCustomObject: jest.fn().mockResolvedValue({ items: [] }),
    deleteNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    deleteClusterCustomObject: jest.fn().mockResolvedValue({}),
    patchNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    patchClusterCustomObject: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as k8s.CustomObjectsApi;
}

// Build a provider whose kubeConfig.makeApiClient returns the given customApi.
function makeProvider(api: k8s.CustomObjectsApi) {
  const kubeConfig = {
    makeApiClient: jest.fn().mockReturnValue(api),
  } as unknown as k8s.KubeConfig;
  return jest.fn().mockReturnValue(kubeConfig);
}

describe('resolveCrHandle', () => {
  let resolveSpy: jest.SpyInstance;
  let customApi: ReturnType<typeof makeCustomApi>;
  let provider: ReturnType<typeof makeProvider>;

  beforeEach(() => {
    jest.spyOn(common.logger, 'warn').mockImplementation(() => undefined);
    customApi = makeCustomApi();
    provider = makeProvider(customApi);
    resolveSpy = jest
      .spyOn(crd, 'resolveCustomResourceInfo')
      .mockResolvedValue(NAMESPACED_INFO);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes CrdInfo on handle.info', async () => {
    const handle = await resolveCrHandle(
      provider,
      'example.com/v1',
      'MyResource',
    );
    expect(handle.info).toEqual(NAMESPACED_INFO);
  });

  describe('read — namespaced', () => {
    it('calls getNamespacedCustomObject with resolved plural', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      const result = await handle.read('ns1', 'foo');

      expect(customApi.getNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        namespace: 'ns1',
        plural: 'myresources',
        name: 'foo',
      });
      expect(result).toEqual({ kind: 'MyResource' });
    });

    it('throws when namespace is omitted for a namespaced resource', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await expect(handle.read(undefined, 'foo')).rejects.toThrow(
        'Namespace is required for MyResource/foo',
      );
    });
  });

  describe('read — cluster-scoped', () => {
    beforeEach(() => {
      resolveSpy.mockResolvedValue(CLUSTER_INFO);
    });

    it('calls getClusterCustomObject', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'ClusterResource',
      );
      await handle.read(undefined, 'bar');

      expect(customApi.getClusterCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        plural: 'clusterresources',
        name: 'bar',
      });
    });
  });

  describe('list — namespaced', () => {
    it('calls listNamespacedCustomObject without labelSelector', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      const items = await handle.list('ns1');

      expect(customApi.listNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        namespace: 'ns1',
        plural: 'myresources',
      });
      expect(items).toEqual([]);
    });

    it('passes labelSelector as positional arg when provided', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await handle.list('ns1', 'app=test');

      expect(customApi.listNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        namespace: 'ns1',
        plural: 'myresources',
        labelSelector: 'app=test',
      });
    });

    it('returns items from the response body', async () => {
      const fakeItem = { kind: 'MyResource', metadata: { name: 'a' } };
      (customApi.listNamespacedCustomObject as jest.Mock).mockResolvedValue({
        items: [fakeItem],
      });

      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      const items = await handle.list('ns1');
      expect(items).toEqual([fakeItem]);
    });

    it('throws when namespace is omitted', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await expect(handle.list(undefined)).rejects.toThrow(
        'Namespace is required to list MyResource',
      );
    });
  });

  describe('list — cluster-scoped', () => {
    beforeEach(() => {
      resolveSpy.mockResolvedValue(CLUSTER_INFO);
    });

    it('calls listClusterCustomObject', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'ClusterResource',
      );
      await handle.list(undefined);

      expect(customApi.listClusterCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        plural: 'clusterresources',
      });
    });
  });

  describe('delete — namespaced', () => {
    it('calls deleteNamespacedCustomObject', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await handle.delete('ns1', 'foo');

      expect(customApi.deleteNamespacedCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        namespace: 'ns1',
        plural: 'myresources',
        name: 'foo',
      });
    });
  });

  describe('delete — cluster-scoped', () => {
    beforeEach(() => {
      resolveSpy.mockResolvedValue(CLUSTER_INFO);
    });

    it('calls deleteClusterCustomObject', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'ClusterResource',
      );
      await handle.delete(undefined, 'bar');

      expect(customApi.deleteClusterCustomObject).toHaveBeenCalledWith({
        group: 'example.com',
        version: 'v1',
        plural: 'clusterresources',
        name: 'bar',
      });
    });
  });

  describe('patch — namespaced', () => {
    it('calls patchNamespacedCustomObject with MERGE_PATCH headers', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await handle.patch('ns1', 'foo', { metadata: { labels: { x: 'y' } } });

      expect(customApi.patchNamespacedCustomObject).toHaveBeenCalledWith(
        {
          group: 'example.com',
          version: 'v1',
          namespace: 'ns1',
          plural: 'myresources',
          name: 'foo',
          body: { metadata: { labels: { x: 'y' } } },
        },
        MERGE_PATCH_HEADERS,
      );
    });
  });

  describe('patch — cluster-scoped', () => {
    beforeEach(() => {
      resolveSpy.mockResolvedValue(CLUSTER_INFO);
    });

    it('calls patchClusterCustomObject with MERGE_PATCH headers', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'ClusterResource',
      );
      await handle.patch(undefined, 'bar', {
        metadata: { annotations: { a: 'b' } },
      });

      expect(customApi.patchClusterCustomObject).toHaveBeenCalledWith(
        {
          group: 'example.com',
          version: 'v1',
          plural: 'clusterresources',
          name: 'bar',
          body: { metadata: { annotations: { a: 'b' } } },
        },
        MERGE_PATCH_HEADERS,
      );
    });
  });

  describe('clearFinalizers', () => {
    it('patches with empty finalizers array', async () => {
      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await handle.clearFinalizers('ns1', 'foo');

      expect(customApi.patchNamespacedCustomObject).toHaveBeenCalledWith(
        {
          group: 'example.com',
          version: 'v1',
          namespace: 'ns1',
          plural: 'myresources',
          name: 'foo',
          body: [
            {
              op: 'replace',
              path: '/metadata/finalizers',
              value: [],
            },
          ],
        },
        JSON_PATCH_HEADERS,
      );
    });
  });

  describe('401 retry', () => {
    it('resets the client and retries once on unauthorized read', async () => {
      (customApi.getNamespacedCustomObject as jest.Mock)
        .mockRejectedValueOnce({ statusCode: 401, message: 'unauthorized' })
        .mockResolvedValueOnce({
          kind: 'MyResource',
          metadata: { name: 'foo' },
        });

      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      const result = await handle.read('ns1', 'foo');

      expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ kind: 'MyResource', metadata: { name: 'foo' } });
      expect(common.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Unauthorized while reading MyResource/foo'),
      );
    });

    it('re-throws after exhausting retry attempts', async () => {
      const unauth = { statusCode: 401, message: 'unauthorized' };
      (customApi.getNamespacedCustomObject as jest.Mock)
        .mockRejectedValueOnce(unauth)
        .mockRejectedValueOnce(unauth)
        .mockRejectedValueOnce(unauth);

      const handle = await resolveCrHandle(
        provider,
        'example.com/v1',
        'MyResource',
      );
      await expect(handle.read('ns1', 'foo')).rejects.toMatchObject({
        statusCode: 401,
      });
      // attempts = UNAUTHORIZED_RETRY_ATTEMPTS + 1 = 3
      expect(customApi.getNamespacedCustomObject).toHaveBeenCalledTimes(3);
    });
  });
});
