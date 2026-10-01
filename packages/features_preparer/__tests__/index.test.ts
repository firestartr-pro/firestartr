import featuresPreparer from '../index';

describe('features_preparer default export surface', () => {
  it('exposes the claim-patches functions used by claim stitching', () => {
    // collectFeaturePatches (cdk8s_renderer) branches on these being present;
    // without them stitching silently falls back to the legacy full render.
    expect(typeof featuresPreparer.getFeatureClaimPatches).toBe('function');
    expect(typeof featuresPreparer.getFeatureClaimPatchesFromRef).toBe('function');
  });

  it('keeps the legacy render and getConfig surface', () => {
    expect(typeof featuresPreparer.prepareFeature).toBe('function');
    expect(typeof featuresPreparer.renderFeature).toBe('function');
    expect(typeof featuresPreparer.renderFeatureFromPath).toBe('function');
    expect(typeof featuresPreparer.getFeatureConfig).toBe('function');
    expect(typeof featuresPreparer.getFeatureConfigFromRef).toBe('function');
  });
});