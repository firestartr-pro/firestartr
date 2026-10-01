import featuresPreparer from 'features_preparer';
import { applyPatch } from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

import {
  stitchClaim,
  MOCK_STITCHING_FEATURES,
  extractClaimPatches,
} from '../src/claims/stitching/stitching';
import { StitchingError } from '../src/claims/stitching/errors';
import { isProtectedPath } from '../src/claims/stitching/protectedPaths';
import { createTestContext, type TestContext } from './auxiliar';

// Loads the canonical component claim fixture from base_claims and applies
// optional JSON Patch operations to shape it for a specific test.
async function fixtureClaim(
  ctx: TestContext,
  ...patches: Operation[]
): Promise<Record<string, unknown>> {
  const claim = ctx.fromYaml(
    await ctx.getFile('component_a'),
  ) as Record<string, unknown>;
  if (patches.length === 0) return claim;
  return applyPatch(claim, patches).newDocument as Record<string, unknown>;
}

describe('isProtectedPath', () => {
  it('protects exact /kind and /name', () => {
    expect(isProtectedPath('/kind')).toBe(true);
    expect(isProtectedPath('/name')).toBe(true);
    expect(isProtectedPath('/metadata/name')).toBe(true);
  });

  it('wildcard /providers/*/org protects any provider org', () => {
    expect(isProtectedPath('/providers/github/org')).toBe(true);
    expect(isProtectedPath('/providers/terraform/org')).toBe(true);
    expect(isProtectedPath('/providers/catalog/org')).toBe(true);
    expect(isProtectedPath('/providers/github/name')).toBe(true);
  });

  it('ancestor protects descendant and vice versa', () => {
    expect(isProtectedPath('/metadata')).toBe(true);
    expect(isProtectedPath('/metadata/name/extra')).toBe(true);
    expect(isProtectedPath('/providers')).toBe(true);
    expect(isProtectedPath('/providers/github')).toBe(true);
  });

  it('does not protect unrelated paths', () => {
    expect(isProtectedPath('/annotations/backstage.io~1techdocs-ref')).toBe(false);
    expect(isProtectedPath('/providers/github/visibility')).toBe(false);
  });

  it('empty-string root pointer is protected (replaces the whole document)', () => {
    expect(isProtectedPath('')).toBe(true);
  });

  it('protects the /providers/*/features subtree', () => {
    expect(isProtectedPath('/providers/github/features')).toBe(true);
    expect(isProtectedPath('/providers/github/features/-')).toBe(true);
    expect(isProtectedPath('/providers/github/features/0')).toBe(true);
    expect(isProtectedPath('/providers/github/features/1/args/team')).toBe(true);
    expect(isProtectedPath('/providers/terraform/features')).toBe(true);
  });
});

