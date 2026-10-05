import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { captureOutput } from '@oclif/test';

jest.mock('../src/github/index', () => ({
  createGitHubApi: jest.fn(),
}));

import { createGitHubApi } from '../src/github/index';
import WatchChecks from '../src/commands/watch-checks';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { CheckRunSummary, PullRequestSummary } from '../src/github/api';

const ROOT = process.cwd();
const ORIGINAL_ORG = process.env.FSCRT_ORG;
const MockCreateGitHubApi = createGitHubApi as unknown as jest.Mock;

const STATE_REPO = { owner: 'my-org', repo: 'state-github' };

function pull(
  number: number,
  headRef: string,
  updatedAt = '2026-01-01T00:00:00Z',
): PullRequestSummary {
  return {
    number,
    htmlUrl: `https://github.com/my-org/state-github/pull/${number}`,
    state: 'open',
    headRef,
    baseSha: 'base-sha',
    updatedAt,
  };
}

function checkRun(
  name: string,
  conclusion: string | null,
  status = 'completed',
): CheckRunSummary {
  return {
    name,
    conclusion,
    status,
    output: {
      title: null,
      summary: 'ComponentClaim/my-app: success',
      text: null,
    },
    htmlUrl: `https://github.com/my-org/state-github/checks/${name}`,
  };
}

function mockApi(): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  api.setDefaultBranch({ owner: 'my-org', repo: 'claims' }, 'main');
  MockCreateGitHubApi.mockReturnValue(api);
  return api;
}

async function run(...flags: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(async () => {
      await WatchChecks.run(flags, { root: ROOT });
      return 0;
    });
  } finally {
    process.exitCode = previousExitCode;
  }
}

beforeAll(() => {
  delete process.env.FSCRT_ORG;
});

afterEach(() => {
  MockCreateGitHubApi.mockClear();
  process.exitCode = 0;
  if (ORIGINAL_ORG === undefined) {
    delete process.env.FSCRT_ORG;
  } else {
    process.env.FSCRT_ORG = ORIGINAL_ORG;
  }
});

describe('watch-checks watch mode', () => {
  it('exits 0 when the wet PR checks pass', async () => {
    const api = mockApi();
    api.setPullRequests(STATE_REPO, [
      pull(42, 'automated-componentclaim-my-app'),
    ]);
    api.setCheckRuns(STATE_REPO, 42, [checkRun('plan', 'success')]);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
    );

    expect(outcome.error?.oclif?.exit).toBe(0);
    expect(outcome.stderr).toContain('Watching wet PR my-org/state-github#42...');
    expect(outcome.stderr).toContain('All checks passed ✓');
    expect(outcome.stdout).toContain('plan');
  });

  it('exits 1 when a wet PR check fails', async () => {
    const api = mockApi();
    api.setPullRequests(STATE_REPO, [
      pull(42, 'automated-componentclaim-my-app'),
    ]);
    api.setCheckRuns(STATE_REPO, 42, [checkRun('apply', 'failure')]);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
    );

    expect(outcome.error?.oclif?.exit).toBe(1);
    expect(outcome.stderr).toContain('Some checks failed ✗');
  });

  it(
    'exits 2 when the checks time out',
    async () => {
      const api = mockApi();
      api.setPullRequests(STATE_REPO, [
        pull(42, 'automated-componentclaim-my-app'),
      ]);
      api.setCheckRuns(STATE_REPO, 42, [checkRun('plan', null, 'in_progress')]);

      const outcome = await run(
        'ComponentClaim-my-app',
        '--org',
        'my-org',
        '--state-repos',
        'my-org/state-github',
        '--timeout',
        '1',
      );

      expect(outcome.error?.oclif?.exit).toBe(2);
      expect(outcome.stderr).toContain('Timed out waiting for checks');
    },
    20_000,
  );

  it('exits 3 with a JSON payload when no wet PR matches', async () => {
    mockApi();

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
      '--json',
    );

    expect(outcome.error?.oclif?.exit).toBe(3);
    expect(JSON.parse(outcome.stdout)).toEqual({
      status: 'error',
      mode: 'watch',
      org: 'my-org',
      claimRef: 'ComponentClaim-my-app',
      exitCode: 3,
    });
  });

  it('emits the watch JSON payload on success', async () => {
    const api = mockApi();
    api.setPullRequests(STATE_REPO, [
      pull(42, 'automated-componentclaim-my-app'),
    ]);
    api.setCheckRuns(STATE_REPO, 42, [checkRun('plan', 'success')]);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
      '--json',
    );

    expect(outcome.error?.oclif?.exit).toBe(0);
    expect(JSON.parse(outcome.stdout)).toEqual(
      expect.objectContaining({
        status: 'ok',
        mode: 'watch',
        org: 'my-org',
        claimRef: 'ComponentClaim-my-app',
        overallConclusion: 'success',
        exitCode: 0,
        wetPr: {
          repo: 'my-org/state-github',
          number: 42,
          url: 'https://github.com/my-org/state-github/pull/42',
          state: 'open',
        },
      }),
    );
  });

  it('follows the last-state-pr redirect of a deletion PR', async () => {
    const api = mockApi();
    api.setPullRequests(STATE_REPO, [
      pull(200, 'automated-componentclaim-my-app'),
    ]);
    api.setPullRequestFiles(STATE_REPO, 200, [
      { filename: 'cr.yaml', status: 'removed' },
    ]);
    api.setFile(
      STATE_REPO,
      'cr.yaml',
      [
        'metadata:',
        '  annotations:',
        '    firestartr.dev/claim-ref: ComponentClaim/my-app',
        '    firestartr.dev/last-state-pr: state-github#100',
      ].join('\n'),
    );
    api.setCheckRuns(STATE_REPO, 100, [checkRun('plan', 'success')]);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
    );

    expect(outcome.error?.oclif?.exit).toBe(0);
    expect(outcome.stderr).toContain(
      'Watching wet PR my-org/state-github#100 (via last-state-pr from deletion PR my-org/state-github#200)...',
    );
    expect(api.calls).toContain(
      'listCheckRunsForPullRequest my-org/state-github#100',
    );
  });
});

