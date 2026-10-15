import common from 'catalog_common';

import type { GhFeatureRepoRateLimit } from './types';

const FEATURE_GIT_SHA = 'firestartr.dev/feature-git-sha';
const FEATURE_GIT_TAGS = 'firestartr.dev/feature-git-tags';
const FEATURE_REPO_TOKEN = common.types.envVars.githubAppPatPrefapp;

function isAbsent(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

// True when a git traceability annotation never made it onto the CR. The
// renderer skips empty values, so a rate-limited commit resolution (which
// yields an empty SHA and no tags) ships with both keys absent. A present but
// malformed value — wrong-length SHA, unparsable or empty tag list — is a
// stamping bug and never counts as missing, so it can never be blamed on
// quota.
export function missingGitTraceability(
  annotations: Record<string, string | undefined>,
): boolean {
  return (
    isAbsent(annotations[FEATURE_GIT_SHA]) ||
    isAbsent(annotations[FEATURE_GIT_TAGS])
  );
}

// Pure decision at the traceability assertion site: which error, if any,
// replaces the annotation matcher failure. Returns the explicit rate-limit
// error only when a git annotation is missing altogether *and* the feature
// repo quota probe was rejected by GitHub's explicit rate-limit response.
// Anything else — malformed annotations, no probe, quota still healthy —
// returns null so the original assertion fails untouched and a real
// regression stays visible.
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

// Failure-path-only orchestration around the pure decision. The probe is
// built lazily: never while the annotations are stamped or merely malformed
// (the happy path keeps its API budget, and a malformed value reports as the
// assertion error it is) and at most once per run, so several failing
// resources spend a single request. Returns the rate-limit error to throw in
// place of the annotation matcher failure, or null to let that failure report
// as usual.
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
