import common from 'catalog_common';

import type { GhFeatureRepoRateLimit } from './types';

const FEATURE_GIT_SHA = 'firestartr.dev/feature-git-sha';
const FEATURE_GIT_TAGS = 'firestartr.dev/feature-git-tags';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const FEATURE_REPO_TOKEN = common.types.envVars.githubAppPatPrefapp;

function parseTags(raw: string | undefined): string[] | null {
  if (raw === undefined) {
    return null;
  }

  try {
    const tags = JSON.parse(raw);
    if (!Array.isArray(tags)) {
      return null;
    }
    return tags.every((tag) => typeof tag === 'string') ? tags : null;
  } catch {
    return null;
  }
}

// True when the Feature CR carries the git traceability annotations the
// traceability suite asserts: a 40-char commit SHA and a non-empty JSON array
// of tag names.
export function hasGitTraceability(
  annotations: Record<string, string | undefined>,
): boolean {
  const sha = annotations[FEATURE_GIT_SHA];
  if (!sha || !COMMIT_SHA_PATTERN.test(sha)) {
    return false;
  }

  const tags = parseTags(annotations[FEATURE_GIT_TAGS]);
  return tags !== null && tags.length > 0;
}

// Pure decision at the traceability assertion site: which error, if any,
// replaces the annotation matcher failure. Returns the explicit rate-limit
// error only when the git annotations are missing/invalid *and* the feature
// repo quota probe was rejected by GitHub's explicit rate-limit response;
// otherwise null, so the original assertion fails untouched and a real
// regression stays visible.
export function traceabilityFailureError(
  annotations: Record<string, string | undefined>,
  probe: GhFeatureRepoRateLimit | null,
): Error | null {
  if (hasGitTraceability(annotations) || probe === null || !probe.exhausted) {
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

// Failure-path-only orchestration around the pure decision. The probe is
// built lazily: never while the annotations are stamped (the happy path keeps
// its API budget) and at most once per run, so several failing resources spend
// a single request. Returns the rate-limit error to throw in place of the
// annotation matcher failure, or null to let that failure report as usual.
export function createTraceabilityDiagnosis(
  probe: () => Promise<GhFeatureRepoRateLimit | null>,
): (annotations: Record<string, string | undefined>) => Promise<Error | null> {
  let quota: Promise<GhFeatureRepoRateLimit | null> | null = null;

  return async (annotations) => {
    if (hasGitTraceability(annotations)) {
      return null;
    }

    quota ??= probe();
    return traceabilityFailureError(annotations, await quota);
  };
}
