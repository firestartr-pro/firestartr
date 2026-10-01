import type { RendererTestContext } from './auxiliar';
import { createTestContext, rendererTestFixtures } from './auxiliar';
import { validateClaimAgainstSchema } from '../src/skills/validate-claim-against-schema';

describe('ComponentClaim providers.github.pages.path validation', () => {

  jest.setTimeout(30000);

  process.env.ORG = 'firestartr-test';

  let context: RendererTestContext;

  beforeEach(async () => {
    context = await createTestContext({});
  });

  afterEach(async () => {
    await context.destroy();
  });

  function setComponentPath(pathValue: string | undefined) {
    const file = 'component_a';
    if (pathValue === undefined) {
      return;
    }

    return context.applyPatches(file, [
      { op: 'add', path: '/providers/github/pages', value: { source: { branch: 'main', path: pathValue } } },
    ]);
  }


  it('allows pages.path being undefined', async () => {
    
    await setComponentPath(undefined);

    await expect(
      context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs })
    ).resolves.toBeDefined();

  });

  it('allows pages.path being "/"', async () => {

    await setComponentPath('/');

    await expect(context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs })).resolves.toBeDefined();
  });

  it('allows pages.path being "/docs"', async () => {
    await setComponentPath('/docs');

    await expect(context.renderClaims(undefined, { crsPath: rendererTestFixtures.noCrs })).resolves.toBeDefined();
  });

  it('rejects non-canonical pages.path values', async () => {
    await setComponentPath('/invalid');

    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath('component_a'),
      schemaType: 'ComponentClaim',
    });

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message?.includes('must be equal to one of the allowed values')),
    ).toBe(true);
  });

  it('allows pages.public being true', async () => {
    const file = 'component_a';
    await context.applyPatches(file, [
      { op: 'add', path: '/providers/github/pages', value: { public: true } },
    ]);

    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath(file),
      schemaType: 'ComponentClaim',
    });

    expect(result.valid).toBe(true);
  });

  it('allows pages.https_enforced with cname', async () => {
    const file = 'component_a';
    await context.applyPatches(file, [
      { op: 'add', path: '/providers/github/pages', value: { https_enforced: true, cname: 'docs.example.com' } },
    ]);

    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath(file),
      schemaType: 'ComponentClaim',
    });

    expect(result.valid).toBe(true);
  });

  it('rejects pages.https_enforced without cname', async () => {
    const file = 'component_a';
    await context.applyPatches(file, [
      { op: 'add', path: '/providers/github/pages', value: { https_enforced: true } },
    ]);

    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath(file),
      schemaType: 'ComponentClaim',
    });

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) => error.message?.includes('cname')),
    ).toBe(true);
  });
});
