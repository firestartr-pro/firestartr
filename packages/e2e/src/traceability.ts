import common from 'catalog_common';

import type { GhFeatureRepoRateLimit } from './types';

const FEATURE_GIT_SHA = 'firestartr.dev/feature-git-sha';
const FEATURE_GIT_TAGS = 'firestartr.dev/feature-git-tags';
const FEATURE_REPO_TOKEN = common.types.envVars.githubAppPatPrefapp;

function isAbsent(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

export function missingGitTraceability(
  annotations: Record<string, string | undefined>,
): boolean {
  return (
    isAbsent(annotations[FEATURE_GIT_SHA]) ||
    isAbsent(annotations[FEATURE_GIT_TAGS])
  );
}

export function traceabilityFailureError(
  annotations: Record<string, string | undefined>,
  probe: GhFeatureRepoRateLimit | null,
): Error | null {
  if (
    !missingGitTraceability(annotations) ||
    probe === null ||
    !probe.exhausted
  ) {
    return null;
  }

  const subject = probe.subject ? ` for ${probe.subject}` : '';
  const resetAt = new Date(probe.reset * 1000).toISOString();

  return new Error(
    `GitHub API rate limit exceeded${subject}: the ${FEATURE_REPO_TOKEN} quota ` +
      `behind feature commit resolution has ${probe.remaining}/${probe.limit} ` +
      `requests left and resets at ${resetAt}. ` +
      `The git traceability annotations (${FEATURE_GIT_SHA}, ` +
      `${FEATURE_GIT_TAGS}) are missing because resolution was rate limited, ` +
      'not because traceability regressed — rerun after the reset.',
  );
}

export function createTraceabilityDiagnosis(
  probe: () => Promise<GhFeatureRepoRateLimit | null>,
): (annotations: Record<string, string | undefined>) => Promise<Error | null> {
  let quota: Promise<GhFeatureRepoRateLimit | null> | null = null;

  return async (annotations) => {
    if (!missingGitTraceability(annotations)) {
      return null;
    }

    quota ??= probe();
    return traceabilityFailureError(annotations, await quota);
  };
}
