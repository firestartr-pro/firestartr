import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import github from 'github';
import type { WorkflowCompletionResult } from 'github';
import { resolveE2eFixturesPath } from '../fixtures-path';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
  retryAsync,
} from '../utils/async-control';
import { isRetryableGitHubError } from './wait';

// =============================================================================
// Workflow-based value verification
//
// GitHub never returns a repository secret's or organization variable's value,
// so exact equality is asserted inside a disposable repository: a
// workflow_dispatch workflow compares the provisioned value with the expected
// one and the run's conclusion becomes the authoritative assertion. Runs are
// correlated by a unique id surfaced as the run's display_title; the newest run
// is never assumed to belong to this test. The mechanism lives here so ADR-0003
// and ADR-0004 hold identically for every value kind.
// =============================================================================

const GITHUB_WRITE_RETRY_ATTEMPTS = 5;
const GITHUB_WRITE_RETRY_DELAY_MS = 5000;
const DEFAULT_VALUE_READ_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 10000;

type OrgOctokit = Awaited<ReturnType<typeof github.getOctokitForOrg>>;

type WorkflowRunListItem = {
  id: number;
  display_title?: string | null;
};

type WorkflowRunCompletion = Pick<
  WorkflowCompletionResult,
  'conclusion' | 'runId' | 'htmlUrl'
>;

export interface VerifyValueViaWorkflowOptions {
  org: string;
  repoName: string;
  /** File name under fixtures/workflows, e.g. 'verify-secret.yaml'. */
  workflowFixtureFileName: string;
  /** workflow_dispatch inputs, without the correlation input. */
  inputValues: Record<string, string>;
  /** Value kind reported in failure diagnostics, e.g. 'Repository secret'. */
  failureLabel: string;
  /** Verified value name reported in failure diagnostics. */
  valueName: string;
  /** Input name the fixture reads to set the run's display_title. */
  correlationInputName?: string;
  /** Per-run budget shared by correlation and completion. Default: 5 min. */
  timeoutMs?: number;
  /** Poll interval for workflow discovery, correlation and completion. */
  pollIntervalMs?: number;
}

export interface WorkflowVerificationResult {
  correlationId: string;
  runId: number;
  htmlUrl: string;
}

function workflowRepoPath(workflowFixtureFileName: string): string {
  return `.github/workflows/${workflowFixtureFileName}`;
}

export function selectCorrelatedWorkflowRun<Run extends WorkflowRunListItem>(
  runs: Run[],
  correlationId: string,
): Run | null {
  return runs.find((run) => run.display_title === correlationId) ?? null;
}

function assertWorkflowRunSucceeded(
  completion: WorkflowRunCompletion,
  context: {
    failureLabel: string;
    valueName: string;
    repoName: string;
    correlationId: string;
  },
): void {
  if (completion.conclusion === 'success') {
    return;
  }

  throw new Error(
    `${context.failureLabel} value verification failed for ` +
      `${context.repoName}/${context.valueName} ` +
      `(correlation ${context.correlationId}): workflow run ` +
      `${completion.runId} concluded with ` +
      `'${completion.conclusion ?? 'none'}'. Run URL: ${completion.htmlUrl}`,
  );
}

async function retryTransientGitHubProbe<T>(
  probe: () => Promise<T>,
): Promise<T> {
  try {
    return await probe();
  } catch (error) {
    if (isRetryableGitHubError(error)) {
      throw createRetryableError(error);
    }

    throw error;
  }
}

async function writeVerifyWorkflow(
  options: VerifyValueViaWorkflowOptions,
  repoPath: string,
): Promise<void> {
  const fixturePath = path.join(
    resolveE2eFixturesPath(),
    'workflows',
    options.workflowFixtureFileName,
  );
  const workflowContent = await fs.readFile(fixturePath, 'utf-8');

  await retryAsync(
    () =>
      github.repo.setContent(
        repoPath,
        workflowContent,
        options.repoName,
        options.org,
        'main',
        `test: add ${options.workflowFixtureFileName} verification workflow`,
      ),
    {
      attempts: GITHUB_WRITE_RETRY_ATTEMPTS,
      shouldRetry: (error) => isRetryableGitHubError(error),
      getDelayMs: () => GITHUB_WRITE_RETRY_DELAY_MS,
    },
  );
}

