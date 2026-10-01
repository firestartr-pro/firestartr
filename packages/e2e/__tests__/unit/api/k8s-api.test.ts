import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';

import { createK8sApi } from '../../../src/api/k8s-api';
import { E2EState } from '../../../src/api/state';

import type { K8sClient } from '../../../src/k8s/types';

const tempDirs: string[] = [];

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
  afterAll(async () => {
    await Promise.all(
      tempDirs.map((tempDir) =>
        fs.rm(tempDir, { recursive: true, force: true }),
      ),
    );
  });

  it('applies manifests in the configured namespace', async () => {
    const state = new E2EState({
      org: 'firestartr-e2e',
      namespace: 'default',
      prefix: 'unit',
      kubeConfigProvider: () => {
        throw new Error('kube config should not be requested');
      },
    });
    const apply = jest.fn(async () => {});
    const k8sClient: K8sClient = {
      apply,
      delete: async () => {},
      waitFor: async () => ({
        apiVersion: 'firestartr.dev/v1',
        kind: 'FirestartrGithubRepository',
      }),
    };

    const api = createK8sApi(state, k8sClient);
    await api.applyCr(await writeRepositoryManifest());

    expect(apply).toHaveBeenCalledWith(expect.any(String), 'default');
  });
});
