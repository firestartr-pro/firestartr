import { describe, expect, it, jest } from '@jest/globals';

import { pollDispatchedRun } from '../src/claims/workflowRun';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { RepoRef, WorkflowRunSummary } from '../src/github/api';

const REF: RepoRef = { owner: 'example', repo: 'claims' };
const WORKFLOW = 'provision-claim.yaml';
const BRANCH = 'fs-forge/ComponentClaim-api';

function run(
  overrides: Partial<WorkflowRunSummary> & { event?: string } = {},
): WorkflowRunSummary & { event?: string } {
  return {
    id: 42,
    htmlUrl: 'https://example.test/run/42',
    status: 'completed',
    conclusion: 'success',
    displayTitle: 'corr-1',
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    correlationId: 'corr-1',
    workflowId: WORKFLOW,
    branch: BRANCH,
    claimType: 'ComponentClaim',
    claimName: 'api',
    ...overrides,
  };
}

describe('pollDispatchedRun', () => {
  it('returns ok when the run completes with success', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [run()]);

    await expect(pollDispatchedRun(api, REF, options())).resolves.toEqual({
      status: 'ok',
      runUrl: 'https://example.test/run/42',
      runId: 42,
      conclusion: 'success',
    });
    expect(api.calls).toEqual([
      `listWorkflowRuns example/claims:${WORKFLOW}@${BRANCH}`,
    ]);
  });

  it('returns error when the run completes with a failure', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({ conclusion: 'failure' }),
    ]);

    await expect(pollDispatchedRun(api, REF, options())).resolves.toEqual({
      status: 'error',
      runUrl: 'https://example.test/run/42',
      runId: 42,
      conclusion: 'failure',
    });
  });

  it('returns run_not_found after the grace period', async () => {
    const api = new MemoryGitHubApi();
    let clock = 0;
    const sleep = jest.fn(async (ms: number) => {
      clock += ms;
    });

    await expect(
      pollDispatchedRun(api, REF, {
        ...options(),
        now: () => clock,
        sleep,
        notFoundGraceMs: 30_000,
      }),
    ).resolves.toEqual({ status: 'run_not_found' });
    expect(sleep).toHaveBeenCalledTimes(7);
  });

  it('fails fast when the workflow itself is missing (404)', async () => {
    const api = new MemoryGitHubApi();
    api.listWorkflowRuns = async () => {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    };
    const sleep = jest.fn(async () => {});

    await expect(
      pollDispatchedRun(api, REF, { ...options(), sleep }),
    ).rejects.toThrow('Not Found');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('ignores runs triggered by other events', async () => {
    const api = new MemoryGitHubApi();
    let clock = 0;
    const sleep = jest.fn(async (ms: number) => {
      clock += ms;
    });
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({
        id: 1,
        status: 'in_progress',
        conclusion: null,
        event: 'push',
      }),
      run(),
    ]);

    await expect(
      pollDispatchedRun(api, REF, {
        ...options(),
        now: () => clock,
        sleep,
        timeoutMs: 10_000,
        pollIntervalMs: 1_000,
      }),
    ).resolves.toEqual({
      status: 'ok',
      runUrl: 'https://example.test/run/42',
      runId: 42,
      conclusion: 'success',
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('returns timeout with the last run URL', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({ status: 'in_progress', conclusion: null }),
    ]);
    let clock = 0;
    const sleep = jest.fn(async (ms: number) => {
      clock += ms;
    });

    await expect(
      pollDispatchedRun(api, REF, {
        ...options(),
        now: () => clock,
        sleep,
        timeoutMs: 10_000,
        pollIntervalMs: 1_000,
      }),
    ).resolves.toEqual({
      status: 'timeout',
      runUrl: 'https://example.test/run/42',
    });
    expect(sleep).toHaveBeenCalledTimes(10);
  });

  it('reports every status change and writes nothing', async () => {
    const api = new MemoryGitHubApi();
    const statuses = ['queued', 'in_progress', 'completed'];
    let index = 0;
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({ status: statuses[0], conclusion: null }),
    ]);
    const onStatus = jest.fn();
    const sleep = jest.fn(async () => {
      index++;
      api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
        run({
          status: statuses[index],
          conclusion: statuses[index] === 'completed' ? 'success' : null,
        }),
      ]);
    });
    const stdout = jest.spyOn(process.stdout, 'write');
    const stderr = jest.spyOn(process.stderr, 'write');

    try {
      const outcome = await pollDispatchedRun(api, REF, {
        ...options(),
        onStatus,
        sleep,
      });

      expect(outcome.status).toBe('ok');
      expect(onStatus.mock.calls).toEqual([
        ['queued'],
        ['in_progress'],
        ['completed'],
      ]);
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
