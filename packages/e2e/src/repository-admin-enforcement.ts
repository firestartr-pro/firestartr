import fs from 'node:fs/promises';
import common from 'catalog_common';

const GITHUB_REPOSITORY_CR_KIND = 'FirestartrGithubRepository';
const GITHUB_REPOSITORY_FEATURE_CR_KIND = 'FirestartrGithubRepositoryFeature';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitManifestDocuments(content: string): string[] {
  return content
    .split(/^---\s*$/m)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function disableRepositoryAdminEnforcement(resource: unknown): boolean {
  if (
    !isRecord(resource) ||
    resource.kind !== GITHUB_REPOSITORY_CR_KIND ||
    !isRecord(resource.spec) ||
    !Array.isArray(resource.spec.branchProtections)
  ) {
    return false;
  }

  let changed = false;
  resource.spec.branchProtections = resource.spec.branchProtections.map(
    (branchProtection) => {
      if (!isRecord(branchProtection)) {
        return branchProtection;
      }

      if (branchProtection.enforceAdmins !== false) {
        changed = true;
      }

      return {
        ...branchProtection,
        enforceAdmins: false,
      };
    },
  );

  return changed;
}

function manifestHasRepositoryFeature(content: string): boolean {
  return splitManifestDocuments(content).some((document) => {
    const resource = common.io.fromYaml(document);
    return (
      isRecord(resource) && resource.kind === GITHUB_REPOSITORY_FEATURE_CR_KIND
    );
  });
}

export async function disableRepositoryAdminEnforcementInManifest(
  crPath: string,
): Promise<void> {
  const content = await fs.readFile(crPath, 'utf-8');
  const resources = splitManifestDocuments(content).map((document) =>
    common.io.fromYaml(document),
  );
  let changed = false;

  for (const resource of resources) {
    if (disableRepositoryAdminEnforcement(resource)) {
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  const serializedResources = resources
    .map((resource) => common.io.toYaml(resource).trim())
    .join('\n---\n');

  await fs.writeFile(crPath, `${serializedResources}\n`, 'utf-8');
}

export async function disableRepositoryAdminEnforcementForFeatureRepos(
  crPaths: string[],
): Promise<void> {
  const manifests = await Promise.all(
    crPaths.map(async (crPath) => ({
      crPath,
      content: await fs.readFile(crPath, 'utf-8'),
    })),
  );

  if (!manifests.some(({ content }) => manifestHasRepositoryFeature(content))) {
    return;
  }

  await Promise.all(
    manifests.map(({ crPath }) =>
      disableRepositoryAdminEnforcementInManifest(crPath),
    ),
  );
}
