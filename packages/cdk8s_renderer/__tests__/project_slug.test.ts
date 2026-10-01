import type { RendererTestContext } from './auxiliar';
import { createTestContext, rendererTestFixtures } from './auxiliar';
import { BackstageInitializer } from '../src/initializers/backstage';
import { setRepositoryUrl } from '../src/config';

describe('CDK8s Renderer', () => {
  jest.setTimeout(30000);

  process.env.ORG = 'firestartr-test';

  let context: RendererTestContext;

  beforeAll(async () => {
    context = await createTestContext({});
  });

  beforeEach(async () => {
    context = await context.resetRendererState();
    setRepositoryUrl(undefined);
  });

  afterAll(async () => {
    await context.destroy();
  });

  it('sets github.com/project-slug from providers.github for ComponentClaim', async () => {
    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['ComponentClaim-component_a'] },
      { excludeGithubCrs: true },
    );

    const catalogComponent = renderedMap['Component-component-a'] as any;

    expect(catalogComponent).toBeDefined();
    expect(
      catalogComponent.metadata.annotations['github.com/project-slug'],
    ).toBe('firestartr-test/component_a');
  });

  it('preserves user-set github.com/project-slug in claim annotations', async () => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/annotations',
        value: { 'github.com/project-slug': 'user-org/user-repo' },
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['ComponentClaim-component_a'] },
      { excludeGithubCrs: true },
    );

    const catalogComponent = renderedMap['Component-component-a'] as any;

    expect(catalogComponent).toBeDefined();
    expect(
      catalogComponent.metadata.annotations['github.com/project-slug'],
    ).toBe('user-org/user-repo');
  });

  it('sets backstage.io/edit-url on non-Component catalog entities when BackstageInitializer applies', async () => {
    setRepositoryUrl('https://github.com/my-org/my-repo');

    const nContext = await createTestContext({
      onlyFiles: ['group_a', 'group_b', 'user_a'],
    });

    try {
      const { renderedMap } = await nContext.renderClaims(undefined, {
        crsPath: rendererTestFixtures.noCrs,
      });

      const catalogGroup = renderedMap['Group-group-a'] as any;

      expect(catalogGroup).toBeDefined();
      expect(
        catalogGroup.metadata.annotations['backstage.io/edit-url'],
      ).toBeDefined();
    } finally {
      await nContext.destroy();
    }
  });

  it('does not set project-slug when providers.github is missing (direct patch test)', async () => {
    const initializer = new BackstageInitializer();
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      providers: {},
    };
    const patches = await initializer.patches(claim, {});
    let cr: any = { metadata: { annotations: {} } };
    for (const patch of patches) {
      cr = await patch.apply(cr);
    }

    expect(
      cr.metadata.annotations['github.com/project-slug'],
    ).toBeUndefined();
  });

  it('does not set project-slug when providers.github.org is missing (direct patch test)', async () => {
    const initializer = new BackstageInitializer();
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      providers: {
        github: { name: 'my-repo' },
      },
    };
    const patches = await initializer.patches(claim, {});
    let cr: any = { metadata: { annotations: {} } };
    for (const patch of patches) {
      cr = await patch.apply(cr);
    }

    expect(
      cr.metadata.annotations['github.com/project-slug'],
    ).toBeUndefined();
  });
  it('does not set project-slug when providers.github.name is missing (direct patch test)', async () => {
    const initializer = new BackstageInitializer();
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      providers: {
        github: { org: 'my-org' },
      },
    };
    const patches = await initializer.patches(claim, {});
    let cr: any = { metadata: { annotations: {} } };
    for (const patch of patches) {
      cr = await patch.apply(cr);
    }

    expect(cr.metadata.annotations['github.com/project-slug']).toBeUndefined();
  });

  it('sets backstage.io/edit-url from repositoryUrl for ComponentClaim', async () => {
    setRepositoryUrl('https://github.com/my-org/my-repo');

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['ComponentClaim-component_a'] },
      { excludeGithubCrs: true },
    );

    const catalogComponent = renderedMap['Component-component-a'] as any;

    expect(catalogComponent).toBeDefined();
    expect(
      catalogComponent.metadata.annotations['backstage.io/edit-url'],
    ).toBeDefined();
    expect(
      catalogComponent.metadata.annotations['backstage.io/edit-url'],
    ).toContain('https://github.com/my-org/my-repo');
    expect(
      catalogComponent.metadata.annotations['backstage.io/edit-url'],
    ).toContain('component_a.yaml');
  });

  it('does not set backstage.io/edit-url when repositoryUrl is not configured', async () => {
    setRepositoryUrl('');

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['ComponentClaim-component_a'] },
      { excludeGithubCrs: true },
    );
    const catalogComponent = renderedMap['Component-component-a'] as any;

    expect(catalogComponent).toBeDefined();
    expect(
      catalogComponent.metadata.annotations['backstage.io/edit-url'],
    ).toBeUndefined();
  });

  it('sets backstage.io/edit-url on non-Component catalog entities', async () => {
    setRepositoryUrl('https://github.com/my-org/my-repo');

    const nContext = await createTestContext({
      onlyFiles: ['group_a', 'user_a'],
    });

    try {
      const { renderedMap } = await nContext.renderClaims(undefined, {
        crsPath: rendererTestFixtures.noCrs,
      });

      const catalogGroup = renderedMap['Group-group-a'] as any;

      expect(catalogGroup).toBeDefined();
      expect(
        catalogGroup.metadata.annotations['backstage.io/edit-url'],
      ).toBeDefined();
    } finally {
      await nContext.destroy();
    }
  });
});
