import type { RendererTestContext } from './auxiliar';
import { createTestContext, rendererTestFixtures } from './auxiliar';

describe('CDK8s Renderer', () => {
  jest.setTimeout(30000);

  process.env.ORG = 'firestartr-test';

  let context: RendererTestContext;

  beforeAll(async () => {
    context = await createTestContext({});
  });

  beforeEach(async () => {
    context = await context.resetRendererState();
  });

  afterAll(async () => {
    await context.destroy();
  });

  it('Is able to render specific claims with specific values', async () => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/hasWiki',
        value: false,
      },
    ]);

    const { renderedMap } = await context.renderClaims(
      { claimRefs: ['ComponentClaim-component_a'] },
      { excludeGithubCrs: true },
    );

    expect(renderedMap['Component-component-a']).toBeDefined();
    expect(
      await context.testRenderedCR('FirestartrGithubRepository', 'component-a', {
        op: 'test',
        path: '/spec/repo/hasWiki',
        value: false,
      }),
    ).toBe(true);
  });
});
