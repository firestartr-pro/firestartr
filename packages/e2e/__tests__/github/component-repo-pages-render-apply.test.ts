import github from 'github';
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
import { LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS } from '../../src/test-constants';

const PAGES_CNAME = 'e2e-component-pages.test';
const PAGES_DEFAULT_BRANCH = 'main';

function pagesComponentPatches(ownerRef: string): JsonPatchOperation[] {
  return [
    { op: 'remove', path: '/system' },
    { op: 'replace', path: '/owner', value: ownerRef },
    { op: 'replace', path: '/platformOwner', value: ownerRef },
    { op: 'remove', path: '/maintainedBy' },
    { op: 'replace', path: '/providers/github/additionalRules', value: [] },
    {
      op: 'replace',
      path: '/providers/github/overrides/additionalAdmins',
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
    {
      op: 'add',
      path: '/providers/github/pages',
      value: {
        buildType: 'legacy',
        source: { branch: PAGES_DEFAULT_BRANCH, path: '/' },
        // `public` and `https_enforced` are intentionally omitted from the e2e
        // claim. The firestartr GitHub App installation token cannot change
        // GitHub Pages visibility (`public`) via the REST API — GitHub returns
        // 422 "Only repository admins can change the visibility of GitHub
        // Pages" — and `https_enforced` needs a real DNS-verified TLS
        // certificate the disposable e2e org cannot provide. Both are covered
        // at unit/renderer level (#2607/#2613), not via this live org.
        cname: PAGES_CNAME,
      },
    },
  ];
}

describe('Claim Render Local Component GitHub Pages E2E', () => {
  let client: E2EApi;
  let fixtures: FixtureResourceInput[] = [];
  let componentName = '';

  beforeAll(async () => {
    client = await initE2e(undefined, undefined, {
      namePrefix: 'component-pages',
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
      logPrefix: 'component-pages',
      strict: true,
    });
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  afterAll(async () => {
    if (!client) return;
    const cleanup = new CleanupRunner();
    await cleanup.run('destroy component fixture resources', async () => {
      await destroyFixtureResources(client, client.getPrefix(), fixtures, {
        logPrefix: 'component-pages-afterall',
        strict: true,
      });
    });
    await cleanup.run('cleanup rendered artifacts', async () => {
      await cleanupRenderedArtifacts(client);
    });
    cleanup.warnOnErrors('component-pages', 'afterAll');
  }, LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS);

  it(
    'provisions GitHub Pages config and reflects build_type/source (public & https_enforced covered at unit/renderer level)',
    async () => {
      const defaultGroup = await ensureDefaultGroup(client);
      const rendered = await client.claims.renderLocally('component-a', {
        patches: pagesComponentPatches(defaultGroup.ref),
      });
      await applyAndWaitCrPaths(client, rendered.crPaths);
      await expect(client.gh.repoExists(componentName)).resolves.toBe(true);

      const pages = await github.repo.getPages(client.getOrg(), componentName);
      expect(pages.build_type).toBe('legacy');
      expect(pages.source?.branch).toBe(PAGES_DEFAULT_BRANCH);
      expect(pages.source?.path).toBe('/');
    },
    LOCAL_RENDER_APPLY_TEST_TIMEOUT_MS,
  );
});
