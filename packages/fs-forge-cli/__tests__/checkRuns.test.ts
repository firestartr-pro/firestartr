import {
  pointInTimeCheck,
  parseCrNamesFromSummary,
  watchCheckRuns,
} from '../src/claims/checkRuns';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { CheckRunSummary, RepoRef } from '../src/github/api';

const REF: RepoRef = { owner: 'test', repo: 'repo' };

function createApi(checkRuns: CheckRunSummary[]): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  api.setCheckRuns(REF, 1, checkRuns);
  return api;
}

const SUCCESS_CHECK: CheckRunSummary = {
  name: 'terraform_plan',
  conclusion: 'success',
  status: 'completed',
  output: {
    title: 'Plan completed',
    summary: 'FirestartrGithubRepository/my-repo: success',
    text: null,
  },
  htmlUrl: 'https://github.com/test/repo/run/1',
};

describe('checkRuns', () => {
  describe('parseCrNamesFromSummary', () => {
    it('parses CR names from terraform output', () => {
      const summary = `FirestartrGithubRepository/my-repo: success
FirestartrGithubTeam/my-team: failure
SomeOtherOutput: not a CR`;

      const names = parseCrNamesFromSummary(summary);
      expect(names).toEqual([
        'FirestartrGithubRepository/my-repo',
        'FirestartrGithubTeam/my-team',
      ]);
    });

    it('returns empty array for empty summary', () => {
      const names = parseCrNamesFromSummary('');
      expect(names).toEqual([]);
    });
  });

  describe('pointInTimeCheck', () => {
    it('returns aggregated results for completed PR', async () => {
      const api = createApi([SUCCESS_CHECK]);

      const result = await pointInTimeCheck(api, REF, 1);

      expect(result.overallConclusion).toBe('success');
      expect(result.checkRuns).toHaveLength(1);
      expect(result.checkRuns[0].name).toBe('terraform_plan');
      expect(api.calls).toContain('listCheckRunsForPullRequest test/repo#1');
    });

    it('returns failure when any check fails', async () => {
      const api = createApi([
        {
          ...SUCCESS_CHECK,
          conclusion: 'failure',
          output: {
            title: 'Plan failed',
            summary: 'FirestartrGithubRepository/my-repo: failure',
            text: null,
          },
        },
      ]);

      const result = await pointInTimeCheck(api, REF, 1);

      expect(result.overallConclusion).toBe('failure');
    });

    it('returns no_checks when no check runs exist', async () => {
      const api = createApi([]);

      const result = await pointInTimeCheck(api, REF, 1);

      expect(result.overallConclusion).toBe('no_checks');
    });
  });

  describe('watchCheckRuns', () => {
    it('returns immediately when all checks are completed', async () => {
      const api = createApi([SUCCESS_CHECK]);

      const result = await watchCheckRuns(api, REF, 1, {
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });

      expect(result.overallConclusion).toBe('success');
    });

    it('times out when checks do not complete', async () => {
      const api = createApi([
        {
          ...SUCCESS_CHECK,
          conclusion: null,
          status: 'in_progress',
          output: {
            title: 'In progress',
            summary: 'Running...',
            text: null,
          },
        },
      ]);

      const result = await watchCheckRuns(api, REF, 1, {
        timeoutMs: 200,
        pollIntervalMs: 50,
      });

      expect(result.overallConclusion).toBe('timeout');
    });
  });
});
