import {
  CleanupRunner,
  applyAndWaitCrPaths,
  cleanupRenderedArtifacts,
  createNameBuilder,
  destroyFixtureResources,
  ensureDefaultGroup,
  initE2e,
  type E2EApi,
  type FixtureResourceInput,
  type GhRepoLabel,
  type JsonPatchOperation,
} from '../..';
import { buildComponentClaimPatches } from '../../src/claim-patches';
import { pickRenderedCr, setReconcileAt } from '../../src/render-artifacts';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';

const LABEL_TIMEOUT_MS = LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS * 2;

const MANUAL_LABEL_NAME = 'manual-label';
const NEW_LABEL_NAME = 'new-label';

function lookupLabel(
  labels: GhRepoLabel[],
  name: string,
): GhRepoLabel | undefined {
  return labels.find((l) => l.name === name);
}

type LabelInput = {
  name: string;
  color: string;
  description: string;
};

function labelsPatch(labels: LabelInput[]): JsonPatchOperation {
  return { op: 'add', path: '/providers/github/labels', value: labels };
}

describe('Claim Render Local Component Labels E2E', () => {
  let client: E2EApi;
  let fixtures: FixtureResourceInput[] = [];
  let componentName = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'component-labels',
      onlyFiles: ['firestartr', 'component_a'],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    componentName = nameBuilder.build('component-a');

    fixtures = [
      {
        fixtureName: 'firestartr',
        claimName: nameBuilder.build('default-group'),
      },
      'component-a',
    ];

    await destroyFixtureResources(client, client.getPrefix(), fixtures, {
      logPrefix: 'component-labels',
      strict: true,
    });
  }, LABEL_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    await cleanup.run('destroy component fixture resources', async () => {
      await destroyFixtureResources(client, client.getPrefix(), fixtures, {
        logPrefix: 'component-labels-afterall',
        strict: true,
      });
    });

    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    cleanup.warnOnErrors('component-labels', 'afterAll');
  }, LABEL_TIMEOUT_MS);

  it(
    'should converge labels: create repo, import pre-existing label, update drift, and no-op on repeat',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);

      // Leg 0: apply the component with no labels → repo created.
      const rendered0 = await client.claims.renderLocally('component-a', {
        patches: buildComponentClaimPatches({
          name: componentName,
          ownerRef: defaultGroup.ref,
          hasIssues: false,
        }),
      });
      await applyAndWaitCrPaths(client, rendered0.crPaths);

      await expect(client.gh.repoExists(componentName)).resolves.toBe(true);

      // Confirm no labels present (only default labels from GitHub if any).
      const labelsAfterLeg0 = await client.gh.getRepoLabels(componentName);
      expect(lookupLabel(labelsAfterLeg0, MANUAL_LABEL_NAME)).toBeUndefined();
      expect(lookupLabel(labelsAfterLeg0, NEW_LABEL_NAME)).toBeUndefined();

      // Leg A: create a label directly on GitHub that differs from what we'll
      // declare later (simulates manual creation via the GitHub UI).
      await client.gh.createRepoLabel(componentName, {
        name: MANUAL_LABEL_NAME,
        color: 'ff0000',
        description: 'original manual description',
      });

      // Verify it exists on GitHub before the render.
      const labelsAfterLegA = await client.gh.getRepoLabels(componentName);
      const manualAfterA = lookupLabel(labelsAfterLegA, MANUAL_LABEL_NAME);
      expect(manualAfterA).toBeDefined();
      expect(manualAfterA!.color).toBe('ff0000');
      expect(manualAfterA!.description).toBe('original manual description');

      // Leg B: re-render declaring the manual label (different color, new
      // description) plus a brand-new label. Apply → assert the manual label
      // is imported and updated to the declared state (no 422) and the new
      // label is created.
      const renderedB = await client.claims.renderLocally('component-a', {
        patches: [
          ...buildComponentClaimPatches({
            name: componentName,
            ownerRef: defaultGroup.ref,
            hasIssues: false,
          }),
          labelsPatch([
            {
              name: MANUAL_LABEL_NAME,
              color: '00ff00',
              description: 'declared description',
            },
            {
              name: NEW_LABEL_NAME,
              color: '0000ff',
              description: 'new-label description',
            },
          ]),
        ],
      });
      await applyAndWaitCrPaths(client, renderedB.crPaths);

      const labelsAfterLegB = await client.gh.getRepoLabels(componentName);

      const manualAfterB = lookupLabel(labelsAfterLegB, MANUAL_LABEL_NAME);
      expect(manualAfterB).toBeDefined();
      expect(manualAfterB).toMatchObject({
        name: MANUAL_LABEL_NAME,
        color: '00ff00',
        description: 'declared description',
      });

      const newAfterB = lookupLabel(labelsAfterLegB, NEW_LABEL_NAME);
      expect(newAfterB).toBeDefined();
      expect(newAfterB).toMatchObject({
        name: NEW_LABEL_NAME,
        color: '0000ff',
        description: 'new-label description',
      });

      // Leg C: drift the declared color of the manual label → apply → assert
      // the label is updated on GitHub.
      const renderedC = await client.claims.renderLocally('component-a', {
        patches: [
          ...buildComponentClaimPatches({
            name: componentName,
            ownerRef: defaultGroup.ref,
            hasIssues: false,
          }),
          labelsPatch([
            {
              name: MANUAL_LABEL_NAME,
              color: 'abcdef',
              description: 'declared description',
            },
            {
              name: NEW_LABEL_NAME,
              color: '0000ff',
              description: 'new-label description',
            },
          ]),
        ],
      });
      await applyAndWaitCrPaths(client, renderedC.crPaths);

      const labelsAfterLegC = await client.gh.getRepoLabels(componentName);

      const manualAfterC = lookupLabel(labelsAfterLegC, MANUAL_LABEL_NAME);
      expect(manualAfterC).toBeDefined();
      expect(manualAfterC).toMatchObject({
        name: MANUAL_LABEL_NAME,
        color: 'abcdef',
        description: 'declared description',
      });

      // Leg D: force-reconcile with unchanged spec → assert no-op: labels
      // still match, CR stays PROVISIONED.
      const repositoryCrPathD = await pickRenderedCr(
        renderedC.crPaths,
        'FirestartrGithubRepository',
      );
      await setReconcileAt(repositoryCrPathD);
      await applyAndWaitCrPaths(client, [repositoryCrPathD]);

      const labelsAfterLegD = await client.gh.getRepoLabels(componentName);

      const manualAfterD = lookupLabel(labelsAfterLegD, MANUAL_LABEL_NAME);
      expect(manualAfterD).toBeDefined();
      expect(manualAfterD).toMatchObject({
        name: MANUAL_LABEL_NAME,
        color: 'abcdef',
        description: 'declared description',
      });

      const newAfterD = lookupLabel(labelsAfterLegD, NEW_LABEL_NAME);
      expect(newAfterD).toBeDefined();
      expect(newAfterD).toMatchObject({
        name: NEW_LABEL_NAME,
        color: '0000ff',
        description: 'new-label description',
      });
    },
    LABEL_TIMEOUT_MS,
  );
});
