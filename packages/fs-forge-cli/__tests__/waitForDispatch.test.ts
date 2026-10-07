import { describe, expect, it } from '@jest/globals';

import { waitForDispatch } from '../src/utils/waitForDispatch';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { WorkflowDispatch } from '../src/claims/claimsRepo';
import type { RepoRef, WorkflowRunSummary } from '../src/github/api';
import type { PollOptions } from '../src/claims/workflowRun';

const REF: RepoRef = { owner: 'example', repo: 'claims' };
const WORKFLOW = 'provision-claim.yaml';
const BRANCH = 'fs-forge/ComponentClaim-api';
const RUN_URL = 'https://github.com/example/claims/actions/runs/42';
const DISPATCH: WorkflowDispatch = {
  url: `https://github.com/example/claims/actions/workflows/${WORKFLOW}`,
  correlationId: 'corr-1',
  workflowId: WORKFLOW,
  branch: BRANCH,
};

function run(overrides: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id: 42,
    htmlUrl: RUN_URL,
    status: 'completed',
    conclusion: 'success',
    displayTitle: 'corr-1',
    ...overrides,
  };
}

interface Presented {
  error?: Error;
  publishUrl?: string;
  stderr: string;
  stdout: string;
}

/**
 * Runs the presenter with recording writers so the exact bytes of every
 * outcome are asserted; the injected clock keeps the poller instant.
 */
async function present(options: {
  api: MemoryGitHubApi;
  isTty: boolean;
  noWait?: boolean;
  pollOptions?: Partial<PollOptions>;
}): Promise<Presented> {
  const stderrChunks: string[] = [];
  const stdoutChunks: string[] = [];
  const presented: Presented = { stderr: '', stdout: '' };
  try {
    presented.publishUrl = await waitForDispatch(
      options.api,
      REF,
      DISPATCH,
      {
        noWait: options.noWait,
        claimType: 'ComponentClaim',
        claimName: 'api',
        presentation: {
          isTty: options.isTty,
          stderr: (line) => void stderrChunks.push(line),
          stdout: (line) => void stdoutChunks.push(line),
        },
        pollOptions: options.pollOptions,
      },
    );
  } catch (error) {
    presented.error = error as Error;
  }
  presented.stderr = stderrChunks.join('');
  presented.stdout = stdoutChunks.join('');
  return presented;
}

function fakeClock() {
  let clock = 0;
  return {
    now: (): number => clock,
    sleep: async (ms: number): Promise<void> => {
      clock += ms;
    },
  };
}

describe('waitForDispatch presentation', () => {
  it('writes the label and the JSON outcome for a successful run', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [run()]);

    const presented = await present({ api, isTty: false });

    expect(presented.error).toBeUndefined();
    expect(presented.publishUrl).toBe(RUN_URL);
    expect(presented.stderr).toBe('Provisioning...\n');
    expect(presented.stdout).toBe(
      `${JSON.stringify({
        status: 'ok',
        runUrl: RUN_URL,
        runId: 42,
        claimType: 'ComponentClaim',
        claimName: 'api',
        conclusion: 'success',
      })}\n`,
    );
  });

  it('writes the dispatch URL in no-wait mode', async () => {
    const api = new MemoryGitHubApi();

    const presented = await present({ api, isTty: false, noWait: true });

    expect(presented.error).toBeUndefined();
    expect(presented.publishUrl).toBe(DISPATCH.url);
    expect(presented.stderr).toBe(
      `Provision workflow dispatched (no-wait): ${DISPATCH.url}\n`,
    );
    expect(presented.stdout).toBe('');
  });

  it('keeps the wait-failed prefix for a completed failure', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({ conclusion: 'failure' }),
    ]);

    const presented = await present({ api, isTty: false });

    expect(presented.error?.message).toBe(
      `Provision wait failed: Provision failed (failure): ${RUN_URL}`,
    );
    expect(presented.stderr).toBe('Provisioning...\n');
    expect(presented.stdout).toBe(
      `${JSON.stringify({
        status: 'error',
        runUrl: RUN_URL,
        runId: 42,
        claimType: 'ComponentClaim',
        claimName: 'api',
        conclusion: 'failure',
      })}\n`,
    );
  });

  it('keeps the double trailing newline for a TTY timeout', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({ status: 'in_progress', conclusion: null }),
    ]);

    const presented = await present({
      api,
      isTty: true,
      pollOptions: {
        ...fakeClock(),
        timeoutMs: 100,
        pollIntervalMs: 50,
      },
    });

    expect(presented.error?.message).toBe(
      'Provision wait failed: Workflow timed out after 0.1s',
    );
    expect(presented.stderr).toBe(
      'Provisioning...\n' +
        '\r\x1b[KProvisioning... in_progress' +
        'Workflow timed out after 0.1s\n\n',
    );
  });

  it('writes the timeout JSON and the wrapped error without a TTY', async () => {
    const api = new MemoryGitHubApi();
    api.setWorkflowRuns(REF, WORKFLOW, BRANCH, [
      run({ status: 'in_progress', conclusion: null }),
    ]);

    const presented = await present({
      api,
      isTty: false,
      pollOptions: {
        ...fakeClock(),
        timeoutMs: 100,
        pollIntervalMs: 50,
      },
    });

    expect(presented.error?.message).toBe(
      'Provision wait failed: Workflow timed out after 0.1s',
    );
    expect(presented.stderr).toBe('Provisioning...\n');
    expect(presented.stdout).toBe(
      `${JSON.stringify({
        status: 'timeout',
        claimType: 'ComponentClaim',
        claimName: 'api',
        runUrl: RUN_URL,
      })}\n`,
    );
  });

  it('keeps the double trailing newline for a TTY run-not-found', async () => {
    const api = new MemoryGitHubApi();

    const presented = await present({
      api,
      isTty: true,
      pollOptions: {
        ...fakeClock(),
        notFoundGraceMs: 100,
        pollIntervalMs: 50,
      },
    });

    expect(presented.error?.message).toBe(
      'Provision wait failed: Workflow run not found. Check example/claims/actions',
    );
    expect(presented.stderr).toBe(
      'Provisioning...\n' +
        'Workflow run not found. Check example/claims/actions\n\n',
    );
  });

  it('writes the run-not-found JSON and the wrapped error without a TTY', async () => {
    const api = new MemoryGitHubApi();

    const presented = await present({
      api,
      isTty: false,
      pollOptions: {
        ...fakeClock(),
        notFoundGraceMs: 100,
        pollIntervalMs: 50,
      },
    });

    expect(presented.error?.message).toBe(
      'Provision wait failed: Workflow run not found. Check example/claims/actions',
    );
    expect(presented.stderr).toBe('Provisioning...\n');
    expect(presented.stdout).toBe(
      `${JSON.stringify({
        status: 'error',
        reason: 'run_not_found',
        url: `https://github.com/example/claims/actions/workflows/${WORKFLOW}`,
        claimType: 'ComponentClaim',
        claimName: 'api',
      })}\n`,
    );
  });
});
