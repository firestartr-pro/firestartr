import { getOctokitForOrg } from './auth';
import log from './logger';

export type WorkflowDispatchInputs = Record<string, string | number | boolean>;

export type WorkflowRunStatusFilter = 'completed' | 'in_progress' | 'queued';

export type WorkflowRunStatus = WorkflowRunStatusFilter | string;

export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'timed_out'
  | 'neutral'
  | 'action_required'
  | 'skipped'
  | 'stale'
  | 'unknown'
  | null
  | string;

export interface WorkflowRunSummary {
  id: number;
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion;
  html_url: string;
}

export interface WorkflowCompletionResult {
  status: WorkflowRunStatus;
  conclusion: WorkflowRunConclusion;
  runId: number;
  htmlUrl: string;
}

/**
 * Trigger a workflow_dispatch event
 * @param owner - GitHub organization
 * @param repo - Repository name
 * @param workflowId - Workflow file name (e.g., 'deploy.yaml') or workflow ID
 * @param ref - Git ref to run on (branch, tag, or SHA)
 * @param inputs - Workflow input key-value pairs (strings, numbers, or booleans)
 */
export async function triggerWorkflow(
  owner: string,
  repo: string,
  workflowId: string | number,
  ref: string,
  inputs?: WorkflowDispatchInputs,
  octokit?: any,
) {
  log.info(
    `Triggering workflow ${workflowId} in ${owner}/${repo} on ref ${ref}`,
  );

  if (!octokit) {
    try {
      octokit = await getOctokitForOrg(owner);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to get Octokit client for organization '${owner}' while triggering workflow '${workflowId}' in repository '${owner}/${repo}' on ref '${ref}': ${message}`,
      );
    }
  }

  await octokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: workflowId,
    ref,
    inputs,
  });

  log.info(`Workflow ${workflowId} triggered successfully`);
}

/**
 * Get workflow run details
 * @param owner - GitHub organization
 * @param repo - Repository name
 * @param runId - Workflow run ID
 */
export async function getWorkflowRun(
  owner: string,
  repo: string,
  runId: number,
  octokit?: any,
): Promise<WorkflowRunSummary> {
  log.info(`Getting workflow run ${runId} for ${owner}/${repo}`);

  if (!octokit) {
    try {
      octokit = await getOctokitForOrg(owner);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to get Octokit client for organization '${owner}' while getting workflow run '${runId}' in repository '${owner}/${repo}': ${message}`,
      );
    }
  }

  const response = await octokit.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });

  return response.data;
}

/**
 * List recent workflow runs
 * @param owner - GitHub organization
 * @param repo - Repository name
 * @param workflowId - Optional workflow file name or ID to filter by
 * @param branch - Optional branch name to filter by
 * @param status - Optional status to filter by
 */
export async function listWorkflowRuns(
  owner: string,
  repo: string,
  workflowId?: string | number,
  branch?: string,
  status?: WorkflowRunStatusFilter,
  octokit?: any,
): Promise<WorkflowRunSummary[]> {
  log.info(`Listing workflow runs for ${owner}/${repo}`);

  if (!octokit) {
    try {
      octokit = await getOctokitForOrg(owner);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to get Octokit client for organization '${owner}' while listing workflow runs in repository '${owner}/${repo}': ${message}`,
      );
    }
  }

  if (workflowId) {
    const response = await octokit.rest.actions.listWorkflowRuns({
      owner,
      repo,
      workflow_id: workflowId,
      branch,
      status,
      per_page: 100,
    });
    return response.data.workflow_runs;
  } else {
    const response = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch,
      status,
      per_page: 100,
    });
    return response.data.workflow_runs;
  }
}

/**
 * Wait for workflow to complete with timeout
 * Polls on the provided interval. Default timeout is 5 minutes (300000ms).
 * @param owner - GitHub organization
 * @param repo - Repository name
 * @param runId - Workflow run ID
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 300000ms / 5 minutes)
 * @param pollIntervalMs - Polling interval in milliseconds (default: 10000ms / 10 seconds)
 */
export async function waitForWorkflowCompletion(
  owner: string,
  repo: string,
  runId: number,
  timeoutMs = 300000,
  pollIntervalMs = 10000,
  octokit?: any,
): Promise<WorkflowCompletionResult> {
  log.info(
    `Waiting for workflow run ${runId} to complete (timeout: ${timeoutMs}ms, poll interval: ${pollIntervalMs}ms)`,
  );

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const run = await getWorkflowRun(owner, repo, runId, octokit);

    log.debug(
      `Workflow run ${runId} status: ${run.status}, conclusion: ${run.conclusion}`,
    );

    if (run.status === 'completed') {
      log.info(
        `Workflow run ${runId} completed with conclusion: ${run.conclusion}`,
      );
      return {
        status: run.status,
        conclusion: run.conclusion,
        runId: run.id,
        htmlUrl: run.html_url,
      };
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout reached
  const run = await getWorkflowRun(owner, repo, runId);
  log.warn(`Workflow run ${runId} did not complete within timeout`);

  throw new Error(
    `Workflow run ${runId} did not complete within ${timeoutMs}ms. Current status: ${run.status}. Workflow URL: ${run.html_url}`,
  );
}

export default {
  triggerWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  waitForWorkflowCompletion,
};
