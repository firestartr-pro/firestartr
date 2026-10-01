import { validateClaimAgainstSchema } from '../src/skills/validate-claim-against-schema';

import { createTestContext, TestContext } from './auxiliar';

describe('validateClaimAgainstSchema', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestContext({ paths: ['groups'] });
  });

  afterEach(async () => {
    await context.destroy();
  });

  it('validates a claim against its detected schema', async () => {
    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath('group_a'),
    });

    expect(result).toMatchObject({
      valid: true,
      claimType: 'GroupClaim',
      errors: [],
      message: 'Claim is valid',
    });
  });

  it('validates a claim against an explicit schema type', async () => {
    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath('group_a'),
      schemaType: 'GroupClaim',
    });

    expect(result.valid).toBe(true);
    expect(result.claimType).toBe('GroupClaim');
  });

  it('rejects a claim that does not match its detected schema', async () => {
    await context.applyPatches('group_a', [
      { op: 'replace', path: '/members/0', value: 'invalid-user-ref' },
    ]);

    const result = await validateClaimAgainstSchema({
      claimPath: await context.getFilePath('group_a'),
    });

    expect(result.valid).toBe(false);
    expect(result.claimType).toBe('GroupClaim');
    expect(
      result.errors.some((error) => error.message?.includes('must match pattern')),
    ).toBe(true);
  });
});