describe('stitchClaim gates', () => {
  afterEach(() => MOCK_STITCHING_FEATURES(undefined));

  let ctx: TestContext;
  let baseClaim: Record<string, unknown>;

  beforeEach(async () => {
    ctx = await createTestContext({ paths: ['components'] });
    baseClaim = await fixtureClaim(ctx, {
      op: 'add',
      path: '/annotations',
      value: {},
    });
  });

  afterEach(async () => {
    await ctx.destroy();
  });

  it('allows add to absent path', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'tech_docs',
        patches: [
          {
            op: 'add',
            path: '/annotations/backstage.io~1techdocs-ref',
            value: 'url:https://example',
          },
        ],
      },
    ]);
    expect((stitched as any).annotations['backstage.io/techdocs-ref']).toEqual(
      'url:https://example',
    );
  });

  it('rejects protected path', async () => {
    await expect(
      stitchClaim(baseClaim, [
        { feature: 'evil', patches: [{ op: 'add', path: '/kind', value: 'X' }] },
      ]),
    ).rejects.toBeInstanceOf(StitchingError);
    try {
      await stitchClaim(baseClaim, [
        { feature: 'evil', patches: [{ op: 'add', path: '/kind', value: 'X' }] },
      ]);
    } catch (e) {
      const err = e as StitchingError;
      expect(err.violations[0].reason).toBe('protected-path');
      expect(err.violations[0].feature).toBe('evil');
    }
  });

  it('rejects ancestor of protected path', async () => {
    await expect(
      stitchClaim(baseClaim, [
        { feature: 'evil', patches: [{ op: 'add', path: '/metadata', value: {} }] },
      ]),
    ).rejects.toMatchObject({ violations: expect.arrayContaining([expect.objectContaining({ reason: 'protected-path' })]) });
  });

  it('rejects wildcard protected path', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'add', path: '/providers/terraform/org', value: 'hacked' }],
        },
      ]),
    ).rejects.toMatchObject({ violations: expect.arrayContaining([expect.objectContaining({ reason: 'protected-path' })]) });
  });

  it('rejects replace of protected path', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'replace', path: '/providers/github/org', value: 'other' }],
        },
      ]),
    ).rejects.toMatchObject({ violations: expect.arrayContaining([expect.objectContaining({ reason: 'protected-path' })]) });
  });

  it('rejects feature appending to /providers/github/features/-', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'feature_installer',
          patches: [
            {
              op: 'add',
              path: '/providers/github/features/-',
              value: { name: 'hidden_feature' },
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'protected-path' }),
      ]),
    });
  });

  it('rejects feature appending to /providers/github/features/- even when the element already exists in the claim', async () => {
    const withFeatures = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/features',
      value: [{ name: 'tech_docs', version: '0.8.0' }],
    });
    await expect(
      stitchClaim(withFeatures, [
        {
          feature: 'tech_docs',
          patches: [
            {
              op: 'add',
              path: '/providers/github/features/-',
              value: { name: 'tech_docs', version: '0.9.0' },
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'protected-path' }),
      ]),
    });
  });

  it('rejects feature writing into another feature args under the features subtree', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'feature_installer',
          patches: [
            {
              op: 'add',
              path: '/providers/github/features/0/args/injected',
              value: 'x',
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'protected-path' }),
      ]),
    });
  });

  it('rejects whole-document root replace (empty-string pointer)', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'replace', path: '', value: {} }],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'protected-path' }),
      ]),
    });
  });

  it('allows patch to overwrite non-protected existing path (patch wins)', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'feat',
        patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }],
      },
    ]);
    expect((stitched as any).providers.github.visibility).toBe('public');
  });

  it('rejects non-append add to a user-declared path (overwrite protection)', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }],
        },
      ], baseClaim),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'user-declared-path' }),
      ]),
    });
  });

  it('rejects replace of a user-declared value (overwrite protection)', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'replace', path: '/providers/github/visibility', value: 'public' }],
        },
      ], baseClaim),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'user-declared-path' }),
      ]),
    });
  });

  it('rejects remove of a user-declared value (overwrite protection)', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'remove', path: '/providers/github/visibility' }],
        },
      ], baseClaim),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'user-declared-path' }),
      ]),
    });
  });

  it('allows non-append add to an absent (non-user-declared) path', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'tech_docs',
        patches: [
          {
            op: 'add',
            path: '/annotations/backstage.io~1techdocs-ref',
            value: 'url:https://example',
          },
        ],
      },
    ], baseClaim);
    expect((stitched as any).annotations['backstage.io/techdocs-ref']).toEqual(
      'url:https://example',
    );
  });

  it('allows append to a user-declared array (dedup preserves original values)', async () => {
    const userClaim = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/labels',
      value: [{ name: 'existing', color: '000000' }],
    });
    const stitched = await stitchClaim(userClaim, [
      {
        feature: 'charts_repo',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'generate-snapshot', color: '68DF9F' },
          },
        ],
      },
    ], userClaim);
    expect((stitched as any).providers.github.labels).toEqual([
      { name: 'existing', color: '000000' },
      { name: 'generate-snapshot', color: '68DF9F' },
    ]);
  });

  it('allows non-append add when the path exists only after defaults (not user-declared)', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'feat',
        patches: [{ op: 'add', path: '/providers/github/defaultedField', value: 'x' }],
      },
    ], await fixtureClaim(ctx));
    expect((stitched as any).providers.github.defaultedField).toBe('x');
  });

  it('rejects replace/remove to absent path', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'evil',
          patches: [{ op: 'replace', path: '/annotations/missing', value: 'x' }],
        },
      ]),
    ).rejects.toMatchObject({ violations: expect.arrayContaining([expect.objectContaining({ reason: 'overwrite-protected' })]) });
  });

  it('rejects an add and a replace on the same existing path regardless of feature order', async () => {
    const envelopesForward = [
      { feature: 'a', patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }] },
      { feature: 'b', patches: [{ op: 'replace', path: '/providers/github/visibility', value: 'private' }] },
    ];
    const envelopesReversed = [
      { feature: 'b', patches: [{ op: 'replace', path: '/providers/github/visibility', value: 'private' }] },
      { feature: 'a', patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }] },
    ];
    await expect(
      stitchClaim(baseClaim, envelopesForward),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path' }),
      ]),
    });
    await expect(
      stitchClaim(baseClaim, envelopesReversed),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path' }),
      ]),
    });
  });

  it('rejects an add and a replace with the same value on an existing path (no cross-op dedup)', async () => {
    const envelopesForward = [
      { feature: 'a', patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }] },
      { feature: 'b', patches: [{ op: 'replace', path: '/providers/github/visibility', value: 'public' }] },
    ];
    const envelopesReversed = [
      { feature: 'b', patches: [{ op: 'replace', path: '/providers/github/visibility', value: 'public' }] },
      { feature: 'a', patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }] },
    ];
    await expect(stitchClaim(baseClaim, envelopesForward)).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path' }),
      ]),
    });
    await expect(stitchClaim(baseClaim, envelopesReversed)).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path' }),
      ]),
    });
  });

  it('retains repeated appends of the same unnamed element within one feature (ordered sequence preserved)', async () => {
    const claimWithExtras = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/extras',
      value: [] as unknown[],
    });
    const stitched = await stitchClaim(claimWithExtras, [
      {
        feature: 'feat',
        patches: [
          { op: 'add', path: '/providers/github/extras/-', value: { kind: 'x' } },
          { op: 'add', path: '/providers/github/extras/-', value: { kind: 'x' } },
        ],
      },
    ]);
    expect((stitched as any).providers.github.extras).toEqual([
      { kind: 'x' },
      { kind: 'x' },
    ]);
  });

  it('does not flag repeated writes to the same destination within one feature as a conflict', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'feat',
        patches: [
          { op: 'replace', path: '/providers/github/visibility', value: 'public' },
          { op: 'replace', path: '/providers/github/visibility', value: 'private' },
        ],
      },
    ]);
    expect((stitched as any).providers.github.visibility).toBe('private');
  });

  it('rejects duplicate path across features with different values', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'a',
          patches: [{ op: 'add', path: '/annotations/x', value: '1' }],
        },
        {
          feature: 'b',
          patches: [{ op: 'add', path: '/annotations/x', value: '2' }],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path', conflictingFeature: 'a' }),
      ]),
    });
  });

  it('deduplicates two features writing the same scalar value (no error)', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'a',
        patches: [{ op: 'add', path: '/annotations/x', value: 'same' }],
      },
      {
        feature: 'b',
        patches: [{ op: 'add', path: '/annotations/x', value: 'same' }],
      },
    ]);
    expect((stitched as any).annotations.x).toBe('same');
  });

  it('rejects ancestor/descendant writes across features in either order', async () => {
    const forward = [
      {
        feature: 'a',
        patches: [{ op: 'add', path: '/annotations', value: { x: '1' } }],
      },
      {
        feature: 'b',
        patches: [{ op: 'add', path: '/annotations/x', value: '2' }],
      },
    ];
    const reversed = [
      {
        feature: 'b',
        patches: [{ op: 'add', path: '/annotations/x', value: '2' }],
      },
      {
        feature: 'a',
        patches: [{ op: 'add', path: '/annotations', value: { x: '1' } }],
      },
    ];
    await expect(stitchClaim(baseClaim, forward)).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path' }),
      ]),
    });
    await expect(stitchClaim(baseClaim, reversed)).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path' }),
      ]),
    });
  });

  it('rejects a whole-array write that overlaps another feature append', async () => {
    await expect(
      stitchClaim(baseClaim, [
        {
          feature: 'a',
          patches: [
            {
              op: 'add',
              path: '/providers/github/labels',
              value: [{ name: 'x', color: '1' }],
            },
          ],
        },
        {
          feature: 'b',
          patches: [
            {
              op: 'add',
              path: '/providers/github/labels/-',
              value: { name: 'y', color: '2' },
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate-path', conflictingFeature: 'a' }),
      ]),
    });
  });

  it('allows an ancestor write and a descendant write within the same feature (ordered sequence)', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'feat',
        patches: [
          { op: 'add', path: '/annotations', value: {} },
          { op: 'add', path: '/annotations/x', value: '1' },
        ],
      },
    ]);
    expect((stitched as any).annotations.x).toBe('1');
  });

  it('treats escaped segments by their semantic value (no false conflict between siblings)', async () => {
    const stitched = await stitchClaim(baseClaim, [
      {
        feature: 'a',
        patches: [
          {
            op: 'add',
            path: '/annotations/backstage.io~1techdocs-ref',
            value: 'one',
          },
        ],
      },
      {
        feature: 'b',
        patches: [
          {
            op: 'add',
            path: '/annotations/backstage.io~1techdocs',
            value: 'two',
          },
        ],
      },
    ]);
    expect((stitched as any).annotations['backstage.io/techdocs-ref']).toBe(
      'one',
    );
    expect((stitched as any).annotations['backstage.io/techdocs']).toBe('two');
  });

  it('aggregates all violations collect-all', async () => {
    try {
      await stitchClaim(baseClaim, [
        { feature: 'a', patches: [{ op: 'add', path: '/kind', value: 'x' }] },
        {
          feature: 'b',
          patches: [{ op: 'add', path: '/providers/github/visibility', value: 'public' }],
        },
        {
          feature: 'c',
          patches: [{ op: 'add', path: '/annotations/x', value: '1' }],
        },
        {
          feature: 'd',
          patches: [{ op: 'add', path: '/annotations/x', value: '2' }],
        },
      ]);
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as StitchingError;
      expect(err.violations.length).toBeGreaterThanOrEqual(2);
      expect(err.violations.map((v) => v.reason)).toEqual(
        expect.arrayContaining(['protected-path', 'duplicate-path']),
      );
    }
  });

  it('throws for non-array claimPatches via extractClaimPatches (clean-cut)', async () => {
    expect(() =>
      extractClaimPatches({ claimPatches: { github: [] } as unknown as any }),
    ).toThrow(/flat array/);
    expect(() =>
      extractClaimPatches({ claimPatches: {} as unknown as any }),
    ).toThrow(/flat array/);
    expect(extractClaimPatches({ claimPatches: [] })).toEqual([]);
    expect(extractClaimPatches({})).toEqual([]);
    expect(
      extractClaimPatches({
        claimPatches: [{ op: 'add', path: '/a', value: 1 }],
      }),
    ).toEqual([{ op: 'add', path: '/a', value: 1 }]);
  });

  it('uses MOCK_STITCHING_FEATURES when set', async () => {
    MOCK_STITCHING_FEATURES(async () => [
      {
        feature: 'mocked',
        patches: [{ op: 'add', path: '/annotations/mocked', value: 'yes' }],
      },
    ]);
    const stitched = await stitchClaim(baseClaim);
    expect((stitched as any).annotations.mocked).toBe('yes');
  });
});

