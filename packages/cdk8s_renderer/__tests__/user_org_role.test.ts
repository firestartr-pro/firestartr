import * as path from 'path';
import { Testing } from 'cdk8s';
import { render } from '../src/renderer/renderer';
import { AllowedProviders, configureProvider } from '../src/config';
import { createTestContext } from './auxiliar';
import { claimsRefListAsGenerator } from '../src/utils/claimUtils';
import { emptyRenderedClaims } from '../src/refresolver';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import { validateNoBackstageAnnotationsInK8sCrs } from '../src/validations/backstageAnnotations';

const ORG_ROLE_ANNOTATION = 'firestartr.backstage.dev/org-role';
const WRITE_ROLE_ANNOTATION = 'firestartr.backstage.dev/role';

describe('Permission annotations on catalog entities', () => {
  jest.setTimeout(30000);

  process.env.ORG = 'firestartr-test';

  configureProvider(AllowedProviders.all);

  const FIXTURES = path.join(__dirname, 'fixtures');

  beforeEach(() => {
    emptyRenderedClaims();
    resetLazyLoader();
  });

  async function renderUser(
    patches?: { file: string; ops: any[] },
  ) {
    const context = await createTestContext({ onlyFiles: ['user_a'] });

    if (patches) {
      await context.applyPatches(patches.file, patches.ops);
    }

    context.configureRendererPaths({ excludeGithubCrs: true });
    const { catalogApp, app } = context.createRendererApps();

    await render(
      catalogApp,
      app,
      claimsRefListAsGenerator(['UserClaim-user_a']),
    );

    app.synth();
    catalogApp.synth();

    const allResources = catalogApp.charts.flatMap((chart: any) =>
      Testing.synth(chart),
    );

    const entity = allResources.find(
      (r: any) => r.kind === 'User' && r.metadata?.name === 'user-a',
    );

    await context.destroy();

    return entity;
  }

  async function renderGroup(
    patches?: { file: string; ops: any[] },
  ) {
    const context = await createTestContext({ onlyFiles: ['group_a', 'user_a'] });

    if (patches) {
      await context.applyPatches(patches.file, patches.ops);
    }

    context.configureRendererPaths({ excludeGithubCrs: true });
    const { catalogApp, app } = context.createRendererApps();

    await render(
      catalogApp,
      app,
      claimsRefListAsGenerator(['GroupClaim-group_a']),
    );

    app.synth();
    catalogApp.synth();

    const allResources = catalogApp.charts.flatMap((chart: any) =>
      Testing.synth(chart),
    );

    const entity = allResources.find(
      (r: any) => r.kind === 'Group' && r.metadata?.name === 'group-a',
    );

    await context.destroy();

    return entity;
  }

  describe('User org-role annotation', () => {
    it('infers org-role owner when github role is admin', async () => {
      const entity = await renderUser({
        file: 'user_a',
        ops: [{ op: 'replace', path: '/providers/github/role', value: 'admin' }],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[ORG_ROLE_ANNOTATION]).toBe('owner');
    });

    it('does not inject org-role when github role is member', async () => {
      const entity = await renderUser({
        file: 'user_a',
        ops: [{ op: 'replace', path: '/providers/github/role', value: 'member' }],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[ORG_ROLE_ANNOTATION]).toBeUndefined();
    });

    it('ignores explicit org-role annotation from claim', async () => {
      const entity = await renderUser({
        file: 'user_a',
        ops: [
          { op: 'replace', path: '/providers/github/role', value: 'admin' },
          { op: 'add', path: '/annotations', value: { [ORG_ROLE_ANNOTATION]: 'custom-role' } },
        ],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[ORG_ROLE_ANNOTATION]).toBe('owner');
    });

    it('ignores explicit org-role annotation even when github role is member', async () => {
      const entity = await renderUser({
        file: 'user_a',
        ops: [
          { op: 'replace', path: '/providers/github/role', value: 'member' },
          { op: 'add', path: '/annotations', value: { [ORG_ROLE_ANNOTATION]: 'owner' } },
        ],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[ORG_ROLE_ANNOTATION]).toBeUndefined();
    });

    it('preserves other annotations alongside the inferred org-role', async () => {
      const entity = await renderUser({
        file: 'user_a',
        ops: [
          { op: 'replace', path: '/providers/github/role', value: 'admin' },
          { op: 'add', path: '/annotations', value: { 'custom-annotation': 'custom-value' } },
        ],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[ORG_ROLE_ANNOTATION]).toBe('owner');
      expect(entity!.metadata.annotations['custom-annotation']).toBe('custom-value');
    });
  });

  describe('Group write-role annotation', () => {
    it('passes through firestartr.backstage.dev/role annotation from claim', async () => {
      const entity = await renderGroup({
        file: 'group_a',
        ops: [{ op: 'add', path: '/annotations', value: { [WRITE_ROLE_ANNOTATION]: 'write' } }],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[WRITE_ROLE_ANNOTATION]).toBe('write');
    });

    it('does not inject role annotation when claim has no annotations', async () => {
      const entity = await renderGroup();

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[WRITE_ROLE_ANNOTATION]).toBeUndefined();
    });

    it('passes through arbitrary annotations unchanged', async () => {
      const entity = await renderGroup({
        file: 'group_a',
        ops: [{
          op: 'add', path: '/annotations',
          value: { [WRITE_ROLE_ANNOTATION]: 'write', 'custom-key': 'custom-val' },
        }],
      });

      expect(entity).toBeDefined();
      expect(entity!.metadata.annotations[WRITE_ROLE_ANNOTATION]).toBe('write');
      expect(entity!.metadata.annotations['custom-key']).toBe('custom-val');
    });
  });

  describe('K8s CR Backstage annotation leak prevention', () => {
    it('does not throw when K8s CRs have no backstage annotations', () => {
      const crs: any = {
        'FirestartrGithubGroup-group-a': {
          metadata: { name: 'group-a' },
          spec: { org: 'firestartr-test' },
        },
      };

      expect(() => validateNoBackstageAnnotationsInK8sCrs(crs)).not.toThrow();
    });

    it('throws when a K8s CR contains firestartr.backstage.dev/ annotations', () => {
      const crs: any = {
        'FirestartrGithubGroup-group-a': {
          metadata: {
            name: 'group-a',
            annotations: { 'firestartr.backstage.dev/role': 'write' },
          },
          spec: { org: 'firestartr-test' },
        },
      };

      expect(() => validateNoBackstageAnnotationsInK8sCrs(crs)).toThrow(
        /Backstage-only annotations/,
      );
    });

    it('allows other annotation namespaces on K8s CRs', () => {
      const crs: any = {
        'FirestartrGithubGroup-group-a': {
          metadata: {
            name: 'group-a',
            annotations: {
              'firestartr.dev/claim-ref': 'GroupClaim-group_a',
              'backstage.io/kubernetes-id': 'group-a',
            },
          },
          spec: { org: 'firestartr-test' },
        },
      };

      expect(() => validateNoBackstageAnnotationsInK8sCrs(crs)).not.toThrow();
    });

    it('render does not leak backstage annotations into K8s CRs', async () => {
      const context = await createTestContext({ onlyFiles: ['user_a'] });

      try {
        await context.applyPatches('user_a', [
          { op: 'replace', path: '/providers/github/role', value: 'admin' },
          {
            op: 'add',
            path: '/annotations',
            value: { 'firestartr.backstage.dev/org-role': 'owner' },
          },
        ]);

        context.configureRendererPaths({ excludeGithubCrs: false });
        const { catalogApp, app } = context.createRendererApps();

        await render(
          catalogApp,
          app,
          claimsRefListAsGenerator(['UserClaim-user_a']),
        );

        const k8sResources = app.charts.flatMap((chart: any) =>
          Testing.synth(chart),
        );

        for (const resource of k8sResources) {
          const annotations = resource.metadata?.annotations || {};
          const backstageKeys = Object.keys(annotations).filter((k) =>
            k.startsWith('firestartr.backstage.dev/'),
          );
          expect(backstageKeys).toHaveLength(0);
        }
      } finally {
        await context.destroy();
      }
    });
  });
});
