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
  type JsonPatchOperation,
} from '../..';
import { readK8sResource } from '../../src/cr-finder';
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';

const FEATURE_NAME = 'charts_repo';
const FEATURE_REF = 'charts_repo-v1';

function componentPatches({
  repoName,
  ownerRef,
  platformGroupRef,
  org,
  features,
}: {
  repoName: string;
  ownerRef: string;
  platformGroupRef: string;
  org: string;
  features: Record<string, unknown>[];
}): JsonPatchOperation[] {
  return [
    { op: 'remove', path: '/system' },
    { op: 'replace', path: '/owner', value: ownerRef },
    { op: 'replace', path: '/platformOwner', value: platformGroupRef },
    { op: 'remove', path: '/maintainedBy' },
    { op: 'replace', path: '/providers/github/org', value: org },
    { op: 'replace', path: '/providers/github/name', value: repoName },
    {
      op: 'replace',
      path: '/providers/github/description',
      value: `Feature CR traceability e2e repository ${repoName}`,
    },
    { op: 'replace', path: '/providers/github/additionalRules', value: [] },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalAdmins',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalMaintainers',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalReaders',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalWriters',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalCodeownersRules',
      value: [],
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/useDefault',
      value: true,
    },
    {
      op: 'replace',
      path: '/providers/github/overrides/spec/actions/oidc/includeClaimKeys',
      value: [],
    },
    { op: 'add', path: '/providers/github/features', value: features },
  ];
}

async function findFeatureCrPaths(crPaths: string[]): Promise<string[]> {
  const featureCrPaths: string[] = [];

  for (const crPath of crPaths) {
    const resource = await readK8sResource(crPath);
    if (resource.kind === 'FirestartrGithubRepositoryFeature') {
      featureCrPaths.push(crPath);
    }
  }

  if (featureCrPaths.length === 0) {
    throw new Error('Expected rendered component to include a feature CR');
  }

  return featureCrPaths;
}

describe('Feature CR git traceability annotations E2E', () => {
  let client: E2EApi;
  let fixtures: FixtureResourceInput[] = [];
  let defaultGroupRef = '';
  let platformGroupRef = '';
  let componentClaimName = '';
  let componentRepoName = '';
  let featureCrPaths: string[] = [];

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'feature-cr-traceability',
      onlyFiles: ['firestartr', 'group_a', 'component_a'],
    });

    const nameBuilder = createNameBuilder(client.getPrefix());
    const defaultGroupName = nameBuilder.build('default-group');
    const platformGroupName = nameBuilder.build('group-a');
    componentClaimName = nameBuilder.build('feature-trace');
    componentRepoName = componentClaimName;
    platformGroupRef = `group:${platformGroupName}`;

    fixtures = [
      { fixtureName: 'firestartr', claimName: defaultGroupName },
      { fixtureName: 'group-a', claimName: platformGroupName },
      { fixtureName: 'component-a', claimName: componentClaimName },
    ];

    await destroyFixtureResources(client, client.getPrefix(), fixtures, {
      logPrefix: 'feature-cr-traceability',
      strict: true,
    });

    const defaultGroup = await ensureDefaultGroup(client);
    defaultGroupRef = defaultGroup.ref;

    const renderedPlatformGroup = await client.claims.renderLocally('group-a', {
      patches: [{ op: 'replace', path: '/members', value: [] }],
    });
    await applyAndWaitCrPaths(client, renderedPlatformGroup.crPaths);
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) {
      return;
    }

    const cleanup = new CleanupRunner();

    // Rendered feature CRs reference the owner group. Delete them first (while
    // the group still exists) so their finalizers can look up the group and
    // complete. Only after the rendered CRs are gone do we destroy the fixtures
    // (which includes the owner group).
    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });

    await cleanup.run('destroy fixtures', async () => {
      await destroyFixtureResources(client, client.getPrefix(), fixtures, {
        logPrefix: 'feature-cr-traceability-afterall',
        strict: true,
      });
    });

    cleanup.warnOnErrors('feature-cr-traceability', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'stamps git traceability annotations on the reconciled Feature CR',
    async () => {
      const rendered = await client.claims.renderLocally('component-a', {
        patches: componentPatches({
          repoName: componentRepoName,
          ownerRef: defaultGroupRef,
          platformGroupRef,
          org: client.getOrg(),
          features: [{ name: FEATURE_NAME, ref: FEATURE_REF }],
        }),
      });

      featureCrPaths = await findFeatureCrPaths(rendered.crPaths);
      await applyAndWaitCrPaths(client, rendered.crPaths);

      for (const featureCrPath of featureCrPaths) {
        const featureCr = await client.k8s.waitForCr(featureCrPath);
        const annotations = featureCr.metadata?.annotations ?? {};

        // The feature the CR was rendered from.
        expect(annotations['firestartr.dev/feature-name']).toBe(FEATURE_NAME);

        // SHA is immutable: 40 lowercase hex chars resolved from the real
        // GitHub API via resolveFeatureCommit.
        expect(annotations['firestartr.dev/feature-git-sha']).toMatch(
          /^[0-9a-f]{40}$/,
        );

        // Tags are a JSON array of strings pointing at the resolved commit.
        const tags = JSON.parse(
          annotations['firestartr.dev/feature-git-tags'] ?? '[]',
        );
        expect(Array.isArray(tags)).toBe(true);
        // charts_repo-v1 is an annotated tag resolved to this commit and
        // charts_repo-v1.5.0 is a lightweight tag on the same commit, so tag
        // resolution must find at least one. An empty array here means either
        // the lookup regressed (#2699) or it silently swallowed an API error.
        expect(tags.length).toBeGreaterThan(0);
        for (const tag of tags) {
          expect(typeof tag).toBe('string');
        }

        // URL stays browsable (tag-based render).
        expect(annotations['firestartr.dev/feature-url']).toMatch(
          /^https:\/\/github\.com\//,
        );

        // Reference and repo the feature was rendered from.
        expect(annotations['firestartr.dev/feature-ref']).toBe(FEATURE_REF);
        expect(
          typeof annotations['firestartr.dev/feature-repo'] === 'string' &&
            annotations['firestartr.dev/feature-repo'].length > 0,
        ).toBe(true);
      }
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
