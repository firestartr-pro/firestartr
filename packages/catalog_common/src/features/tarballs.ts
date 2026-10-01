import * as fs from 'fs';
import log from '../logger';

export function getFeatureZipDownloadPath(
  featureName: string,
  version: string,
  owner: string,
  repo: string,
): string {
  const featureDownloadPath = `/tmp/${basicFeaturePath(featureName, version, owner, repo)}-zipball.zip`;
  log.debug(`Feature tarball download path ${featureDownloadPath}`);
  return featureDownloadPath;
}

export function removeFeatureTarball(
  featureName: string,
  version: string,
  owner: string,
  repo: string,
): void {
  const featurePath = getFeatureZipDownloadPath(
    featureName,
    version,
    owner,
    repo,
  );
  log.debug(`Removing feature tarball ${featurePath}`);
  fs.unlinkSync(featurePath);
  log.debug(
    `Removed tarball for feature ${featureName} and version ${version}: ${featurePath}`,
  );
}

export function featureTarballExists(
  featureName: string,
  version: string,
  owner: string,
  repo: string,
): boolean {
  const featurePath = getFeatureZipDownloadPath(
    featureName,
    version,
    owner,
    repo,
  );
  const exists = fs.existsSync(featurePath);
  log.debug(`Tarball ${featurePath} exists? ${exists}`);
  return exists;
}

export function getFeaturesExtractPath(
  featureName: string,
  version: string,
  owner: string,
  repo: string,
  options: any = {},
): string {
  const { createIfNotExists } = options;
  const extractPath = `/tmp/${basicFeaturePath(featureName, version, owner, repo)}-extract`;
  log.debug(`Extract path ${extractPath}`);
  if (createIfNotExists && !fs.existsSync(extractPath)) {
    log.debug(`Extract path ${extractPath} does not exist, creating`);
    fs.mkdirSync(extractPath, { recursive: true });
  }
  return extractPath;
}

function basicFeaturePath(
  featureName: string,
  version: string,
  owner: string,
  repo: string,
) {
  const legs = [owner, repo, featureName, version].map((leg: string) =>
    trasformLeg(leg),
  );

  return legs.join('-');
}

function trasformLeg(leg: string) {
  return leg.replace(/\//g, '___');
}
