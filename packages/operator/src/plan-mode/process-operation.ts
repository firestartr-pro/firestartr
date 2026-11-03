import common from 'catalog_common';
import ghProvisioner from 'gh_provisioner';
import * as path from 'path';
import { runTerraformProvisioner } from 'terraform_provisioner';
import type { PlanArtifact, ReadOnlyStateSource } from 'terraform_provisioner';

import { getSecret } from '../ctl';
import { OperationType, WorkItem } from '../definitions';
import { deletionWaitsForDependants } from '../dependants';
import log from '../logger';
import {
  getParentRef,
  isDependentKind,
  isProvisioned,
} from '../parentDependency';
import { ResolverError } from '../resolver';
import { policyAllowsOp } from '../tfworkspaces/policies';
import {
  buildProvisionerContext,
  generateSessionId,
  tearUpSessionWorkspace,
} from '../tfworkspaces/process-operation';
import { extractErrorDetails } from '../utils';

import {
  PlanArtifactPaths,
  PlanRecord,
  PlanResult,
  planSummaryLine,
  writePlanArtifacts,
} from './artifacts';

const TF_CACHES_PATH = '/tmp/tfcaches';

/**
 * Plans read the live Terraform state from a snapshot of its backend secret,
 * never through the backend: OpenTofu would lock it and write an empty state
 * for a workspace that has none yet.
 */
const readOnlyState: ReadOnlyStateSource = {
  readKubernetesSecret: (namespace, name) => getSecret(namespace, name),
};

export type PlanDecision =
  { plan: 'plan' | 'plan-destroy' } | { nothing: true } | { skip: string };

type Planner = (
  item: any,
  handler: any,
  destroy: boolean,
  decision: PlanDecision,
) => Promise<PlanArtifact>;

/** Resolves what a plan needs, throwing ResolverError when it is missing. */
type DependencyResolver = (
  item: any,
  handler: any,
  destroy: boolean,
) => Promise<any>;

function annotation(item: any, name: string): string | undefined {
  return item.metadata?.annotations?.[name] || undefined;
}

function isDestroy(item: any, op: OperationType): boolean {
  if (op === OperationType.MARKED_TO_DELETION) return true;

  return (
    (op === OperationType.RETRY || op === OperationType.RETRY_SYNC) &&
    'deletionTimestamp' in item.metadata
  );
}

function planFor(destroy: boolean): PlanDecision {
  return { plan: destroy ? 'plan-destroy' : 'plan' };
}

/**
 * What the live Terraform workspace handler would do for this operation,
 * expressed as a plan: the same policy and sync-policy filters apply.
 */
export function decideTerraformPlan(
  item: any,
  op: OperationType,
): PlanDecision {
  const policy = annotation(item, 'firestartr.dev/policy');
  const syncPolicy = annotation(item, 'firestartr.dev/sync-policy');

  if (!policy || policy === 'observe' || policy === 'observe-only') {
    return planFor('deletionTimestamp' in item.metadata);
  }

  const { allowed } = policyAllowsOp(policy, op, item);

  if (!allowed) return { skip: `policy ${policy} blocks ${op}` };

  if (op === OperationType.NOTHING) return { nothing: true };

  const destroy = isDestroy(item, op);

  if (
    !destroy &&
    syncPolicy &&
    (op === OperationType.SYNC || op === OperationType.RETRY_SYNC)
  ) {
    let compatible = false;

    try {
      compatible = common.policies.policiesAreCompatible(syncPolicy, policy);
    } catch {
      compatible = false;
    }

    if (!compatible) {
      return {
        skip: `sync-policy ${syncPolicy} is not compatible with policy ${policy}`,
      };
    }
  }

  return planFor(destroy);
}

/** What the live GitHub handler would do for this operation, as a plan. */
export function decideGithubPlan(item: any, op: OperationType): PlanDecision {
  if (op === OperationType.NOTHING) return { nothing: true };

  const destroy = isDestroy(item, op);

  // The live reimport wipes the Terraform state first; a read-only plan
  // against the current state would preview a different operation
  if (
    !destroy &&
    annotation(item, common.generic.getFirestartrAnnotation('import')) &&
    annotation(item, common.generic.getFirestartrAnnotation('needs-re-import'))
  ) {
    return { skip: 'reimport cannot be previewed without resetting state' };
  }

  return planFor(destroy);
}

