import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';
import {
  prepareProviderConfigManifests,
  resolveE2eProviderConfigsPath,
} from '../..';
import {
  TF_BACKEND_PROVIDER_NAME,
  TF_PROVIDER_NAME,
} from '../../src/test-constants';

type ProviderConfigManifest = {
  metadata?: {
    name?: string;
    namespace?: string;
  };
  spec?: {
    config?: string;
  };
};

describe('prepareProviderConfigManifests', () => {
  it('stamps provider names and namespace into prepared manifests', async () => {
    const sourceDir = resolveE2eProviderConfigsPath();
    const tempDir = await prepareProviderConfigManifests(sourceDir, 'demo-ns');

    try {
      const backendManifest = common.io.fromYaml(
        await fs.readFile(
          path.join(tempDir, 'kubernetes-backend.yaml'),
          'utf-8',
        ),
      ) as ProviderConfigManifest;
      const providerManifest = common.io.fromYaml(
        await fs.readFile(path.join(tempDir, 'kubernetes.yaml'), 'utf-8'),
      ) as ProviderConfigManifest;

      expect(backendManifest.metadata).toMatchObject({
        name: TF_BACKEND_PROVIDER_NAME,
        namespace: 'demo-ns',
      });
      expect(JSON.parse(backendManifest.spec?.config ?? '{}')).toMatchObject({
        namespace: 'demo-ns',
      });

      expect(providerManifest.metadata).toMatchObject({
        name: TF_PROVIDER_NAME,
        namespace: 'demo-ns',
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when a required provider-config fixture is missing', async () => {
    const sourceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'e2e-provider-configs-missing-'),
    );

    try {
      await fs.writeFile(
        path.join(sourceDir, 'kubernetes.yaml'),
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrProviderConfig',
          metadata: { name: 'kubernetes' },
          spec: {
            type: 'kubernetes',
            config: '{}',
          },
        }),
        'utf-8',
      );

      await expect(
        prepareProviderConfigManifests(sourceDir, 'demo-ns'),
      ).rejects.toThrow(/kubernetes-backend\.yaml/);
    } finally {
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  });

  it('fails when backend spec.config is not valid JSON', async () => {
    const sourceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'e2e-provider-configs-invalid-json-'),
    );

    try {
      await fs.writeFile(
        path.join(sourceDir, 'kubernetes-backend.yaml'),
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrProviderConfig',
          metadata: { name: 'kubernetes-backend' },
          spec: {
            type: 'kubernetes',
            config: '{not-json}',
          },
        }),
        'utf-8',
      );
      await fs.writeFile(
        path.join(sourceDir, 'kubernetes.yaml'),
        common.io.toYaml({
          apiVersion: 'firestartr.dev/v1',
          kind: 'FirestartrProviderConfig',
          metadata: { name: 'kubernetes' },
          spec: {
            type: 'kubernetes',
            config: '{}',
          },
        }),
        'utf-8',
      );

      await expect(
        prepareProviderConfigManifests(sourceDir, 'demo-ns'),
      ).rejects.toThrow(/Failed to parse spec\.config JSON/);
    } finally {
      await fs.rm(sourceDir, { recursive: true, force: true });
    }
  });
});