describe('stitchClaim array append (`/-`) handling', () => {
  afterEach(() => MOCK_STITCHING_FEATURES(undefined));

  let ctx: TestContext;
  let noLabelsClaim: Record<string, unknown>;

  beforeEach(async () => {
    ctx = await createTestContext({ paths: ['components'] });
    noLabelsClaim = await fixtureClaim(ctx);
  });

  afterEach(async () => {
    await ctx.destroy();
  });

  it('creates the full nested chain and renders labels - as an array', async () => {
    const stitched = await stitchClaim(noLabelsClaim, [
      {
        feature: 'charts_repo',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'generate-snapshot', color: '68DF9F' },
          },
        ],
      },
    ]);
    expect((stitched as any).providers.github.labels).toEqual([
      { name: 'generate-snapshot', color: '68DF9F' },
    ]);
  });

  it('allows two features appending distinct label names to the same array', async () => {
    const stitched = await stitchClaim(noLabelsClaim, [
      {
        feature: 'charts_repo',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'generate-snapshot', color: '68DF9F' },
          },
        ],
      },
      {
        feature: 'build_and_dispatch_docker_images',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'autodeploy', color: 'B086E6' },
          },
        ],
      },
    ]);
    expect((stitched as any).providers.github.labels).toEqual([
      { name: 'generate-snapshot', color: '68DF9F' },
      { name: 'autodeploy', color: 'B086E6' },
    ]);
  });

  it('rejects two features appending the same label name to the same array', async () => {
    await expect(
      stitchClaim(noLabelsClaim, [
        {
          feature: 'a',
          patches: [
            {
              op: 'add',
              path: '/providers/github/labels/-',
              value: { name: 'plan', color: '17A4B0' },
            },
          ],
        },
        {
          feature: 'b',
          patches: [
            {
              op: 'add',
              path: '/providers/github/labels/-',
              value: { name: 'plan', color: '5319E7' },
            },
          ],
        },
      ]),
    ).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({
          reason: 'duplicate-path',
          conflictingFeature: 'a',
        }),
      ]),
    });
  });

  it('appends to an existing labels array without triggering overwrite protection', async () => {
    const withLabels = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/labels',
      value: [{ name: 'existing', color: '000000' }],
    });
    const stitched = await stitchClaim(withLabels, [
      {
        feature: 'charts_repo',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'generate-snapshot', color: '68DF9F' },
          },
        ],
      },
    ]);
    expect((stitched as any).providers.github.labels).toEqual([
      { name: 'existing', color: '000000' },
      { name: 'generate-snapshot', color: '68DF9F' },
    ]);
  });

  it('creates the full object chain for a deep absent path add', async () => {
    const stitched = await stitchClaim(noLabelsClaim, [
      {
        feature: 'deep',
        patches: [
          { op: 'add', path: '/providers/github/newObject/nested', value: 1 },
        ],
      },
    ]);
    expect((stitched as any).providers.github.newObject).toEqual({
      nested: 1,
    });
  });

  it('drops append when element already exists in claim (claim wins)', async () => {
    const withLabels = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/labels',
      value: [{ name: 'plan', color: '000000' }],
    });
    const stitched = await stitchClaim(withLabels, [
      {
        feature: 'feat',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'plan', color: '17A4B0' },
          },
        ],
      },
    ]);
    expect((stitched as any).providers.github.labels).toEqual([
      { name: 'plan', color: '000000' },
    ]);
  });

  it('succeeds when two features append the same label with the same value (silent dedup)', async () => {
    const stitched = await stitchClaim(noLabelsClaim, [
      {
        feature: 'a',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'plan', color: '17A4B0' },
          },
        ],
      },
      {
        feature: 'b',
        patches: [
          {
            op: 'add',
            path: '/providers/github/labels/-',
            value: { name: 'plan', color: '17A4B0' },
          },
        ],
      },
    ]);
    expect((stitched as any).providers.github.labels).toEqual([
      { name: 'plan', color: '17A4B0' },
    ]);
  });
});