describe('watch-checks current mode', () => {
  const CR_CONTENT = [
    'apiVersion: firestartr.dev/v1',
    'kind: FirestartrGithubRepository',
    'metadata:',
    '  name: state-github',
    '  annotations:',
    '    firestartr.dev/claim-ref: ComponentClaim/my-app',
    '    firestartr.dev/last-state-pr: state-github#100',
  ].join('\n');

  it('exits 0 with the CR and its last PR checks', async () => {
    const api = mockApi();
    api.setSearchResults(STATE_REPO, [
      { path: 'cr.yaml', name: 'cr.yaml' },
    ]);
    api.setFile(STATE_REPO, 'cr.yaml', CR_CONTENT);
    api.setPullRequests(STATE_REPO, [pull(100, 'automated-componentclaim-my-app')]);
    api.setCheckRuns(STATE_REPO, 100, [checkRun('plan', 'success')]);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
      '--current',
    );

    expect(outcome.error?.oclif?.exit).toBe(0);
    expect(outcome.stdout).toContain('CR: FirestartrGithubRepository/state-github');
    expect(outcome.stdout).toContain('plan: success');
  });

  it('exits 1 when the CR has no last-state-pr annotation', async () => {
    const api = mockApi();
    api.setSearchResults(STATE_REPO, [
      { path: 'cr.yaml', name: 'cr.yaml' },
    ]);
    api.setFile(
      STATE_REPO,
      'cr.yaml',
      'metadata:\n  name: state-github\n  annotations:\n    firestartr.dev/claim-ref: ComponentClaim/my-app',
    );

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
      '--current',
    );

    expect(outcome.error?.oclif?.exit).toBe(1);
    expect(outcome.stdout).toContain(
      'PR: unknown (no last-state-pr annotation)',
    );
  });

  it('exits 3 when --cr-name filters out every CR', async () => {
    const api = mockApi();
    api.setSearchResults(STATE_REPO, [
      { path: 'cr.yaml', name: 'cr.yaml' },
    ]);
    api.setFile(STATE_REPO, 'cr.yaml', CR_CONTENT);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
      '--current',
      '--cr-name',
      'nope',
    );

    expect(outcome.error?.oclif?.exit).toBe(3);
    expect(outcome.stderr).toContain('No CRs found for ComponentClaim-my-app');
  });

  it('keeps only the CR matching --cr-name', async () => {
    const api = mockApi();
    api.setSearchResults(STATE_REPO, [
      { path: 'cr.yaml', name: 'cr.yaml' },
      { path: 'other.yaml', name: 'other.yaml' },
    ]);
    api.setFile(STATE_REPO, 'cr.yaml', CR_CONTENT);
    api.setFile(
      STATE_REPO,
      'other.yaml',
      CR_CONTENT.replace('name: state-github', 'name: other-cr'),
    );
    api.setPullRequests(STATE_REPO, [pull(100, 'automated-componentclaim-my-app')]);
    api.setCheckRuns(STATE_REPO, 100, [checkRun('plan', 'success')]);

    const outcome = await run(
      'ComponentClaim-my-app',
      '--org',
      'my-org',
      '--state-repos',
      'my-org/state-github',
      '--current',
      '--cr-name',
      'other-cr',
    );

    expect(outcome.error?.oclif?.exit).toBe(0);
    expect(outcome.stdout).toContain('CR: FirestartrGithubRepository/other-cr');
    expect(outcome.stdout).not.toContain('CR: FirestartrGithubRepository/state-github');
  });
});
