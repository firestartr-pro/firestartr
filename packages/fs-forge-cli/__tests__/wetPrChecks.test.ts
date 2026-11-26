import { describe, expect, it } from '@jest/globals';

import { describeWetPrFailure } from '../src/claims/wetPrChecks.js';

import type { AggregatedCheckResult, CheckRunResult } from '../src/claims/checkRuns.js';

const TARGET = { owner: 'acme', repo: 'acme/state-github', number: 7 };
const PR = 'acme/state-github#7 https://github.com/acme/state-github/pull/7';

function checkRun(
  name: string,
  conclusion: string | null,
  htmlUrl: string | null = null,
): CheckRunResult {
  return {
    name,
    conclusion,
    status: 'completed',
    output: { title: null, summary: '', text: null },
    htmlUrl,
  };
}

function aggregate(
  overallConclusion: string,
  checkRuns: CheckRunResult[],
): AggregatedCheckResult {
  return { overallConclusion, checkRuns, perCrStatus: new Map() };
}

describe('describeWetPrFailure', () => {
  it('names the only failing check and skips the passing ones', () => {
    const result = aggregate('failure', [
      checkRun('lint', 'success'),
      checkRun('docs', 'skipped'),
      checkRun('flaky', 'neutral'),
      checkRun('apply', 'failure', 'https://github.com/acme/state-github/runs/1'),
    ]);

    expect(describeWetPrFailure('failure', TARGET, result)).toBe(
      `Wet PR checks failed: failure (${PR}, apply https://github.com/acme/state-github/runs/1)`,
    );
  });

  it('names every failing check when the PR has several', () => {
    const result = aggregate('failure', [
      checkRun('apply', 'failure'),
      checkRun('lint', 'success'),
      checkRun('plan', 'cancelled'),
      checkRun('test', 'timed_out'),
    ]);

    expect(describeWetPrFailure('failure', TARGET, result)).toBe(
      `Wet PR checks failed: failure (${PR}, apply, plan, test)`,
    );
  });

  it('caps the named checks at five and counts the rest', () => {
    const checkRuns = Array.from({ length: 50 }, (_, index) =>
      checkRun(`FirestartrGithubRepository - apply #${index + 1}`, 'failure'),
    );

    const message = describeWetPrFailure(
      'failure',
      TARGET,
      aggregate('failure', checkRuns),
    );

    expect(message).toBe(
      `Wet PR checks failed: failure (${PR}, ` +
        'FirestartrGithubRepository - apply #1, ' +
        'FirestartrGithubRepository - apply #2, ' +
        'FirestartrGithubRepository - apply #3, ' +
        'FirestartrGithubRepository - apply #4, ' +
        'FirestartrGithubRepository - apply #5, and +45 more)',
    );
  });

  it('adds no suffix when exactly five checks fail', () => {
    const checkRuns = Array.from({ length: 5 }, (_, index) =>
      checkRun(`apply ${index + 1}`, 'failure'),
    );

    expect(
      describeWetPrFailure('failure', TARGET, aggregate('failure', checkRuns)),
    ).toBe(`Wet PR checks failed: failure (${PR}, apply 1, apply 2, apply 3, apply 4, apply 5)`);
  });

  it('names only the PR when no check run failed', () => {
    expect(
      describeWetPrFailure('no_checks', TARGET, aggregate('no_checks', [])),
    ).toBe(`Wet PR checks failed: no_checks (${PR})`);
  });
});