describe('collectFeaturePatches (production path)', () => {
  const originalPreparers = {
    getFeatureClaimPatches: featuresPreparer.getFeatureClaimPatches,
    getFeatureClaimPatchesFromRef: featuresPreparer.getFeatureClaimPatchesFromRef,
    getFeatureConfig: featuresPreparer.getFeatureConfig,
    getFeatureConfigFromRef: featuresPreparer.getFeatureConfigFromRef,
  };

  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ paths: ['components'] });
  });

  afterEach(async () => {
    await ctx.destroy();
    MOCK_STITCHING_FEATURES(undefined);
    const preparerAny = featuresPreparer as unknown as Record<string, unknown>;
    preparerAny.getFeatureClaimPatches = originalPreparers.getFeatureClaimPatches;
    preparerAny.getFeatureClaimPatchesFromRef =
      originalPreparers.getFeatureClaimPatchesFromRef;
    preparerAny.getFeatureConfig = originalPreparers.getFeatureConfig;
    preparerAny.getFeatureConfigFromRef = originalPreparers.getFeatureConfigFromRef;
  });

  interface PreparerCall {
    method: string;
    args: unknown[];
  }

  it('collects declared features via the preparer boundary without a GitHub token', async () => {
    const calls: PreparerCall[] = [];
    const preparerAny = featuresPreparer as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    preparerAny.getFeatureClaimPatches = async (...args: unknown[]) => {
      calls.push({ method: 'getFeatureClaimPatches', args });
      return {
        claimPatches: [{ op: 'add', path: '/annotations/from-version-feature', value: 'v' }],
      };
    };
    preparerAny.getFeatureClaimPatchesFromRef = async (...args: unknown[]) => {
      calls.push({ method: 'getFeatureClaimPatchesFromRef', args });
      return {
        claimPatches: [{ op: 'add', path: '/annotations/from-ref-feature', value: 'r' }],
      };
    };

    const rawClaim = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/features',
      value: [
        { name: 'version_feature', version: '1.2.3', repo: 'acme/features', args: { foo: 'bar' } },
        { name: 'ref_feature', ref: 'main', repo: 'acme/features' },
      ],
    });

    const stitched = await stitchClaim(rawClaim, undefined, rawClaim);

    expect((stitched as any).annotations['from-version-feature']).toBe('v');
    expect((stitched as any).annotations['from-ref-feature']).toBe('r');

    expect(calls.length).toBe(2);
    expect(calls.map((c) => c.method).sort()).toEqual([
      'getFeatureClaimPatches',
      'getFeatureClaimPatchesFromRef',
    ]);

    const versionCall = calls.find((c) => c.method === 'getFeatureClaimPatches');
    expect(versionCall).toBeDefined();
    expect(versionCall!.args[0]).toBe('version_feature');
    expect(versionCall!.args[1]).toBe('1.2.3');
    expect((versionCall!.args[2] as any).name).toBe('component_a');
    expect(versionCall!.args[3]).toEqual({ foo: 'bar' });
    expect(versionCall!.args[4]).toBe('features');
    expect(versionCall!.args[5]).toBe('acme');

    const refCall = calls.find((c) => c.method === 'getFeatureClaimPatchesFromRef');
    expect(refCall).toBeDefined();
    expect(refCall!.args[0]).toBe('ref_feature');
    expect(refCall!.args[1]).toBe('main');
  });

  it('falls back to the legacy getFeatureConfig preparer when the claim-patches API is absent', async () => {
    const calls: string[] = [];
    const preparerAny = featuresPreparer as unknown as Record<
      string,
      ((...args: unknown[]) => Promise<unknown>) | undefined
    >;
    preparerAny.getFeatureClaimPatches = undefined;
    preparerAny.getFeatureClaimPatchesFromRef = undefined;
    preparerAny.getFeatureConfig = async (..._args: unknown[]) => {
      calls.push('getFeatureConfig');
      return { claimPatches: [{ op: 'add', path: '/annotations/legacy', value: 'x' }] };
    };
    preparerAny.getFeatureConfigFromRef = async (..._args: unknown[]) => {
      calls.push('getFeatureConfigFromRef');
      return { claimPatches: [] };
    };

    const rawClaim = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/features',
      value: [{ name: 'legacy_feature', version: '0.1.0' }],
    });

    const stitched = await stitchClaim(rawClaim, undefined, rawClaim);

    expect(calls).toEqual(['getFeatureConfig']);
    expect((stitched as any).annotations.legacy).toBe('x');
  });

  it('still enforces stitching gates on the patches collected from the preparer', async () => {
    const preparerAny = featuresPreparer as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    preparerAny.getFeatureClaimPatches = async () => [
      { op: 'add', path: '/kind', value: 'Hacked' },
    ];

    const rawClaim = await fixtureClaim(ctx, {
      op: 'add',
      path: '/providers/github/features',
      value: [{ name: 'evil', version: '1' }],
    });

    await expect(stitchClaim(rawClaim, undefined, rawClaim)).rejects.toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ reason: 'protected-path', feature: 'evil' }),
      ]),
    });
  });

  it('rejects malformed feature descriptors before calling the preparer', async () => {
    const calls: string[] = [];
    const preparerAny = featuresPreparer as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    preparerAny.getFeatureClaimPatches = async (..._args: unknown[]) => {
      calls.push('getFeatureClaimPatches');
      return { claimPatches: [] };
    };
    preparerAny.getFeatureClaimPatchesFromRef = async (..._args: unknown[]) => {
      calls.push('getFeatureClaimPatchesFromRef');
      return { claimPatches: [] };
    };

    const malformedFeatures: Array<Record<string, unknown>> = [
      { name: 'bad_repo', version: '1.0.0', repo: 'singleword' },
      { name: 'bad_repo_slashes', version: '1.0.0', repo: 'a/b/c' },
      { name: 'non_string_repo', version: '1.0.0', repo: 123 },
      { name: 'bad_ref', version: '1.0.0', ref: 'main' },
      { name: 'no_version_no_ref' },
      { version: '1.0.0' },
    ];

    for (const feature of malformedFeatures) {
      const rawClaim = await fixtureClaim(ctx, {
        op: 'add',
        path: '/providers/github/features',
        value: [feature],
      });
      await expect(
        stitchClaim(rawClaim, undefined, rawClaim),
      ).rejects.toThrow(/Invalid feature descriptor/);
    }

    expect(calls).toEqual([]);
  });
});
