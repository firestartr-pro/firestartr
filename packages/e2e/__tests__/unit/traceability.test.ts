import {
  hasGitTraceability,
  traceabilityFailureError,
} from '../../src/traceability';
import type { GhFeatureRepoRateLimit } from '../../src/types';

const VALID_SHA = 'a'.repeat(40);
const RESET_SECONDS = 1710000000;
const RESET_ISO = new Date(RESET_SECONDS * 1000).toISOString();

function stampedAnnotations(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    'firestartr.dev/feature-git-sha': VALID_SHA,
    'firestartr.dev/feature-git-tags': JSON.stringify(['charts_repo-v1']),
    ...overrides,
  };
}

function exhaustedProbe(
  overrides: Partial<GhFeatureRepoRateLimit> = {},
): GhFeatureRepoRateLimit {
  return {
    limit: 5000,
    remaining: 0,
    reset: RESET_SECONDS,
    subject: 'user ID 88989834',
    ...overrides,
  };
}

function healthyProbe(
  overrides: Partial<GhFeatureRepoRateLimit> = {},
): GhFeatureRepoRateLimit {
  return {
    limit: 5000,
    remaining: 1234,
    reset: RESET_SECONDS,
    subject: null,
    ...overrides,
  };
}

describe('hasGitTraceability', () => {
  it('accepts a stamped SHA and a non-empty tag list', () => {
    expect(hasGitTraceability(stampedAnnotations())).toBe(true);
  });

  it('rejects a missing SHA annotation', () => {
    const annotations = stampedAnnotations();
    delete annotations['firestartr.dev/feature-git-sha'];

    expect(hasGitTraceability(annotations)).toBe(false);
  });

  it('rejects a SHA that is not 40 lowercase hex chars', () => {
    expect(
      hasGitTraceability(
        stampedAnnotations({ 'firestartr.dev/feature-git-sha': 'abc' }),
      ),
    ).toBe(false);
    expect(
      hasGitTraceability(
        stampedAnnotations({
          'firestartr.dev/feature-git-sha': 'A'.repeat(40),
        }),
      ),
    ).toBe(false);
  });

  it('rejects missing, empty or malformed tag annotations', () => {
    const noTags = stampedAnnotations();
    delete noTags['firestartr.dev/feature-git-tags'];

    expect(hasGitTraceability(noTags)).toBe(false);
    expect(
      hasGitTraceability(
        stampedAnnotations({
          'firestartr.dev/feature-git-tags': JSON.stringify([]),
        }),
      ),
    ).toBe(false);
    expect(
      hasGitTraceability(
        stampedAnnotations({ 'firestartr.dev/feature-git-tags': 'not json' }),
      ),
    ).toBe(false);
    expect(
      hasGitTraceability(
        stampedAnnotations({
          'firestartr.dev/feature-git-tags': JSON.stringify([1]),
        }),
      ),
    ).toBe(false);
  });
});

describe('traceabilityFailureError', () => {
  it('stays silent when the annotations are stamped, whatever the quota', () => {
    expect(traceabilityFailureError(stampedAnnotations(), null)).toBeNull();
    expect(
      traceabilityFailureError(stampedAnnotations(), exhaustedProbe()),
    ).toBeNull();
  });

  it('returns null without a probe so the original assertion still fails', () => {
    const annotations = stampedAnnotations({
      'firestartr.dev/feature-git-sha': '',
    });

    expect(traceabilityFailureError(annotations, null)).toBeNull();
  });

  it('returns null when the probe sees healthy quota', () => {
    const annotations = stampedAnnotations({
      'firestartr.dev/feature-git-tags': JSON.stringify([]),
    });

    expect(traceabilityFailureError(annotations, healthyProbe())).toBeNull();
  });

  it('names the rate limit, the token, the counts and the reset time', () => {
    const annotations = stampedAnnotations({
      'firestartr.dev/feature-git-sha': '',
    });

    const error = traceabilityFailureError(annotations, exhaustedProbe());

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('GitHub API rate limit exceeded');
    expect(error?.message).toContain('PREFAPP_BOT_PAT');
    expect(error?.message).toContain('user ID 88989834');
    expect(error?.message).toContain('0/5000');
    expect(error?.message).toContain(RESET_ISO);
    expect(error?.message).toContain('firestartr.dev/feature-git-sha');
  });

  it('omits the subject when GitHub did not name one', () => {
    const annotations = stampedAnnotations({
      'firestartr.dev/feature-git-tags': 'not json',
    });

    const error = traceabilityFailureError(
      annotations,
      exhaustedProbe({ subject: null }),
    );

    expect(error?.message).toContain('GitHub API rate limit exceeded');
    expect(error?.message).not.toContain('for user');
  });
});
