import semver from 'semver';
import { version as cliVersion } from '../package.json';

function isSnapshot(version: string): boolean {
  return /^v?\d+\.\d+\.\d+-/.test(version);
}

export function validateVersionConstraint(
  constraint: string,
  version?: string,
  options?: { ignoreSnapshots?: boolean },
): boolean {
  if (!semver.validRange(constraint)) {
    throw new Error(`Invalid version constraint: "${constraint}"`);
  }
  const targetVersion = version || cliVersion;
  if (isSnapshot(targetVersion)) {
    if (options?.ignoreSnapshots) return true;
    throw new Error(
      `Snapshot version "${targetVersion}" is not a valid semver release; use --ignore-snapshots to allow snapshots`,
    );
  }
  if (!semver.valid(targetVersion)) {
    throw new Error(`Invalid version: "${targetVersion}"`);
  }
  return semver.satisfies(targetVersion, constraint);
}
