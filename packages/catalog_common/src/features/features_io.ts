import * as fs from 'fs';
import path from 'path';

import log from '../logger';

export function getFeatureRenderedPathForEntity(
  entity: any,
  featureName: string,
  basePath = '/tmp',
): string {
  const entityFolderName =
    `${entity.metadata?.name ?? entity.name}`.toLowerCase();
  return path.join(basePath, entityFolderName, featureName);
}

export function getFeatureRenderedConfigForComponent(
  entity: any,
  featureName: string,
  basePath = '/tmp/features',
): string {
  log.info(
    `Getting rendered config for component ${entity.name}and feature ${featureName}`,
  );

  const workdir = getFeatureRenderedPathForEntity(
    entity,
    featureName,
    basePath,
  );

  const config = JSON.parse(
    fs.readFileSync(`${workdir}/output.json`, { encoding: 'utf8' }),
  );

  log.debug(`Feature output: ${config}`);

  log.debug(
    `Rendered feature ${featureName} for component ${entity.name}. Result: ${(JSON.stringify, config)}`,
  );

  return config;
}
