import {
  ensureDefaultGroup,
  destroyFixtureResources,
  initE2e,
  orgScript,
  cleanupRenderedArtifacts,
  type E2EApi,
  type OrgScriptOptions,
} from '../..';
import {
  LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  WAIT_FOR_CR_TIMEOUT_SECONDS,
} from '../../src/test-constants';

const ORG_SCRIPT_OPTIONS: OrgScriptOptions = {
  // This suite validates the GitHub component rendering/apply path.
  // Groups/systems/domains are excluded to keep the flow focused; components
  // stay schema-valid via the orgScript default owner fallback.
  exclude: {
    groups: true,
    systems: true,
    domains: true,
  },
};

// Example of the multi-resource flow: build an orgScript fixture graph, render
// every fixture locally, then apply and wait in dependency order.
describe('Org Script Full Render Apply E2E', () => {
  let client: E2EApi;
  let script!: ReturnType<typeof orgScript>;

  beforeAll(async () => {
    // Give orgScript deterministic runtime names for this suite.
    client = await initE2e(undefined, undefined, {
      namePrefix: 'org-script-render-apply',
      // Use firestartr as a template to build a suite-scoped default group.
      onlyFiles: ['firestartr'],
    });
    const prefix = client.getPrefix();

    // Components still need a valid owner even when orgScript-generated groups
    // are excluded from the test graph.
    const defaultGroup = await ensureDefaultGroup(client);

    // orgScript returns fixtures in dependency order, ready for render/apply.
    script = orgScript(prefix, {
      ...ORG_SCRIPT_OPTIONS,
      defaultGroupRef: defaultGroup.ref,
    });

    // Remove leftovers from a previous run before creating the fresh graph.
    await destroyFixtureResources(client, prefix, script.fixtures, {
      logPrefix: 'org-script-render-apply',
    });
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await cleanupRenderedArtifacts(client);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'should render, apply and wait for all orgScript fixtures',
    async () => {
      const crPaths: string[] = [];

      // Render every fixture first so the example shows the explicit local
      // rendering step before anything is applied to the cluster.
      for (const fixture of script.fixtures) {
        const rendered = await client.claims.renderLocally(
          fixture.fixtureName,
          {
            patches: fixture.patches,
          },
        );

        // Some fixtures can expand into more than one CR, so collect them all.
        crPaths.push(...rendered.crPaths);
      }

      // Apply and wait in the same dependency order produced by orgScript.
      for (const crPath of crPaths) {
        await client.k8s.applyCr(crPath);
        const result = await client.k8s.waitForCr(
          crPath,
          WAIT_FOR_CR_TIMEOUT_SECONDS,
        );
        expect(result).toBeDefined();
      }
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
