import { ClaimsClient } from '../claims/client.js';

import type { WorkflowDispatchResult } from '../claims/client.js';

export async function waitForDispatch(
  client: ClaimsClient,
  dispatchResult: WorkflowDispatchResult,
  options: {
    noWait?: boolean;
    claimType: string;
    claimName: string;
    label?: string;
  },
): Promise<string> {
  const label = options.label ?? 'Provisioning';
  const action = label.replace(/ing$/, '');

  if (options.noWait) {
    process.stderr.write(
      `${action} workflow dispatched (no-wait): ${dispatchResult.url}\n`,
    );
    return dispatchResult.url;
  }

  process.stderr.write(`${label}...\n`);
  try {
    const run = await client.waitForWorkflow(
      dispatchResult.correlationId,
      dispatchResult.workflowId,
      options.claimType,
      options.claimName,
      dispatchResult.branch,
      label,
    );
    if (run.conclusion !== 'success') {
      throw new Error(`${action} failed (${run.conclusion}): ${run.runUrl}`);
    }
    return run.runUrl;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`${action} wait failed: ${error.message}`);
    }
    throw error;
  }
}
