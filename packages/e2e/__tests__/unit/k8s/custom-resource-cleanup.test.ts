import * as k8s from '@kubernetes/client-node';

import * as crd from '../../../src/k8s/crd';
import { listCustomResourcesByAnnotation } from '../../../src/k8s/custom-resource-cleanup';

const NAMESPACED_INFO = { plural: 'myresources', namespaced: true };

function makeCustomApi(overrides: Partial<k8s.CustomObjectsApi> = {}) {
  return {
    listNamespacedCustomObject: jest.fn().mockResolvedValue({ items: [] }),
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

const ANNOTATION_KEY = 'firestartr.dev/claim-ref';

function resource(name: string, claimRef?: string) {
  return {
    apiVersion: 'example.com/v1',
    kind: 'MyResource',
    metadata: {
      name,
      ...(claimRef
        ? { annotations: { [ANNOTATION_KEY]: claimRef } }
        : undefined),
    },
  };
}

describe('listCustomResourcesByAnnotation', () => {
  beforeEach(() => {
    jest
      .spyOn(crd, 'resolveCustomResourceInfo')
      .mockResolvedValue(NAMESPACED_INFO);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters namespaced custom resources by annotation value', async () => {
    const customApi = makeCustomApi({
      listNamespacedCustomObject: jest.fn().mockResolvedValue({
        items: [
          resource('a', 'GroupClaim/a'),
          resource('b', 'GroupClaim/b'),
          resource('c'),
        ],
      }),
    });

    const result = await listCustomResourcesByAnnotation(
      makeProvider(customApi),
      'ns1',
      'MyResource',
      'example.com/v1',
      ANNOTATION_KEY,
      ['GroupClaim/a'],
    );

    expect(result.map((item) => item.metadata?.name)).toEqual(['a']);
    expect(customApi.listNamespacedCustomObject).toHaveBeenCalledWith({
      group: 'example.com',
      version: 'v1',
      namespace: 'ns1',
      plural: NAMESPACED_INFO.plural,
    });
  });

  it('returns [] without listing when no annotation value is given', async () => {
    const customApi = makeCustomApi();

    const result = await listCustomResourcesByAnnotation(
      makeProvider(customApi),
      'ns1',
      'MyResource',
      'example.com/v1',
      ANNOTATION_KEY,
      ['  '],
    );

    expect(result).toEqual([]);
    expect(customApi.listNamespacedCustomObject).not.toHaveBeenCalled();
  });

  it('returns [] when the resource list is not found', async () => {
    const customApi = makeCustomApi({
      listNamespacedCustomObject: jest
        .fn()
        .mockRejectedValue({ statusCode: 404 }),
    });

    const result = await listCustomResourcesByAnnotation(
      makeProvider(customApi),
      'ns1',
      'MyResource',
      'example.com/v1',
      ANNOTATION_KEY,
      ['GroupClaim/a'],
    );

    expect(result).toEqual([]);
  });
});