function processCtl(item: any, handler: any, planDecision: PlanDecision) {
  // For executable plans with NOTHING timeouts (e.g., observe, observe-only,
  // or no policy with an already-provisioned workspace), use a planning timeout
  // instead of the 10-second NOTHING timeout. Preserve explicit custom timeouts.
  const isExecutablePlan = 'plan' in planDecision;
  const recommendedTimeout = handler.recommendedTimeout();
  const customTimeout = annotation(
    item,
    common.generic.getFirestartrAnnotation('test-custom-timeout'),
  );
  const isNothingTimeout =
    recommendedTimeout === 10 &&
    (customTimeout === undefined || isNaN(parseInt(customTimeout)));

  const hardTimeout =
    isExecutablePlan && isNothingTimeout ? 24 * 60 * 60 : recommendedTimeout; // DAY_SECONDS for planning

  return {
    tfCacheDir: path.join(
      TF_CACHES_PATH,
      `slot_${handler.getSlotInfo().slotId}`,
    ),
    hardTimeout,
    processKilled: (killed: boolean) => {
      log.error(
        killed
          ? `The Terraform plan for item '${item.kind}/${item.metadata.name}' was killed due to a timeout.`
          : `PANIC!!: The Terraform plan for item '${item.kind}/${item.metadata.name}' could not be killed`,
      );
    },
  };
}

const resolveTerraformDependencies: DependencyResolver = async (
  _item,
  handler,
) => await handler.resolveReferences();

const planTerraformWorkspace: Planner = async (
  item,
  handler,
  destroy,
  decision,
) => {
  const sessionId = generateSessionId();

  const deps = await resolveTerraformDependencies(item, handler, destroy);

  try {
    return await runTerraformProvisioner(
      { ...buildProvisionerContext(item, deps, sessionId), readOnlyState },
      destroy ? 'plan-destroy-artifact' : 'plan-artifact',
      null,
      undefined,
      processCtl(item, handler, decision),
    );
  } finally {
    await tearUpSessionWorkspace(item, deps, sessionId, 'plan');
  }
};

/**
 * Plan mode dispatches dependents without waiting for their parent, and a
 * parent ref with needsSecret: false resolves even when it is unprovisioned.
 */
function assertParentProvisioned(item: any, deps: any) {
  if (!isDependentKind(item.kind)) return;

  const parent = getParentRef({ item } as WorkItem);

  if (!parent) return;

  const key = `${parent.kind}-${parent.name}`;

  if (!isProvisioned(deps[key]?.cr)) throw new ResolverError(key);
}

const resolveGithubDependencies: DependencyResolver = async (
  item,
  handler,
  destroy,
) => {
  const deps = await handler.resolveReferences();

  if (!destroy) {
    assertParentProvisioned(item, deps);

    deps['self-outputs'] = { cr: await handler.resolveOwnOutputs() };
  }

  return deps;
};

const planGithubResource: Planner = async (
  item,
  handler,
  destroy,
  decision,
) => {
  const deps = await resolveGithubDependencies(item, handler, destroy);

  return await ghProvisioner.runGhProvisioner(
    { mainCr: item, deps },
    {
      planArtifact: true,
      readOnlyState,
      ...(destroy ? { planDestroy: true } : { plan: true }),
      ctl: processCtl(item, handler, decision),
    },
  );
};

/**
 * Only a dependency confirmed absent (no CR, no outputs secret, or a 404
 * lookup) is a skip; any other lookup failure is an error to retry.
 */
function isMissingDependency(error: ResolverError): boolean {
  if (error.cause === undefined) return true;

  const cause: any = error.cause;

  return (
    cause?.code === 404 ||
    cause?.statusCode === 404 ||
    /: Not Found$/.test(String(cause?.message ?? ''))
  );
}

