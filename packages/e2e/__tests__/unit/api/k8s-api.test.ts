import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';

import { createK8sApi } from '../../../src/api/k8s-api';
import { E2EState } from '../../../src/api/state';
import * as crd from '../../../src/k8s/crd';

const NAMESPACED_INFO = {
  plural: 'firestartrgithubrepositories',
  namespaced: true,
};

const tempDirs: string[] = [];

function makeCustomApi(overrides: Partial<k8s.CustomObjectsApi> = {}) {
  return {
    createNamespacedCustomObject: jest.fn().mockResolvedValue({}),
    getNamespacedCustomObject: jest
      .fn()
      .mockResolvedValue({ kind: 'FirestartrGithubRepository' }),
    replaceNamespacedCustomObject: jest.fn().mockResolvedValue({}),
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

async function writeRepositoryManifest(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-apply-'));
  tempDirs.push(tempDir);
  const manifestPath = path.join(tempDir, 'repository.yaml');
  await fs.writeFile(
    manifestPath,
    common.io.toYaml({
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubRepository',
      metadata: {
        name: 'repo-a',
      },
      spec: {
        branchProtections: [
          {
            branch: 'main',
          },
        ],
      },
    }),
    'utf-8',
  );
  return manifestPath;
}

describe('k8s api', () => {
  beforeEach(() => {
    jest
      .spyOn(crd, 'resolveCustomResourceInfo')
      .mockResolvedValue(NAMESPACED_INFO);
    jest.spyOn(common.logger, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await Promise.all(
      tempDirs.map((tempDir) =>
        fs.rm(tempDir, { recursive: true, force: true }),
      ),
    );
  });

  it('applies manifests in the configured namespace', async () => {
    const customApi = makeCustomApi();
    const state = new E2EState({
      org: 'firestartr-e2e',
      namespace: 'default',
      prefix: 'unit',
      kubeConfigProvider: makeProvider(customApi),
    });

    const api = createK8sApi(state);
    await api.applyCr(await writeRepositoryManifest());

    expect(customApi.createNamespacedCustomObject).toHaveBeenCalledWith({
      group: 'firestartr.dev',
      version: 'v1',
      namespace: 'default',
      plural: NAMESPACED_INFO.plural,
      body: expect.objectContaining({
        kind: 'FirestartrGithubRepository',
        metadata: expect.objectContaining({ namespace: 'default' }),
      }),
    });
  });

  it('lists custom resources by annotation through the same client chain', async () => {
    const item = {
      apiVersion: 'firestartr.dev/v1',
      kind: 'FirestartrGithubRepository',
      metadata: {
        name: 'repo-a',
        annotations: { 'firestartr.dev/claim-ref': 'ComponentClaim/repo-a' },
      },
    };
    const customApi = makeCustomApi({
      listNamespacedCustomObject: jest
        .fn()
        .mockResolvedValue({ items: [item] }),
    });
    const state = new E2EState({
      org: 'firestartr-e2e',
      namespace: 'default',
      prefix: 'unit',
      kubeConfigProvider: makeProvider(customApi),
    });

    const api = createK8sApi(state);
    const resources = await api.listCustomResourcesByAnnotation({
      kind: 'FirestartrGithubRepository',
      apiVersion: 'firestartr.dev/v1',
      annotationKey: 'firestartr.dev/claim-ref',
      annotationValues: ['ComponentClaim/repo-a'],
    });

    expect(resources).toEqual([item]);
    expect(customApi.listNamespacedCustomObject).toHaveBeenCalledWith({
      group: 'firestartr.dev',
      version: 'v1',
      namespace: 'default',
      plural: NAMESPACED_INFO.plural,
    });
  });
});
