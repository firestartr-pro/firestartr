import {
  DEFAULT_TIMEOUT_MS,
  pollDispatchedRun,
} from '../claims/workflowRun.js';

import type { GitHubApi, RepoRef } from '../github/api.js';
import type { PollOptions, RunOutcome } from '../claims/workflowRun.js';
import type { WorkflowDispatch } from '../claims/claimsRepo.js';

export interface DispatchPresentation {
  isTty: boolean;
  stderr: (line: string) => void;
  stdout: (line: string) => void;
}

export interface WaitForDispatchOptions {
  noWait?: boolean;
  claimType: string;
  claimName: string;
  label?: string;
  presentation?: Partial<DispatchPresentation>;
  pollOptions?: Partial<PollOptions>;
}

function defaultPresentation(): DispatchPresentation {
  return {
    isTty: Boolean(process.stderr.isTTY),
    stderr: (line) => process.stderr.write(line),
    stdout: (line) => process.stdout.write(line),
  };
}

/**
 * Presents a dispatched workflow run and resolves to its URL. The strings and
 * JSON payloads match the pre-refactor CLI byte for byte; the polling and the
 * result semantics live in `pollDispatchedRun`.
 */
export async function waitForDispatch(
  api: GitHubApi,
  ref: RepoRef,
  dispatchResult: WorkflowDispatch,
  options: WaitForDispatchOptions,
): Promise<string> {
  const label = options.label ?? 'Provisioning';
  const action = label.replace(/ing$/, '');
  const presentation: DispatchPresentation = {
    ...defaultPresentation(),
    ...options.presentation,
  };
  const timeoutMs = options.pollOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (options.noWait) {
    presentation.stderr(
      `${action} workflow dispatched (no-wait): ${dispatchResult.url}\n`,
    );
    return dispatchResult.url;
  }

  presentation.stderr(`${label}...\n`);

  let outcome: RunOutcome;
  try {
    outcome = await pollDispatchedRun(api, ref, {
      correlationId: dispatchResult.correlationId,
      workflowId: dispatchResult.workflowId,
      branch: dispatchResult.branch,
      claimType: options.claimType,
      claimName: options.claimName,
      ...options.pollOptions,
      onStatus: (status) => {
        if (presentation.isTty) {
          presentation.stderr(`\r\x1b[K${label}... ${status}`);
        }
        options.pollOptions?.onStatus?.(status);
      },
    });
  } catch (error) {
    throw waitFailure(error, action, presentation);
  }

  if (outcome.status === 'run_not_found') {
    const message = `Workflow run not found. Check ${ref.owner}/${ref.repo}/actions`;
    if (presentation.isTty) {
      presentation.stderr(message);
    } else {
      presentation.stdout(
        `${JSON.stringify({
          status: 'error',
          reason: 'run_not_found',
          url: `https://github.com/${ref.owner}/${ref.repo}/actions/workflows/${dispatchResult.workflowId}`,
          claimType: options.claimType,
          claimName: options.claimName,
        })}\n`,
      );
    }
    throw waitFailure(new Error(message), action, presentation);
  }

  if (outcome.status === 'timeout') {
    const message = `Workflow timed out after ${timeoutMs / 1000}s`;
    if (presentation.isTty) {
      presentation.stderr(message);
    } else {
      const payload: Record<string, unknown> = {
        status: 'timeout',
        claimType: options.claimType,
        claimName: options.claimName,
      };
      if (outcome.runUrl) payload.runUrl = outcome.runUrl;
      presentation.stdout(`${JSON.stringify(payload)}\n`);
    }
    throw waitFailure(new Error(message), action, presentation);
  }

  if (presentation.isTty) {
    const mark = outcome.conclusion === 'success' ? '✓' : '✗';
    presentation.stderr(`\r\x1b[K${label}... ${outcome.conclusion} ${mark}\n`);
  } else {
    presentation.stdout(
      `${JSON.stringify({
        status: outcome.status,
        runUrl: outcome.runUrl,
        runId: outcome.runId,
        claimType: options.claimType,
        claimName: options.claimName,
        conclusion: outcome.conclusion,
      })}\n`,
    );
  }

  if (outcome.status !== 'ok') {
    throw new Error(
      `${action} failed (${outcome.conclusion}): ${outcome.runUrl}`,
    );
  }
  return outcome.runUrl;
}

function waitFailure(
  error: unknown,
  action: string,
  presentation: DispatchPresentation,
): unknown {
  if (presentation.isTty) presentation.stderr('\n');
  if (error instanceof Error) {
    return new Error(`${action} wait failed: ${error.message}`);
  }
  return error;
}