function missingParent(error: ResolverError): string {
  const separator = error.refKey.indexOf('-');

  const parent =
    separator === -1
      ? error.refKey
      : `${error.refKey.slice(0, separator)}/${error.refKey.slice(separator + 1)}`;

  return `parent ${parent} not provisioned`;
}

/**
 * Plans one CR and records the outcome as artifacts. It yields no status
 * transitions: nothing is written to the cluster or to GitHub.
 */
async function* planOperation(
  item: any,
  op: OperationType,
  handler: any,
  decision: PlanDecision,
  planner: Planner,
  resolveDependencies: DependencyResolver,
) {
  let result: PlanResult;

  let missingDependency = false;

  // This plan supersedes any wait for the dependencies of an earlier one
  if (handler.cancelDependencyWait) handler.cancelDependencyWait();

  // A new reconciliation starts with a fresh retry budget; only RETRY and
  // RETRY_SYNC continue the one the earlier failure opened
  if (op !== OperationType.RETRY && op !== OperationType.RETRY_SYNC) {
    try {
      if (handler.removeFromRetry) handler.removeFromRetry();
    } catch (e) {
      log.warn(`Failed to clear retry watcher: ${e}`);
    }
  }

  if (deletionWaitsForDependants(item, op)) {
    decision = {
      skip: 'deletion waits for its dependants (foreground-deletion finalizer)',
    };
  }

  if ('skip' in decision) {
    result = { status: 'SKIPPED', reason: decision.skip };
  } else if ('nothing' in decision) {
    result = { status: 'NOTHING' };
  } else {
    try {
      const artifact = await planner(
        item,
        handler,
        decision.plan === 'plan-destroy',
        decision,
      );

      result = {
        status: 'PLANNED',
        counts: artifact.summary,
        text: artifact.text,
        json: artifact.json,
      };
    } catch (e: any) {
      missingDependency = e instanceof ResolverError && isMissingDependency(e);

      result = missingDependency
        ? { status: 'SKIPPED', reason: missingParent(e) }
        : {
            status: 'ERROR',
            reason: extractErrorDetails(e).output || String(e),
          };
    }
  }

  const record: PlanRecord = {
    kind: item.kind,
    name: item.metadata.name,
    namespace: item.metadata.namespace,
    operation: op,
    planCommand: 'plan' in decision ? decision.plan : undefined,
    policy: annotation(item, 'firestartr.dev/policy') ?? 'none',
    plannedAt: new Date().toISOString(),
    lock: 'none',
    result,
  };

  let paths: PlanArtifactPaths;

  try {
    paths = await writePlanArtifacts(record);
  } catch (e) {
    // The dead-letter handler finishes the work item: the retry has to be
    // scheduled before the write error propagates, or this CR gets no artifact
    handler.error();

    throw e;
  }

  const line = planSummaryLine(record, paths);

  if (result.status === 'ERROR') {
    log.error(line);

    handler.error();
  } else {
    log.info(line);

    handler.success();
  }

  // Nothing requeues this CR when its dependency becomes available (a parent
  // only changes its status), so keep checking for it in memory
  if (missingDependency && handler.waitForDependencies) {
    const destroy = 'plan' in decision && decision.plan === 'plan-destroy';

    handler.waitForDependencies(async () => {
      try {
        await resolveDependencies(item, handler, destroy);
      } catch (e) {
        if (e instanceof ResolverError && isMissingDependency(e)) return false;
      }

      return true;
    });
  }

  yield* [];
}

export function planTerraformOperation(
  item: any,
  op: OperationType,
  handler: any,
) {
  return planOperation(
    item,
    op,
    handler,
    decideTerraformPlan(item, op),
    planTerraformWorkspace,
    resolveTerraformDependencies,
  );
}

export function planGithubOperation(
  item: any,
  op: OperationType,
  handler: any,
) {
  return planOperation(
    item,
    op,
    handler,
    decideGithubPlan(item, op),
    planGithubResource,
    resolveGithubDependencies,
  );
}

export function planUnsupportedOperation(
  item: any,
  op: OperationType,
  handler: any,
) {
  return planOperation(
    item,
    op,
    handler,
    { skip: `kind ${item.kind} has no plan support` },
    planGithubResource,
    resolveGithubDependencies,
  );
}
