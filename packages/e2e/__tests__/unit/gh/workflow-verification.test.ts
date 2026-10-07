jest.mock('github', () => ({
  __esModule: true,
  default: {
    getOctokitForOrg: jest.fn(),
    repo: { setContent: jest.fn() },
    workflow: {
      triggerWorkflow: jest.fn(),
      waitForWorkflowCompletion: jest.fn(),
    },
  },
}));

import github from 'github';
import {
  assertWorkflowRunSucceeded,
  prepareWorkflowVerification,
  retryTransientGitHubProbe,
  selectCorrelatedWorkflowRun,
  verifyValueViaWorkflow,
} from '../../../src/gh/workflow-verification';
import { isRetryableError } from '../../../src/utils/async-control';

describe('Correlated workflow run selection', () => {
  const runs = [
    { id: 3, display_title: 'unrelated-run' },
    { id: 2, display_title: 'correlation-id-b' },
    { id: 1, display_title: 'correlation-id-a' },
  ];

  it('returns the run whose display title matches the correlation id', () => {
    expect(selectCorrelatedWorkflowRun(runs, 'correlation-id-a')).toEqual({
      id: 1,
      display_title: 'correlation-id-a',
    });
  });

  it('does not assume the newest run belongs to this test', () => {
    expect(selectCorrelatedWorkflowRun(runs, 'correlation-id-b')?.id).toBe(2);
  });

  it('returns null when no run carries the correlation id', () => {
    expect(selectCorrelatedWorkflowRun(runs, 'missing-id')).toBeNull();
    expect(selectCorrelatedWorkflowRun([], 'correlation-id-a')).toBeNull();
  });
});

describe('Workflow run conclusion assertion', () => {
  const context = {
    failureLabel: 'Repository secret',
    valueName: 'E2E_ACTIONS_SECRET',
    repoName: 'repo-a',
    correlationId: 'correlation-id-a',
  };

  it('does not throw when the run concluded successfully', () => {
    expect(() =>
      assertWorkflowRunSucceeded(
        {
          conclusion: 'success',
          runId: 123,
          htmlUrl: 'https://example.test/runs/123',
        },
        context,
      ),
    ).not.toThrow();
  });

  it.each(['failure', 'cancelled', 'timed_out', null])(
    'throws with run id and URL when the conclusion is %s',
    (conclusion) => {
      expect(() =>
        assertWorkflowRunSucceeded(
          {
            conclusion,
            runId: 456,
            htmlUrl: 'https://example.test/runs/456',
          },
          context,
        ),
      ).toThrow(
        /repo-a\/E2E_ACTIONS_SECRET.*run 456.*https:\/\/example\.test\/runs\/456/,
      );
    },
  );
});