async function waitForRegisteredWorkflowId(
  octokit: OrgOctokit,
  options: VerifyValueViaWorkflowOptions,
  repoPath: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<number> {
  const workflow = await pollUntil(
    () =>
      retryTransientGitHubProbe(async () => {
        const response = await octokit.rest.actions.listRepoWorkflows({
          owner: options.org,
          repo: options.repoName,
          per_page: 100,
        });
        const workflows = response.data.workflows as {
          id: number;
          path: string;
        }[];
        return (
          workflows.find((candidate) => candidate.path === repoPath) ?? null
        );
      }),
    {
      timeoutMs,
      intervalMs: pollIntervalMs,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${repoPath} to be discoverable in ${options.org}/${options.repoName}`,
        ),
    },
  );

  if (workflow === null) {
    throw new Error(
      `Expected ${repoPath} to be discoverable in ${options.org}/${options.repoName}`,
    );
  }

  return workflow.id;
}

async function waitForCorrelatedWorkflowRun(
  octokit: OrgOctokit,
  options: VerifyValueViaWorkflowOptions,
  repoPath: string,
  workflowId: number,
  correlationId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<WorkflowRunListItem> {
  const run = await pollUntil(
    () =>
      retryTransientGitHubProbe(async () => {
        const response = await octokit.rest.actions.listWorkflowRuns({
          owner: options.org,
          repo: options.repoName,
          workflow_id: workflowId,
          per_page: 100,
        });
        return selectCorrelatedWorkflowRun(
          response.data.workflow_runs as WorkflowRunListItem[],
          correlationId,
        );
      }),
    {
      timeoutMs,
      intervalMs: pollIntervalMs,
      isDone: (value) => value !== null,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for a ${options.workflowFixtureFileName} run ` +
            `with display_title '${correlationId}' in ${options.org}/${options.repoName}`,
        ),
    },
  );

  if (run === null) {
    throw new Error(
      `Expected a ${options.workflowFixtureFileName} run with ` +
        `display_title '${correlationId}' in ${options.org}/${options.repoName}`,
    );
  }

  return run;
}

/**
 * Commits the verification workflow fixture, dispatches it exactly once with a
 * fresh correlation id, waits for the correlated run and asserts its
 * conclusion. Correlation and completion share the per-run budget.
 */
export async function verifyValueViaWorkflow(
  options: VerifyValueViaWorkflowOptions,
): Promise<WorkflowVerificationResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_VALUE_READ_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const repoPath = workflowRepoPath(options.workflowFixtureFileName);
  const octokit = await github.getOctokitForOrg(options.org);

  await writeVerifyWorkflow(options, repoPath);
  const workflowId = await waitForRegisteredWorkflowId(
    octokit,
    options,
    repoPath,
    timeoutMs,
    pollIntervalMs,
  );

  const correlationId = randomUUID();

  // Dispatched exactly once: failed or timed-out runs surface as test failures
  // rather than being redispatched automatically.
  await github.workflow.triggerWorkflow(
    options.org,
    options.repoName,
    workflowId,
    'main',
    {
      ...options.inputValues,
      [options.correlationInputName ?? 'correlation_id']: correlationId,
    },
    octokit,
  );

  const deadlineMs = Date.now() + timeoutMs;
  const run = await waitForCorrelatedWorkflowRun(
    octokit,
    options,
    repoPath,
    workflowId,
    correlationId,
    Math.max(deadlineMs - Date.now(), 1),
    pollIntervalMs,
  );
  const completion = await github.workflow.waitForWorkflowCompletion(
    options.org,
    options.repoName,
    run.id,
    Math.max(deadlineMs - Date.now(), 1),
    pollIntervalMs,
    octokit,
  );

  assertWorkflowRunSucceeded(completion, {
    failureLabel: options.failureLabel,
    valueName: options.valueName,
    repoName: options.repoName,
    correlationId,
  });

  return {
    correlationId,
    runId: completion.runId,
    htmlUrl: completion.htmlUrl,
  };
}

// Internal seams unit-tested directly (mirrors the k8s/diagnostics.ts pattern).
export { assertWorkflowRunSucceeded, retryTransientGitHubProbe };
