import { IGithubRepositoryClaim } from '../../claims/github/repository';
import { FeaturesOverrider } from '../../overriders/featureOverride';

/**
 * It expects a IClaimWithFeatures even it is specific for a IComponentClaim,
 * this is necessary to be able tu run the dummy tests
 */
export async function generateFeaturesPatches(claim: IGithubRepositoryClaim) {
  const patches: any[] = [];

  for (const featureToInstall of claim.providers.github?.features || []) {
    patches.push(await createRenderFeaturePatch(claim, featureToInstall));
  }

  return patches;
}

async function createRenderFeaturePatch(
  claim: IGithubRepositoryClaim,

  feature: any,
) {
  const featureOverrider = new FeaturesOverrider(
    feature.name,

    feature.version,

    false,

    feature.args,

    feature.ref,

    feature.repo,
  );

  return featureOverrider.patches(claim, null);
}
