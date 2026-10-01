import { watchCheckRuns, pointInTimeCheck, parseCrNamesFromSummary } from '../src/claims/checkRuns';
import { ClaimsClient } from '../src/claims/client';

function createMockClient(
  checkRuns: Array<{
    name: string;
    conclusion: string | null;
    status: string;
    output: { title: string | null; summary: string; text: string | null };
    html_url: string;
    annotations_url: string | null;
  }>,
): ClaimsClient {
  const mockOctokit = {
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 1,
            html_url: 'https://github.com/test/repo/pull/1',
            state: 'open',
            merged: false,
          },
        }),
      },
      checks: {
        listForRef: async () => ({
          data: {
            check_runs: checkRuns,
          },
        }),
      },
      repos: {
        get: async () => ({
          data: { default_branch: 'main' },
        }),
      },
    },
  };

  return new ClaimsClient('test-org', mockOctokit as never);
}

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
      const client = createMockClient([
        {
          name: 'terraform_plan',
          conclusion: 'success',
          status: 'completed',
          output: {
            title: 'Plan completed',
            summary: 'FirestartrGithubRepository/my-repo: success',
            text: null,
          },
          html_url: 'https://github.com/test/repo/run/1',
          annotations_url: null,
        },
      ]);

      const result = await pointInTimeCheck(client, 'test', 'repo', 1);

      expect(result.overallConclusion).toBe('success');
      expect(result.checkRuns).toHaveLength(1);
      expect(result.checkRuns[0].name).toBe('terraform_plan');
    });

    it('returns failure when any check fails', async () => {
      const client = createMockClient([
        {
          name: 'terraform_plan',
          conclusion: 'failure',
          status: 'completed',
          output: {
            title: 'Plan failed',
            summary: 'FirestartrGithubRepository/my-repo: failure',
            text: null,
          },
          html_url: 'https://github.com/test/repo/run/1',
          annotations_url: null,
        },
      ]);

      const result = await pointInTimeCheck(client, 'test', 'repo', 1);

      expect(result.overallConclusion).toBe('failure');
    });

    it('returns no_checks when no check runs exist', async () => {
      const client = createMockClient([]);

      const result = await pointInTimeCheck(client, 'test', 'repo', 1);

      expect(result.overallConclusion).toBe('no_checks');
    });
  });

  describe('watchCheckRuns', () => {
    it('returns immediately when all checks are completed', async () => {
      const client = createMockClient([
        {
          name: 'terraform_plan',
          conclusion: 'success',
          status: 'completed',
          output: {
            title: 'Plan completed',
            summary: 'All resources planned',
            text: null,
          },
          html_url: 'https://github.com/test/repo/run/1',
          annotations_url: null,
        },
      ]);

      const result = await watchCheckRuns(client, 'test', 'repo', 1, {
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });

      expect(result.overallConclusion).toBe('success');
    });

    it('times out when checks do not complete', async () => {
      const client = createMockClient([
        {
          name: 'terraform_plan',
          conclusion: null,
          status: 'in_progress',
          output: {
            title: 'In progress',
            summary: 'Running...',
            text: null,
          },
          html_url: 'https://github.com/test/repo/run/1',
          annotations_url: null,
        },
      ]);

      const result = await watchCheckRuns(client, 'test', 'repo', 1, {
        timeoutMs: 200,
        pollIntervalMs: 50,
      });

      expect(result.overallConclusion).toBe('timeout');
    });
  });
});
