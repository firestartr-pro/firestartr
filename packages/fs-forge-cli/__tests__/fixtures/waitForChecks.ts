import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { expect, jest } from '@jest/globals';

import { createGitHubApi } from '../../src/github/index';
import { MemoryGitHubApi } from './memoryGitHubApi';

import type { CheckRunSummary, PullRequestSummary } from '../../src/github/api';

const ROOT = process.cwd();

export const WET_PR_NUMBER = 42;

export const SUCCESS_CHECK: CheckRunSummary = {
  name: 'plan',
  conclusion: 'success',
  status: 'completed',
  output: {
    title: null,
    summary: 'ComponentClaim/example: success',
    text: null,
  },
  htmlUrl: 'https://github.com/my-org/custom-state/checks/1',
};

export const FAILURE_CHECK: CheckRunSummary = {
  ...SUCCESS_CHECK,
  name: 'apply',
  conclusion: 'failure',
  output: {
    title: null,
    summary: 'ComponentClaim/example: failure',
    text: null,
  },
};

function matchingWetPr(claimName: string): PullRequestSummary {
  return {
    number: WET_PR_NUMBER,
    htmlUrl: `https://github.com/my-org/custom-state/pull/${WET_PR_NUMBER}`,
    state: 'open',
    headRef: `automated-component-${claimName}`,
    baseSha: 'base-sha',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

export function mockCommitApi(
  options: {
    claimName?: string;
    prs?: PullRequestSummary[];
    checkRuns?: CheckRunSummary[];
  } = {},
): MemoryGitHubApi {
  const api = new MemoryGitHubApi();
  api.autoCompleteDispatches = true;
  const claims = { owner: 'my-org', repo: 'claims' };
  api.setDefaultBranch(claims, 'main');
  api.setBranchHeadSha(claims, 'main', 'base-sha');
  api.setFile(
    claims,
    'claims-map.json',
    JSON.stringify({ headers: { sha: 'map-sha' }, claims: {} }),
    'map-file-sha',
  );

  for (const repo of ['custom-state', 'state-github', 'state-infra']) {
    const ref = { owner: 'my-org', repo };
    api.setPullRequests(
      ref,
      options.prs ?? [matchingWetPr(options.claimName ?? 'example')],
    );
    if (options.checkRuns !== undefined) {
      api.setCheckRuns(ref, WET_PR_NUMBER, options.checkRuns);
    }
  }

  (createGitHubApi as unknown as jest.Mock).mockReturnValue(api);
  return api;
}

export async function prepareAuditIssue(
  api: MemoryGitHubApi,
  issue: string,
): Promise<void> {
  if (issue === 'adopted') {
    await api.createIssue(
      { owner: 'my-org', repo: 'claims' },
      { title: 'Existing issue', body: '' },
    );
  }
}

export function closeIssueBeforeWetChecks(api: MemoryGitHubApi): void {
  // Provisioning merges the claims PR before the wet checks finish.
  const listChecks = api.listCheckRunsForPullRequest.bind(api);
  api.listCheckRunsForPullRequest = async (ref, pr) => {
    api.issues[0].state = 'closed';
    return listChecks(ref, pr);
  };
  api.calls.length = 0;
}

export function expectAuditWetCheckOutcome(
  api: MemoryGitHubApi,
  fails: boolean,
  failureBody: string,
): void {
  expect(api.issueComments).toEqual([
    expect.objectContaining({
      issue: 1,
      body: 'Workflow run: https://github.com/my-org/claims/actions/runs/1',
    }),
    ...(fails ? [expect.objectContaining({ issue: 1, body: failureBody })] : []),
  ]);
  const runComment = api.calls.indexOf('commentOnIssue my-org/claims#1');
  const checkWatch = api.calls.indexOf(
    `listCheckRunsForPullRequest my-org/custom-state#${WET_PR_NUMBER}`,
  );
  expect(runComment).toBeGreaterThanOrEqual(0);
  expect(checkWatch).toBeGreaterThan(runComment);
  expect(api.issues[0].state).toBe(fails ? 'open' : 'closed');
  if (fails) {
    expect(api.calls.indexOf('reopenIssue my-org/claims#1')).toBeGreaterThan(
      api.calls.lastIndexOf('commentOnIssue my-org/claims#1'),
    );
  } else {
    expect(api.calls).not.toContain('reopenIssue my-org/claims#1');
  }
}

type CommandClass = typeof Command &
  (new (argv: string[], config: Config) => Command);

export async function runCommand(command: CommandClass, argv: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    return await captureOutput(() => command.run(argv, { root: ROOT }));
  } finally {
    process.exitCode = previousExitCode;
  }
}
