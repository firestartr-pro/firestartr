import fs from 'node:fs';
import path from 'node:path';

const FIXTURE_DIR_NAMES = [
  'base_claims',
  'globals',
  'initializers',
  'provider_configs',
] as const;
const MODULE_DIR = __dirname;

function hasFixtureDirectory(
  basePath: string,
  name: (typeof FIXTURE_DIR_NAMES)[number],
): boolean {
  try {
    return fs.statSync(path.join(basePath, name)).isDirectory();
  } catch {
    return false;
  }
}

function hasRequiredFixtureDirectories(basePath: string): boolean {
  return FIXTURE_DIR_NAMES.every((name) => hasFixtureDirectory(basePath, name));
}

function findPackageRoot(startDir: string): string | null {
  let currentDir = startDir;

  while (true) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
}

export function resolveE2eFixturesPath(): string {
  const packageRoot = findPackageRoot(MODULE_DIR);
  const candidates = Array.from(
    new Set([
      packageRoot ? path.join(packageRoot, 'fixtures') : '',
      path.resolve(MODULE_DIR, '../fixtures'),
      path.resolve(MODULE_DIR, '../../fixtures'),
    ]),
  ).filter((candidate): candidate is string => candidate.length > 0);

  for (const candidate of candidates) {
    if (hasRequiredFixtureDirectories(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not resolve e2e fixtures directory. Checked: ${candidates.join(', ')}. Expected required subdirectories: ${FIXTURE_DIR_NAMES.join(', ')}`,
  );
}

export function resolveE2eBaseClaimsPath(): string {
  return path.join(resolveE2eFixturesPath(), 'base_claims');
}

export function resolveE2eProviderConfigsPath(): string {
  return path.join(resolveE2eFixturesPath(), 'provider_configs');
}
