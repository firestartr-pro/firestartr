import {
  assertWorkflowRunSucceeded,
  retryTransientGitHubProbe,
  selectCorrelatedWorkflowRun,
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