describe('Transient GitHub probe retry marking', () => {
  it('passes the probe result through', async () => {
    await expect(retryTransientGitHubProbe(async () => 'value')).resolves.toBe(
      'value',
    );
  });

  it('rethrows a non-retryable error unchanged', async () => {
    const error = new Error('not retryable');

    await expect(
      retryTransientGitHubProbe(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it('marks a transient GitHub error as retryable for pollUntil', async () => {
    const error = Object.assign(new Error('service unavailable'), {
      status: 503,
    });
    let caught: unknown;

    try {
      await retryTransientGitHubProbe(async () => {
        throw error;
      });
    } catch (err) {
      caught = err;
    }

    expect(isRetryableError(caught)).toBe(true);
    expect((caught as Error).message).toBe('service unavailable');
  });
});

// =============================================================================
// Orchestration
//
// ADR-0003: the workflow fixture is committed once per repository, before the
// initial value check, and every later verification only dispatches a fresh
// correlated run. The GitHub client is mocked so the sequence — one prepare,
// N dispatches, one correlated run each — is provable without a cluster or
// GitHub credentials.
// =============================================================================

type OctokitStub = {
  rest: {
    actions: {
      listRepoWorkflows: jest.Mock;
      listWorkflowRuns: jest.Mock;
    };
  };
};

const githubMock = github as unknown as {
  getOctokitForOrg: jest.Mock;
  repo: { setContent: jest.Mock };
  workflow: {
    triggerWorkflow: jest.Mock;
    waitForWorkflowCompletion: jest.Mock;
  };
};

describe('Workflow value verification orchestration', () => {
  const ORG = 'org-a';
  const REPO = 'repo-a';
  const WORKFLOW_REPO_PATH = '.github/workflows/verify-secret.yaml';
  const PREPARE_OPTIONS = {
    org: ORG,
    repoName: REPO,
    workflowFixtureFileName: 'verify-secret.yaml',
    pollIntervalMs: 1,
  };
  const VALUE_CHECK = {
    failureLabel: 'Repository secret',
    valueName: 'E2E_ACTIONS_SECRET',
  };
  const EXPECTED_INPUTS = {
    secret_name: 'E2E_ACTIONS_SECRET',
    expected_value: 'initial-repo-secret',
  };

  let octokit: OctokitStub;
  let dispatched: { runId: number; inputs: Record<string, string> }[];

  beforeEach(() => {
    jest.clearAllMocks();

    octokit = {
      rest: {
        actions: {
          listRepoWorkflows: jest.fn().mockResolvedValue({
            data: { workflows: [{ id: 77, path: WORKFLOW_REPO_PATH }] },
          }),
          listWorkflowRuns: jest.fn(),
        },
      },
    };
    dispatched = [];
    let nextRunId = 1000;

    githubMock.getOctokitForOrg.mockResolvedValue(octokit);
    githubMock.repo.setContent.mockResolvedValue(undefined);
    githubMock.workflow.triggerWorkflow.mockImplementation(
      async (
        _org: string,
        _repo: string,
        _workflowId: number,
        _ref: string,
        inputs: Record<string, string>,
      ) => {
        nextRunId += 1;
        dispatched.push({ runId: nextRunId, inputs });
      },
    );
  });

  function latestDispatch(): { runId: number; inputs: Record<string, string> } {
    return dispatched[dispatched.length - 1];
  }

  function completedRun(runId: number) {
    return {
      conclusion: 'success',
      runId,
      htmlUrl: `https://example.test/runs/${runId}`,
    };
  }

  function correlateWithLatestDispatch(): void {
    octokit.rest.actions.listWorkflowRuns.mockImplementation(async () => ({
      data: {
        workflow_runs: [
          {
            id: latestDispatch().runId,
            display_title: latestDispatch().inputs.correlation_id,
          },
        ],
      },
    }));
  }

  it('commits the workflow once and dispatches once per value check', async () => {
    correlateWithLatestDispatch();
    githubMock.workflow.waitForWorkflowCompletion
      .mockResolvedValueOnce(completedRun(501))
      .mockResolvedValueOnce(completedRun(502));

    const verification = await prepareWorkflowVerification(PREPARE_OPTIONS);
    const initial = await verifyValueViaWorkflow(verification, {
      ...VALUE_CHECK,
      inputValues: EXPECTED_INPUTS,
    });
    const rotated = await verifyValueViaWorkflow(verification, {
      ...VALUE_CHECK,
      inputValues: {
        ...EXPECTED_INPUTS,
        expected_value: 'rotated-repo-secret',
      },
    });

    expect(verification.workflowId).toBe(77);
    expect(githubMock.getOctokitForOrg).toHaveBeenCalledTimes(1);
    expect(githubMock.repo.setContent).toHaveBeenCalledTimes(1);
    expect(githubMock.repo.setContent).toHaveBeenCalledWith(
      WORKFLOW_REPO_PATH,
      expect.any(String),
      REPO,
      ORG,
      'main',
      'test: add verify-secret.yaml verification workflow',
    );
    expect(octokit.rest.actions.listRepoWorkflows).toHaveBeenCalledTimes(1);
    expect(githubMock.workflow.triggerWorkflow).toHaveBeenCalledTimes(2);
    expect(dispatched[0].inputs).toEqual({
      ...EXPECTED_INPUTS,
      correlation_id: initial.correlationId,
    });
    expect(dispatched[1].inputs).toEqual({
      ...EXPECTED_INPUTS,
      expected_value: 'rotated-repo-secret',
      correlation_id: rotated.correlationId,
    });
    expect(initial.correlationId).not.toBe(rotated.correlationId);
    expect(
      githubMock.workflow.waitForWorkflowCompletion,
    ).toHaveBeenNthCalledWith(
      1,
      ORG,
      REPO,
      dispatched[0].runId,
      expect.any(Number),
      1,
      octokit,
    );
    expect(
      githubMock.workflow.waitForWorkflowCompletion,
    ).toHaveBeenNthCalledWith(
      2,
      ORG,
      REPO,
      dispatched[1].runId,
      expect.any(Number),
      1,
      octokit,
    );
    expect(initial.runId).toBe(501);
    expect(rotated.runId).toBe(502);
  });

  it('selects the correlated run across polling instead of the newest run', async () => {
    let polls = 0;
    octokit.rest.actions.listWorkflowRuns.mockImplementation(async () => {
      polls += 1;
      if (polls === 1) {
        return {
          data: {
            workflow_runs: [{ id: 9001, display_title: 'another-test-run' }],
          },
        };
      }
      return {
        data: {
          workflow_runs: [
            {
              id: latestDispatch().runId,
              display_title: latestDispatch().inputs.correlation_id,
            },
          ],
        },
      };
    });
    githubMock.workflow.waitForWorkflowCompletion.mockResolvedValue(
      completedRun(9002),
    );

    const verification = await prepareWorkflowVerification(PREPARE_OPTIONS);
    const result = await verifyValueViaWorkflow(verification, {
      ...VALUE_CHECK,
      inputValues: EXPECTED_INPUTS,
    });

    expect(octokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
    expect(githubMock.workflow.waitForWorkflowCompletion).toHaveBeenCalledWith(
      ORG,
      REPO,
      latestDispatch().runId,
      expect.any(Number),
      1,
      octokit,
    );
    expect(result.runId).toBe(9002);
  });

  it('dispatches once and fails with the run id, URL and correlation id', async () => {
    correlateWithLatestDispatch();
    githubMock.workflow.waitForWorkflowCompletion.mockResolvedValue({
      conclusion: 'failure',
      runId: 456,
      htmlUrl: 'https://example.test/runs/456',
    });

    const verification = await prepareWorkflowVerification(PREPARE_OPTIONS);
    let failure: Error | undefined;
    try {
      await verifyValueViaWorkflow(verification, {
        ...VALUE_CHECK,
        inputValues: EXPECTED_INPUTS,
      });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toBe(
      `Repository secret value verification failed for ${REPO}/E2E_ACTIONS_SECRET ` +
        `(correlation ${dispatched[0].inputs.correlation_id}): workflow run 456 ` +
        "concluded with 'failure'. Run URL: https://example.test/runs/456",
    );
    expect(githubMock.workflow.triggerWorkflow).toHaveBeenCalledTimes(1);
  });

  it('dispatches once and reports the deadline when no run carries the correlation id', async () => {
    octokit.rest.actions.listWorkflowRuns.mockResolvedValue({
      data: {
        workflow_runs: [{ id: 9001, display_title: 'another-test-run' }],
      },
    });

    const verification = await prepareWorkflowVerification({
      ...PREPARE_OPTIONS,
      timeoutMs: 30,
    });
    let failure: Error | undefined;
    try {
      await verifyValueViaWorkflow(verification, {
        ...VALUE_CHECK,
        inputValues: EXPECTED_INPUTS,
      });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toBe(
      'Timed out waiting for a verify-secret.yaml run with display_title ' +
        `'${dispatched[0].inputs.correlation_id}' in org-a/repo-a`,
    );
    expect(githubMock.workflow.triggerWorkflow).toHaveBeenCalledTimes(1);
    expect(
      githubMock.workflow.waitForWorkflowCompletion,
    ).not.toHaveBeenCalled();
  });

  it('does not redispatch when the run never completes before the deadline', async () => {
    correlateWithLatestDispatch();
    githubMock.workflow.waitForWorkflowCompletion.mockRejectedValue(
      new Error(
        'Workflow run 123 did not complete within 5000ms. Current status: ' +
          'in_progress. Workflow URL: https://example.test/runs/123',
      ),
    );

    const verification = await prepareWorkflowVerification(PREPARE_OPTIONS);

    await expect(
      verifyValueViaWorkflow(verification, {
        ...VALUE_CHECK,
        inputValues: EXPECTED_INPUTS,
      }),
    ).rejects.toThrow(/did not complete within 5000ms/);
    expect(githubMock.workflow.triggerWorkflow).toHaveBeenCalledTimes(1);
  });
});
