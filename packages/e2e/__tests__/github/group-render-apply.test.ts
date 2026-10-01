import {
  destroyFixtureResources,
  initE2e,
  cleanupRenderedArtifacts,
  type E2EApi,
} from '../..';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';

// Smallest end-to-end example: render one fixture locally, apply its single CR,
// and wait for reconciliation.
describe('Claim Render Local Group E2E', () => {
  let client: E2EApi;

  beforeAll(async () => {
    // Use a suite-specific prefix so rendered names and cleanup are deterministic.
    client = await initE2e(undefined, undefined, {
      namePrefix: 'group-render-apply',
    });

    // Remove any stale resources left behind by an earlier run of this example.
    await destroyFixtureResources(client, client.getPrefix(), ['group-a'], {
      strict: true,
      logPrefix: 'group-render-apply',
    });
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    // Delete the rendered CR plus any temporary render/context artifacts.
    await cleanupRenderedArtifacts(client);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'should render group locally and apply to cluster - controlling errors on tfresult',
    async () => {
      // Clear members so this example stays focused on plain group creation.
      const rendered = await client.claims.renderLocally('group-a', {
        patches: [{ op: 'replace', path: '/members', value: [] }],
      });

      // Group fixtures render a single CR, so this is the manifest we apply.
      const primaryCrPath = rendered.crPaths[0];
      if (!primaryCrPath) {
        throw new Error('No rendered CR path found for group-a claim');
      }

      // Minimal happy path: apply the CR, then wait until it becomes healthy.
      await client.k8s.applyCr(primaryCrPath);
      const result = await client.k8s.waitForCr(primaryCrPath);
      expect(result).toBeDefined();
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
