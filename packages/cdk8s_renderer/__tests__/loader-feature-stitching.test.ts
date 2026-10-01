import path from 'path';

import { setPath } from '../src/config';
import { loadClaimsList } from '../src/loader/loader';
import { resetLazyLoader } from '../src/loader/lazy_loader';
import { claimsRefListAsGenerator } from '../src/utils/claimUtils';
import { MOCK_STITCHING_FEATURES } from '../src/claims/stitching/stitching';
import { createTestContext, TestContext } from './auxiliar';

import featuresPreparer from 'features_preparer';

describe('Loader insertion point: feature stitching (defaults order, AJV visibility, rawClaim)', () => {
  jest.setTimeout(30000);

  process.env['ORG'] = 'firestartr-test';

  const originalPreparers = {
    getFeatureClaimPatches: featuresPreparer.getFeatureClaimPatches,
    getFeatureClaimPatchesFromRef: featuresPreparer.getFeatureClaimPatchesFromRef,
    getFeatureConfig: featuresPreparer.getFeatureConfig,
    getFeatureConfigFromRef: featuresPreparer.getFeatureConfigFromRef,
  };

  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext({});
  });

  beforeEach(async () => {
    await context.restart();
    resetLazyLoader();
    // Loader-level tests run the real collection path: never pre-supply envelopes.
    MOCK_STITCHING_FEATURES(undefined);
  });

  afterEach(() => {
    const preparerAny = featuresPreparer as unknown as Record<string, unknown>;
    preparerAny.getFeatureClaimPatches = originalPreparers.getFeatureClaimPatches;
    preparerAny.getFeatureClaimPatchesFromRef =
      originalPreparers.getFeatureClaimPatchesFromRef;
    preparerAny.getFeatureConfig = originalPreparers.getFeatureConfig;
    preparerAny.getFeatureConfigFromRef = originalPreparers.getFeatureConfigFromRef;
  });

  const configureLoaderPaths = async (): Promise<void> => {
    setPath('claims', await context.getClaimsDir());
    setPath('claimsDefaults', path.join(__dirname, 'fixtures/initializers'));
    setPath('initializers', path.join(__dirname, 'fixtures/initializers'));
    setPath('globals', path.join(__dirname, 'fixtures/globals'));
    setPath('crs', await context.getBaseCrsDir());
  };

  const addFeatureToComponentA = async (): Promise<void> => {
    await context.applyPatches('component_a', [
      {
        op: 'add',
        path: '/providers/github/features',
        value: [{ name: 'test_feature', version: '1.0.0' }],
      },
    ]);
  };

  const loadComponentA = (): Promise<any> =>
    loadClaimsList(
      claimsRefListAsGenerator(['ComponentClaim-component_a']),
      context.getClaimsDir(),
    );

  const stubGetFeatureClaimPatches = (patches: unknown[]): void => {
    const preparerAny = featuresPreparer as unknown as Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    >;
    preparerAny.getFeatureClaimPatches = async () => patches;
  };

  it('applies feature claim-patches after claims_defaults (patch wins on defaults-only paths)', async () => {
    await addFeatureToComponentA();
    await configureLoaderPaths();
    stubGetFeatureClaimPatches([
      { op: 'replace', path: '/providers/github/technology/stack', value: 'python' },
    ]);

    const result = await loadComponentA();
    const loaded =
      result.renderClaims['ComponentClaim-component_a'];

    // `technology` is injected by claims_defaults.yaml (absent from the raw claim),
    // so the patch overwrites the default and the remainder of the default survives.
    expect(loaded.claim.providers.github.technology.stack).toBe('python');
    expect(loaded.claim.providers.github.technology.version).toBe('14');
    expect(loaded.claim.providers.github.features).toEqual([
      { name: 'test_feature', version: '1.0.0' },
    ]);
  });

  it('exposes the stitched claim to AJV (feature-injected invalid field fails schema validation)', async () => {
    await addFeatureToComponentA();
    await configureLoaderPaths();
    // `technology`'s schema block (component.schema.ts) has additionalProperties: false.
    stubGetFeatureClaimPatches([
      { op: 'add', path: '/providers/github/technology/extra', value: true },
    ]);

    // loadClaimsList rejects with a plain string (loadClaim rethrows `Lazy Loading: ...`).
    let message = '';
    try {
      await loadComponentA();
    } catch (err) {
      message = String(err);
    }

    expect(message).toMatch(/Error when validating claim ComponentClaim-component_a/);
    expect(message).toMatch(/\/providers\/github\/technology: must NOT have additional properties/);
  });

  it('enforces overwrite protection against the raw claim (user-declared path rejected)', async () => {
    await addFeatureToComponentA();
    await configureLoaderPaths();
    // `description` is declared in the raw component_a claim; Gate 4 must reject the
    // write even though the stitched (post-defaults) claim also contains it.
    stubGetFeatureClaimPatches([
      { op: 'replace', path: '/providers/github/description', value: 'feature-override' },
    ]);

    let message = '';
    try {
      await loadComponentA();
    } catch (err) {
      message = String(err);
    }

    expect(message).toMatch(/Error when stitching claim ComponentClaim-component_a/);
    expect(message).toMatch(/targets a field declared by the user/);
  });
});