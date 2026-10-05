import type { GitHubApi, RepoRef } from '../github/api.js';

export type RunOutcome =
  | {
      status: 'ok' | 'error';
      runUrl: string;
      runId: number;
      conclusion: string;
    }
  | { status: 'timeout'; runUrl?: string }
  | { status: 'run_not_found' };

export interface PollOptions {
  correlationId: string;
  workflowId: string;
  branch: string;
  claimType: string;
  claimName: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  notFoundGraceMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (status: string) => void;
}

const DEFAULT_TIMEOUT_MS = 1_200_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_NOT_FOUND_GRACE_MS = 30_000;

export { DEFAULT_TIMEOUT_MS };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the workflow run dispatched with `correlationId` (ADR 0007) and
 * returns its outcome. Writes nothing and owns no presentation.
 */
export async function pollDispatchedRun(
  api: GitHubApi,
  ref: RepoRef,
  options: PollOptions,
): Promise<RunOutcome> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const notFoundGraceMs = options.notFoundGraceMs ?? DEFAULT_NOT_FOUND_GRACE_MS;
  const deadline = now() + timeoutMs;
  const notFoundDeadline = now() + notFoundGraceMs;

  let currentStatus = '';
  let lastRunUrl: string | undefined;

  while (now() < deadline) {
    const runs = await api.listWorkflowRuns(ref, {
      workflowId: options.workflowId,
      branch: options.branch,
      event: 'workflow_dispatch',
      perPage: 30,
    });
    const run = runs.find(
      (candidate) => candidate.displayTitle === options.correlationId,
    );

    if (!run) {
      if (now() > notFoundDeadline) return { status: 'run_not_found' };
      await sleep(pollIntervalMs);
      continue;
    }

    lastRunUrl = run.htmlUrl;
    if (run.status !== currentStatus) {
      currentStatus = run.status;
      options.onStatus?.(currentStatus);
    }

    if (run.status === 'completed') {
      const conclusion = run.conclusion ?? 'unknown';
      return {
        status: conclusion === 'success' ? 'ok' : 'error',
        runUrl: run.htmlUrl,
        runId: run.id,
        conclusion,
      };
    }

    await sleep(pollIntervalMs);
  }

  return lastRunUrl
    ? { status: 'timeout', runUrl: lastRunUrl }
    : { status: 'timeout' };
}
