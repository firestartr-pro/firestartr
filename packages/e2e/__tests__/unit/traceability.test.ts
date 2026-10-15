import {
  createTraceabilityDiagnosis,
  missingGitTraceability,
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

function missingShaAnnotations(): Record<string, string> {
  return stampedAnnotations({ 'firestartr.dev/feature-git-sha': '' });
}

function exhaustedProbe(
  overrides: Partial<GhFeatureRepoRateLimit> = {},
): GhFeatureRepoRateLimit {
  return {
    limit: 5000,
    remaining: 0,
    reset: RESET_SECONDS,
    subject: 'user ID 88989834',
    exhausted: true,
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
    exhausted: false,
    ...overrides,
  };
}

describe('missingGitTraceability', () => {
  it('is false for a stamped SHA and a non-empty tag list', () => {
    expect(missingGitTraceability(stampedAnnotations())).toBe(false);
  });

  it('is true when a git annotation is absent or empty', () => {
    const noSha = stampedAnnotations();
    delete noSha['firestartr.dev/feature-git-sha'];
    expect(missingGitTraceability(noSha)).toBe(true);

    const noTags = stampedAnnotations();
    delete noTags['firestartr.dev/feature-git-tags'];
    expect(missingGitTraceability(noTags)).toBe(true);

    expect(
      missingGitTraceability(
        stampedAnnotations({ 'firestartr.dev/feature-git-sha': '' }),
      ),
    ).toBe(true);
    expect(
      missingGitTraceability(
        stampedAnnotations({ 'firestartr.dev/feature-git-tags': '   ' }),
      ),
    ).toBe(true);
  });

  it('is false for present-but-malformed values', () => {
    expect(
      missingGitTraceability(
        stampedAnnotations({ 'firestartr.dev/feature-git-sha': 'abc' }),
      ),
    ).toBe(false);
    expect(
      missingGitTraceability(
        stampedAnnotations({
          'firestartr.dev/feature-git-sha': 'A'.repeat(40),
        }),
      ),
    ).toBe(false);
    expect(
      missingGitTraceability(
        stampedAnnotations({
          'firestartr.dev/feature-git-tags': JSON.stringify([]),
        }),
      ),
    ).toBe(false);
    expect(
      missingGitTraceability(
        stampedAnnotations({ 'firestartr.dev/feature-git-tags': 'not json' }),
      ),
    ).toBe(false);
    expect(
      missingGitTraceability(
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

  it('never blames quota for malformed annotations', () => {
    const malformedTags = stampedAnnotations({
      'firestartr.dev/feature-git-tags': JSON.stringify([]),
    });
    const unparsableTags = stampedAnnotations({
      'firestartr.dev/feature-git-tags': 'not json',
    });
    const malformedSha = stampedAnnotations({
      'firestartr.dev/feature-git-sha': 'abc',
    });

    for (const annotations of [malformedTags, unparsableTags, malformedSha]) {
      expect(
        traceabilityFailureError(annotations, exhaustedProbe()),
      ).toBeNull();
    }
  });

  it('returns null without a probe so the original assertion still fails', () => {
    expect(traceabilityFailureError(missingShaAnnotations(), null)).toBeNull();
  });

  it('returns null when the probe sees healthy quota', () => {
    expect(
      traceabilityFailureError(missingShaAnnotations(), healthyProbe()),
    ).toBeNull();
  });

  it('ignores a zeroed quota from a probe GitHub did not rate-limit', () => {
    expect(
      traceabilityFailureError(
        missingShaAnnotations(),
        healthyProbe({ remaining: 0, subject: 'user ID 88989834' }),
      ),
    ).toBeNull();
  });

  it('names the rate limit, the token, the counts and the reset time', () => {
    const error = traceabilityFailureError(
      missingShaAnnotations(),
      exhaustedProbe(),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toContain('GitHub API rate limit exceeded');
    expect(error?.message).toContain('PREFAPP_BOT_PAT');
    expect(error?.message).toContain('user ID 88989834');
    expect(error?.message).toContain('0/5000');
    expect(error?.message).toContain(RESET_ISO);
    expect(error?.message).toContain('firestartr.dev/feature-git-sha');
    expect(error?.message).toContain('firestartr.dev/feature-git-tags');
  });

  it('omits the subject when GitHub did not name one', () => {
    const error = traceabilityFailureError(
      missingShaAnnotations(),
      exhaustedProbe({ subject: null }),
    );

    expect(error?.message).toContain('GitHub API rate limit exceeded');
    expect(error?.message).not.toContain('for user');
  });
});

describe('createTraceabilityDiagnosis', () => {
  it('never probes when the annotations are stamped', async () => {
    const probe = jest.fn().mockResolvedValue(exhaustedProbe());
    const diagnose = createTraceabilityDiagnosis(probe);

    await expect(diagnose(stampedAnnotations())).resolves.toBeNull();

    expect(probe).not.toHaveBeenCalled();
  });

  it('never probes for malformed annotations', async () => {
    const probe = jest.fn().mockResolvedValue(exhaustedProbe());
    const diagnose = createTraceabilityDiagnosis(probe);
    const annotations = stampedAnnotations({
      'firestartr.dev/feature-git-tags': 'not json',
    });

    await expect(diagnose(annotations)).resolves.toBeNull();

    expect(probe).not.toHaveBeenCalled();
  });

  it('returns the rate-limit error when the probe was rate-limited', async () => {
    const probe = jest.fn().mockResolvedValue(exhaustedProbe());
    const diagnose = createTraceabilityDiagnosis(probe);

    const error = await diagnose(missingShaAnnotations());

    expect(error?.message).toContain('GitHub API rate limit exceeded');
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the probe sees healthy quota', async () => {
    const probe = jest.fn().mockResolvedValue(healthyProbe());
    const diagnose = createTraceabilityDiagnosis(probe);

    await expect(diagnose(missingShaAnnotations())).resolves.toBeNull();

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('probes once across several failing resources', async () => {
    const probe = jest.fn().mockResolvedValue(healthyProbe());
    const diagnose = createTraceabilityDiagnosis(probe);
    const annotations = missingShaAnnotations();

    await diagnose(annotations);
    await diagnose(annotations);
    await diagnose(annotations);

    expect(probe).toHaveBeenCalledTimes(1);
  });
});
