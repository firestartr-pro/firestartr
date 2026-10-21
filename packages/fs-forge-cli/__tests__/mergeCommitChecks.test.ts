import { describe, expect, it, jest } from '@jest/globals';

import { watchCheckRuns } from '../src/claims/checkRuns';
import { createOctokitApi } from '../src/github/octokitApi';

import type { Octokit } from '@octokit/rest';

const REF = { owner: 'example', repo: 'state-infra' };
const HEAD_CHECK = {
  name: 'plan',
  conclusion: 'success',
  status: 'completed',
  output: { title: null, summary: 'Plan passed', text: null },
  html_url: 'https://github.com/example/state-infra/checks/1',
};
const FAILED_APPLY = {
  ...HEAD_CHECK,
  name: 'apply',
  conclusion: 'failure',
  output: { title: null, summary: 'Apply failed', text: null },
  html_url: 'https://github.com/example/state-infra/checks/2',
};

type ApiCheck = Omit<typeof HEAD_CHECK, 'conclusion'> & { conclusion: string | null };

function checkApi(
  checksForRef: (ref: string, page: number) => ApiCheck[],
  mergeSha: string | null = 'merge-sha',
) {
  const octokit = {
    rest: {
      pulls: {
        get: jest.fn(async () => ({
          data: { head: { sha: 'head-sha' }, merge_commit_sha: mergeSha },
        })),
      },
      checks: {
        listForRef: jest.fn(async ({ ref, page = 1 }: { ref: string; page?: number }) => ({
          data: { check_runs: checksForRef(ref, page) },
        })),
      },
    },
  } as unknown as Octokit;
  return createOctokitApi(octokit);
}

describe('wet PR checks on head and merge commits', () => {
  it('fails when head checks pass but checks on the distinct merge SHA fail', async () => {
    const api = checkApi((ref) => ref === 'merge-sha' ? [FAILED_APPLY] : [HEAD_CHECK]);

    const result = await watchCheckRuns(api, REF, 7);

    expect(result.overallConclusion).toBe('failure');
    expect(result.checkRuns.map((check) => check.name)).toEqual(['plan', 'apply']);
  });

  it('succeeds when reconciliation checks exist only on the merge commit', async () => {
    const api = checkApi((ref) => ref === 'merge-sha' ? [HEAD_CHECK] : []);
    jest.useFakeTimers();
    try {
      const watching = watchCheckRuns(api, REF, 7, { timeoutMs: 200, pollIntervalMs: 50 });
      await jest.advanceTimersByTimeAsync(200);

      const result = await watching;

      expect(result.overallConclusion).toBe('success');
      expect(result.checkRuns).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('includes failed checks after the first result page', async () => {
    const api = checkApi((_ref, page) => page === 1 ? Array(100).fill(HEAD_CHECK) : [FAILED_APPLY], null);

    const result = await watchCheckRuns(api, REF, 7);

    expect(result.overallConclusion).toBe('failure');
    expect(result.checkRuns).toHaveLength(101);
  });

  it('times out rather than passing when merge-commit checks never register', async () => {
    const api = checkApi((ref) => ref === 'head-sha' ? [HEAD_CHECK] : []);
    jest.useFakeTimers();
    try {
      const watching = watchCheckRuns(api, REF, 7, { timeoutMs: 200, pollIntervalMs: 50 });
      await jest.advanceTimersByTimeAsync(200);

      expect((await watching).overallConclusion).toBe('timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps polling while merge-commit reconciliation checks have not registered', async () => {
    let mergePolls = 0;
    const api = checkApi((ref) => {
      if (ref === 'head-sha') return [HEAD_CHECK];
      mergePolls++;
      if (mergePolls === 1) return [];
      if (mergePolls === 2) return [{ ...FAILED_APPLY, status: 'in_progress', conclusion: null }];
      return [FAILED_APPLY];
    });
    jest.useFakeTimers();
    try {
      const watching = watchCheckRuns(api, REF, 7, { timeoutMs: 1000, pollIntervalMs: 100 });
      await jest.advanceTimersByTimeAsync(200);

      const result = await watching;

      expect(result.overallConclusion).toBe('failure');
      expect(result.checkRuns.map((check) => check.name)).toEqual(['plan', 'apply']);
    } finally {
      jest.useRealTimers();
    }
  });
});
