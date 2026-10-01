import path from 'path';
import common from 'catalog_common';

import renderer, { getClaimPatches } from 'features_renderer';

import log from './logger';

export function renderFeature(
  featureName: string,
  version: string,
  owner,
  repo,
  featureOwner: any,
  renderPath = '/tmp',
  featureArgs: any = {},
) {
  const extractPath = path.join(
    common.features.tarballs.getFeaturesExtractPath(
      featureName,
      version,
      owner,
      repo,
    ),
    'packages',
    featureName,
  );

  const renderedPath = common.features.features.getFeatureRenderedPathForEntity(
    featureOwner,
    featureName,
    renderPath,
  );

  log.info(
    `Rendering feature ${featureName} to ${renderedPath} with component ${JSON.stringify(featureOwner)}`,
  );

  return renderer.render(
    extractPath,
    renderedPath,
    featureOwner,
    {},
    featureArgs,
  );
}

/*
 * This functionality does the same as the above
 * without downloading and extracting the feature
 */
export function renderFeatureFromPath(
  extractPath: string,
  renderedPath: string,
  featureOwner: any,
  featureArgs: any = {},
) {
  return renderer.render(
    extractPath,
    renderedPath,
    featureOwner,
    {},
    featureArgs,
  );
}

export function getFeatureClaimPatches(
  featureName: string,
  version: string,
  owner,
  repo,
  featureOwner: any,
  featureArgs: any = {},
) {
  const extractPath = path.join(
    common.features.tarballs.getFeaturesExtractPath(
      featureName,
      version,
      owner,
      repo,
    ),
    'packages',
    featureName,
  );
  return getClaimPatches(extractPath, featureOwner, {}, featureArgs);
}

export function getFeatureClaimPatchesFromPath(
  extractPath: string,
  featureOwner: any,
  featureArgs: any = {},
) {
  return getClaimPatches(extractPath, featureOwner, {}, featureArgs);
}
