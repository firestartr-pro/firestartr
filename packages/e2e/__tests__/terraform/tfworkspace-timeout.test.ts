import path from 'node:path';
import fs from 'node:fs/promises';
import {
  CleanupRunner,
  cleanupRenderedArtifacts,
  destroyFixtureResources,
  initE2e,
  prepareProviderConfigManifests,
  resolveE2eProviderConfigsPath,
  type E2EApi,
} from '../..';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';

const TFWORKSPACE_FIXTURE = 'workspace_a';
const PROVIDER_CONFIG_MANIFESTS = [
  'kubernetes-backend.yaml',
  'kubernetes.yaml',
] as const;

describe('Testing timeouts in tfwp', () => {
  const DUMMY_TFM_MODULE_SOURCE =
    'git::https://prefapp/tfm.git//packages/dummy?ref=main';

  let client: E2EApi;
  let providerConfigsTempDir: string | undefined;

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'tfworkspace-timeout',
    });

    const providerConfigsPath = resolveE2eProviderConfigsPath();
    providerConfigsTempDir = await prepareProviderConfigManifests(
      providerConfigsPath,
      client.k8s.getNamespace(),
    );

    for (const manifestName of PROVIDER_CONFIG_MANIFESTS) {
      await client.k8s.applyCr(path.join(providerConfigsTempDir, manifestName));
    }

    await destroyFixtureResources(
      client,
      client.getPrefix(),
      [TFWORKSPACE_FIXTURE],
      {
        deleteOrg: false,
        strict: true,
        logPrefix: 'tfworkspace-timeout',
      },
    );
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    await cleanup.run('delete rendered tfworkspace', async () => {
      await destroyFixtureResources(
        client,
        client.getPrefix(),
        [TFWORKSPACE_FIXTURE],
        {
          deleteOrg: false,
          logPrefix: 'tfworkspace-timeout',
        },
      );
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    if (providerConfigsTempDir) {
      for (const manifestName of PROVIDER_CONFIG_MANIFESTS) {
        await cleanup.run(
          `delete provider config ${manifestName}`,
          async () => {
            await client.k8s.deleteCr(
              path.join(providerConfigsTempDir, manifestName),
            );
          },
        );
      }
    }

    if (providerConfigsTempDir) {
      await cleanup.run('remove provider config temp dir', async () => {
        await fs.rm(providerConfigsTempDir, { recursive: true, force: true });
      });
    }

    cleanup.throwOnErrors('tfworkspace-timeout afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it('should timeout if the tfwp takes too long to apply', async () => {
    const rendered = await client.claims.renderLocally(TFWORKSPACE_FIXTURE, {
      merge: {
        owner: 'group:firestartr',
        annotations: {
          'firestartr.dev/test-custom-timeout': '5',
        },
        providers: {
          terraform: {
            module: DUMMY_TFM_MODULE_SOURCE,
          },
        },
      },
      patches: [
        {
          op: 'replace',
          path: '/providers/terraform/values',
          value: {
            sleep_on_apply: 10,
          },
        },
        {
          op: 'remove',
          path: '/providers/terraform/valuesSchema',
        },
      ],
    });

    const primaryCrPath = rendered.crPaths[0];
    if (!primaryCrPath) {
      throw new Error('No rendered CR path found for workspace_a claim');
    }

    await client.k8s.applyCr(primaryCrPath);

    const result = await client.k8s.waitForCr(primaryCrPath, 60, 'ERROR');
    expect(result).toBeDefined();
  });
});
