import src from './src';

export * from './src';

export default {
  prepareFeature: src.prepareFeature,
  renderFeature: src.renderFeature,
  renderFeatureFromPath: src.renderFeatureFromPath,
  getFeatureConfig: src.getFeatureConfig,
  getFeatureConfigFromRef: src.getFeatureConfigFromRef,
  getFeatureClaimPatches: src.getFeatureClaimPatches,
  getFeatureClaimPatchesFromRef: src.getFeatureClaimPatchesFromRef,
  getFeatureClaimPatchesFromPath: src.getFeatureClaimPatchesFromPath,
};
