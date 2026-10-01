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

const TFWORKSPACE_FIXTURE = 'tfworkspace-a';
const PROVIDER_CONFIG_MANIFESTS = [
  'kubernetes-backend.yaml',
  'kubernetes.yaml',
] as const;

// Terraform example: prepare provider configs, render one TFWorkspace claim,
// apply it, and wait for reconciliation.
describe('Claim Render Local TFWorkspace E2E', () => {
  let client: E2EApi;
  let providerConfigsTempDir: string | undefined;

  beforeAll(async () => {
    // Use a suite-scoped prefix so Terraform-side names stay deterministic.
    client = await initE2e(undefined, undefined, {
      namePrefix: 'tfworkspace-render-apply',
    });

    // Stamp the provider config fixtures with the namespace used by this test
    // run and write them into a temp directory.
    const providerConfigsPath = resolveE2eProviderConfigsPath();
    providerConfigsTempDir = await prepareProviderConfigManifests(
      providerConfigsPath,
      client.k8s.getNamespace(),
    );

    // Provider configs must exist before the TFWorkspace CR that references
    // them is created.
    for (const manifestName of PROVIDER_CONFIG_MANIFESTS) {
      await client.k8s.applyCr(path.join(providerConfigsTempDir, manifestName));
    }

    // Remove stale workspace resources from any earlier run of this example.
    await destroyFixtureResources(
      client,
      client.getPrefix(),
      [TFWORKSPACE_FIXTURE],
      {
        strict: true,
        logPrefix: 'tfworkspace-render-apply',
      },
    );
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    // Keep teardown resilient even if one delete step already succeeded.
    const cleanup = new CleanupRunner();

    // Force-delete any rendered workspace CRs before removing provider configs
    // so leaked finalizers do not block later runs of this suite.
    await cleanup.run('delete rendered tfworkspace', async () => {
      await destroyFixtureResources(
        client,
        client.getPrefix(),
        [TFWORKSPACE_FIXTURE],
        {
          deleteOrg: false,
          logPrefix: 'tfworkspace-render-apply',
        },
      );
    });

    // Then remove the tracked render artifacts and destroy the shared context.
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
      // The prepared provider manifests live in a suite-specific temp dir.
      await cleanup.run('remove provider config temp dir', async () => {
        await fs.rm(providerConfigsTempDir, { recursive: true, force: true });
      });
    }

    cleanup.throwOnErrors('tfworkspace-render-apply afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'should render tfworkspace locally and apply to cluster',
    async () => {
      // Give Terraform a unique input so this example never collides with a
      // previous workspace run.
      const managedConfigMapName = `${client.getPrefix()}-managed-configmap-${Date.now()}`;

      const rendered = await client.claims.renderLocally(TFWORKSPACE_FIXTURE, {
        patches: [
          {
            op: 'replace',
            path: '/providers/terraform/values/configmap_name',
            value: managedConfigMapName,
          },
        ],
      });

      // TFWorkspace fixtures render a single CR, so this is the manifest to
      // apply.
      const primaryCrPath = rendered.crPaths[0];
      if (!primaryCrPath) {
        throw new Error('No rendered CR path found for tfworkspace-a claim');
      }

      // The happy path matches the minimal flow: apply once, then wait.
      await client.k8s.applyCr(primaryCrPath);
      const result = await client.k8s.waitForCr(primaryCrPath);
      expect(result).toBeDefined();
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
