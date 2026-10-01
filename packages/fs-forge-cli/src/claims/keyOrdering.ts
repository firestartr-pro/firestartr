import YAML from 'yaml';

const ENVELOPE_ORDER = [
  'kind',
  'version',
  'name',
  'system',
  'owner',
  'type',
  'lifecycle',
  'annotations',
  'profile',
  'providers',
] as const;

const PROVIDERS_ORDER = [
  'github',
  'terraform',
  'argocd',
  'external_secrets',
  'catalog',
] as const;

const GITHUB_ORDER = [
  'name',
  'org',
  'description',
  'visibility',
  'technology',
  'branchStrategy',
  'defaultBranch',
  'additionalBranches',
  'actions',
  'archiveOnDestroy',
  'allowMergeCommit',
  'allowSquashMerge',
  'allowRebaseMerge',
  'allowAutoMerge',
  'deleteBranchOnMerge',
  'autoInit',
  'allowUpdateBranch',
  'hasIssues',
  'hasWiki',
  'hasDiscussions',
  'pages',
  'additionalRules',
  'orgPermissions',
  'features',
  'vars',
  'secrets',
  'topics',
  'labels',
  'overrides',
] as const;

const TERRAFORM_ORDER = [
  'name',
  'source',
  'module',
  'policy',
  'values',
  'valuesSchema',
  'context',
  'tfStateKey',
  'files',
  'sync',
  'variants',
] as const;

const ARGOCD_ORDER = [
  'name',
  'project',
  'chart',
  'values',
  'destination',
] as const;

const EXTERNAL_SECRETS_ORDER = [
  'name',
  'secretStore',
  'externalSecrets',
  'pushSecrets',
] as const;

const PROVIDER_SUB_ORDER: Record<string, readonly string[]> = {
  github: GITHUB_ORDER,
  terraform: TERRAFORM_ORDER,
  argocd: ARGOCD_ORDER,
  external_secrets: EXTERNAL_SECRETS_ORDER,
};

function sortByOrder(
  obj: Record<string, unknown>,
  order: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const key of order) {
    if (key in obj) {
      result[key] = obj[key];
      seen.add(key);
    }
  }

  const remaining = Object.keys(obj)
    .filter((k) => !seen.has(k))
    .sort();
  for (const key of remaining) {
    result[key] = obj[key];
  }

  return result;
}

function sortAnnotations(
  annotations: Record<string, unknown>,
): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(annotations).sort()) {
    sorted[key] = annotations[key];
  }
  return sorted;
}

function sortFeatures(features: unknown[]): unknown[] {
  return [...features].sort((a, b) => {
    if (
      typeof a === 'object' &&
      a !== null &&
      typeof b === 'object' &&
      b !== null &&
      'name' in a &&
      'name' in b
    ) {
      return String((a as { name: string }).name).localeCompare(
        String((b as { name: string }).name),
      );
    }
    return 0;
  });
}

function sortProviders(
  providers: Record<string, unknown>,
): Record<string, unknown> {
  const sorted = sortByOrder(providers, PROVIDERS_ORDER);

  for (const key of Object.keys(sorted)) {
    const value = sorted[key];
    if (typeof value !== 'object' || value === null) continue;
    const subOrder = PROVIDER_SUB_ORDER[key];
    if (subOrder) {
      sorted[key] = sortByOrder(value as Record<string, unknown>, subOrder);
    }
  }

  return sorted;
}

export function sortClaimKeys(
  claim: Record<string, unknown>,
): Record<string, unknown> {
  const sorted = sortByOrder(claim, ENVELOPE_ORDER);

  if (
    sorted.annotations &&
    typeof sorted.annotations === 'object' &&
    sorted.annotations !== null
  ) {
    sorted.annotations = sortAnnotations(
      sorted.annotations as Record<string, unknown>,
    );
  }

  if (
    sorted.providers &&
    typeof sorted.providers === 'object' &&
    !Array.isArray(sorted.providers)
  ) {
    sorted.providers = sortProviders(
      sorted.providers as Record<string, unknown>,
    );
  }

  if (sorted.features && Array.isArray(sorted.features)) {
    sorted.features = sortFeatures(sorted.features);
  }

  return sorted;
}

export function serializeClaim(claim: Record<string, unknown>): string {
  return YAML.stringify(sortClaimKeys(claim), { lineWidth: 120 });
}
