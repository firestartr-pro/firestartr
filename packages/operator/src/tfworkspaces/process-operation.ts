import common from 'catalog_common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { runTerraformProvisioner } from 'terraform_provisioner';
import { addDestroyCommitStatus, addPlanStatusCheck } from '../ctl';
import { OperationType, WorkItemHandler } from '../informer';
import log from '../logger';
import { TFCheckRun } from '../user-feedback-ops/tf-checkrun';
import {
  tryCreateErrorSummary,
  tryPublishApply,
  tryPublishDestroy,
  tryPublishError,
} from '../user-feedback-ops/user-feedback-ops';
import {
  extractErrorDetails,
  replaceConfigSecrets,
  replaceInlineSecrets,
} from '../utils';
import {
  APPLY_DEFAULT_ERROR_MESSAGE,
  DESTROY_DEFAULT_ERROR_MESSAGE,
  PLAN_DEFAULT_ERROR_MESSAGE,
  SYNC_DEFAULT_ERROR_MESSAGE,
} from '../utils/operationErrorMessages';
import { errorPolicyCompatibility, policyAllowsOp } from './policies';

const TF_PROJECTS_PATH = '/tmp/tfworkspaces';

const TF_CACHES_PATH = '/tmp/tfcaches';

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 6).padEnd(4, '0');
}

// Recursively copy session workspace to debugPath (best-effort)
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else if (e.isSymbolicLink()) {
      try {
        const link = await fs.readlink(s);
        await fs.symlink(link, d);
      } catch (err) {
        // ignore symlink copy failures
      }
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function tearUpSessionWorkspace(
  item: any,
  deps: any,
  sessionId: string,
  failureContext?: string,
): Promise<void> {
  try {
    const context = buildProvisionerContext(item, deps, sessionId);
    await runTerraformProvisioner(context, 'tear-up-project');
  } catch (error: any) {
    log.warn(
      `Workspace cleanup failed${failureContext ? ` after ${failureContext}` : ''}: ${error}`,
    );
  }
}

export function processOperation(item: any, op: OperationType, handler: any) {
  try {
    const policy = getPolicy(item, 'firestartr.dev/policy');

    const syncPolicy = getPolicy(item, 'firestartr.dev/sync-policy');

    if (!policy || policy === 'observe' || policy === 'observe-only') {
      return observe(item, op, handler);
    }

    const { allowed, msg } = policyAllowsOp(policy, op, item);

    if (!allowed) {
      return errorPolicyNotAllowsOp(item, op, handler, msg);
    }

    switch (op) {
      case OperationType.UPDATED:
        return updated(item, op, handler);

      case OperationType.CREATED:
        return created(item, op, handler);

      case OperationType.RENAMED:
        return renamed(item, op, handler);

      case OperationType.SYNC:
        return sync(item, op, handler, syncPolicy, policy);

      case OperationType.MARKED_TO_DELETION:
        return markedToDeletion(item, op, handler);

      case OperationType.RETRY:
      case OperationType.RETRY_SYNC:
        return retry(item, op, handler);

      case OperationType.NOTHING:
        return nothing(item, op, handler);

      default:
        throw new Error(`Operation ${op} not supported`);
    }
  } catch (e: any) {
    log.error(
      `The Terraform processor encountered an error during operation '${op}': '${e}'.`,
    );
    throw e;
  }
}

async function* observe(item: any, op: OperationType, handler: any) {
  for await (const transition of doPlanJSONFormat(item, op, handler)) {
    yield transition;
  }
}

export async function* doPlanJSONFormat(
  item: any,
  op: OperationType,
  handler: any,
  setResult = function (_r: string) {},
  emitSyncErrorCondition = true,
) {
  let error = false;
  let deps: any;
  let terraformExecutionStarted = false;
  const sessionId = generateSessionId();

  if (op !== OperationType.RETRY && op !== OperationType.RETRY_SYNC) {
    try {
      await handler.writeTerraformOutputInTfResult(item, '', 0);
    } catch (e) {
      log.warn(`Failed to clear Terraform output: ${e}`);
    }

    try {
      if (handler.removeFromRetry) handler.removeFromRetry();
    } catch (e) {
      log.warn(`Failed to clear retry watcher: ${e}`);
    }
  }

  try {
    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doPlanJSONFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'False',
      message: 'doPlanJSONFormat',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'True',
      message: 'Planning process started',
    };

    deps = await handler.resolveReferences();

    log.info(
      `The Terraform processor is planning to assess dependencies for item '${item.kind}/${item.metadata.name}' with dependencies: '${deps}'.`,
    );

    const context: any = buildProvisionerContext(item, deps, sessionId);

    let planType = 'plan-json';

    if ('deletionTimestamp' in item.metadata) {
      planType = 'plan-destroy-json';
    }

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        'Terraform plan in progress...',
      );
    }

    terraformExecutionStarted = true;
    const tfPlan: any = await runTerraformProvisioner(
      context,
      planType,
      null,
      undefined,
      {
        tfCacheDir: path.join(
          TF_CACHES_PATH,
          `slot_${handler.getSlotInfo().slotId}`,
        ),
        hardTimeout: handler.recommendedTimeout(),
        processKilled: (killed: boolean) => {
          if (killed) {
            log.error(
              `The Terraform process for item '${item.kind}/${item.metadata.name}' was killed due to a timeout.`,
            );
          } else {
            log.error(
              `PANIC!!: The Terraform process for item '${item.kind}/${item.metadata.name}' could not be killed`,
            );
          }
        },
      },
    );

    if (tfPlan.summary.hasChanges()) {
      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'False',
        message: 'Plan has changes',
      };

      policyAllowsOp;

      yield {
        item,
        reason: op,
        type: 'OUT_OF_SYNC',
        status: 'True',
        message: tfPlan.summary.toString(),
      };
    } else {
      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'True',
        message: 'Plan has no changes',
      };

      yield {
        item,
        reason: op,
        type: 'OUT_OF_SYNC',
        status: 'False',
        message: 'Plan has no changes',
      };
    }

    yield {
      item,
      reason: op,
      type: 'LAST_PLAN_DETAILS',
      status: 'Unknown',
      message: JSON.stringify(tfPlan.detailedBriefing),
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'False',
      message: 'Planning process finished',
    };

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        tfPlan.summary.toString(),
        'completed',
      );
    }
  } catch (e: any) {
    error = true;
    const { output: errorMsg } = extractErrorDetails(e);
    console.error(e);

    log.error(
      `The Terraform processor encountered an error while observing the plan for item '${item.kind}/${item.metadata.name}': '${errorMsg}'.`,
    );

    const summaryText: string = tryCreateErrorSummary(
      'Terraform Plan failed',
      errorMsg,
    );

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addPlanStatusCheck(
        item.metadata.annotations['firestartr.dev/last-state-pr'],
        summaryText,
        'completed',
        true,
      );
    }

    void handler.error();

    if (errorMsg) {
      await handler.writeTerraformOutputInTfResult(item, errorMsg, 1);
    }
  } finally {
    // Tear up the session workspace only if the project was created
    // (Terraform execution started), regardless of its success or failure.
    if (terraformExecutionStarted) {
      await tearUpSessionWorkspace(
        item,
        deps,
        sessionId,
        error ? 'plan error' : undefined,
      );
    }

    if (error) {
      if (op === OperationType.SYNC || op === OperationType.RETRY_SYNC) {
        if (emitSyncErrorCondition) {
          yield {
            item,
            reason: op,
            type: 'ERROR',
            status: 'True',
            message: SYNC_DEFAULT_ERROR_MESSAGE,
          };

          yield {
            item,
            reason: op,
            type: 'SYNCHRONIZED',
            status: 'False',
            message: SYNC_DEFAULT_ERROR_MESSAGE,
          };

          yield {
            item,
            reason: op,
            type: 'PROVISIONED',
            status: 'True',
            message: 'doPlanJSONFormat',
          };

          yield {
            item,
            reason: op,
            type: 'PLANNING',
            status: 'False',
            message: 'doPlanJSONFormat',
          };

          yield {
            item,
            reason: op,
            type: 'OUT_OF_SYNC',
            status: 'False',
            message: 'doPlanJSONFormat',
          };
        } else {
          yield {
            item,
            reason: op,
            type: 'SYNCHRONIZED',
            status: 'True',
            message: SYNC_DEFAULT_ERROR_MESSAGE,
          };

          yield {
            item,
            reason: op,
            type: 'PROVISIONED',
            status: 'True',
            message: 'doPlanJSONFormat',
          };

          yield {
            item,
            reason: op,
            type: 'PLANNING',
            status: 'False',
            message: 'doPlanJSONFormat',
          };

          yield {
            item,
            reason: op,
            type: 'ERROR',
            status: 'False',
            message: 'doPlanJSONFormat',
          };
        }

        setResult('SYNC_ERROR_PLAN');
      } else {
        yield {
          item,
          reason: op,
          type: 'PROVISIONED',
          status: 'False',
          message: PLAN_DEFAULT_ERROR_MESSAGE,
        };

        yield {
          item,
          reason: op,
          type: 'PLANNING',
          status: 'False',
          message: PLAN_DEFAULT_ERROR_MESSAGE,
        };

        yield {
          item,
          reason: op,
          type: 'OUT_OF_SYNC',
          status: 'False',
          message: PLAN_DEFAULT_ERROR_MESSAGE,
        };

        yield {
          item,
          reason: op,
          type: 'ERROR',
          status: 'True',
          message: PLAN_DEFAULT_ERROR_MESSAGE,
        };
      }
    } else {
      handler.success();

      if (op === OperationType.SYNC || op === OperationType.RETRY_SYNC) {
        setResult('SYNC_SUCCESS');
      }

      try {
        await handler.writeTerraformOutputInTfResult(item, '', 0);
      } catch (e) {
        log.warn(`Failed to clear Terraform output: ${e}`);
      }
    }
  }
}

async function* created(item: any, op: OperationType, handler: any) {
  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }
}

async function* renamed(item: any, op: OperationType, handler: any) {
  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }
}

function getPolicy(item: any, annotation: string) {
  const policy =
    item.metadata.annotations && item.metadata.annotations[annotation];

  if (policy) return policy;
}

async function* updated(item: any, op: OperationType, handler: any) {
  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }
}

export async function* retry(item: any, op: OperationType, handler: any) {
  if (isDestroyRetry(item)) {
    for await (const transition of markedToDeletion(item, op, handler)) {
      yield transition;
    }
  } else if (op === OperationType.RETRY_SYNC) {
    const policy = getPolicy(item, 'firestartr.dev/policy');
    const syncPolicy = getPolicy(item, 'firestartr.dev/sync-policy');
    for await (const transition of sync(
      item,
      OperationType.RETRY_SYNC,
      handler,
      syncPolicy,
      policy,
    )) {
      yield transition;
    }
  } else {
    for await (const transition of doApply(item, op, handler)) {
      yield transition;
    }
  }
}

function isDestroyRetry(item: any) {
  if ('deletionTimestamp' in item.metadata) {
    return true;
  }

  return false;
}

export async function* sync(
  item: any,
  op: OperationType,
  handler: any,
  syncPolicy: string,
  generalPolicy: string,
) {
  let doResult = '';

  if (!syncPolicy) {
    log.debug(
      `The Terraform processor is only observing item '${item.kind}/${item.metadata.name}' because no sync policy was found for operation '${op}'.`,
    );
    yield* doPlanJSONFormat(item, op, handler, undefined, false);

    return;
  } else if (
    !common.policies.policiesAreCompatible(syncPolicy, generalPolicy)
  ) {
    yield* errorPolicyCompatibility(syncPolicy, generalPolicy, item, op);

    return;
  } else {
    switch (syncPolicy) {
      case 'apply': {
        yield* doApply(item, op, handler);

        break;
      }

      case 'observe': {
        yield* doPlanJSONFormat(item, op, handler, (result: string) => {
          doResult = result;
        });

        break;
      }

      default: {
        log.debug(
          `The Terraform processor detected a sync policy '${syncPolicy}' for item '${item.kind}/${item.metadata.name}' that is not supported.`,
        );

        yield* doPlanJSONFormat(item, op, handler, (result: string) => {
          doResult = result;
        });

        break;
      }
    }
  }

  log.debug(`doResult is ${doResult}`);

  if (doResult === 'SYNC_SUCCESS') {
    yield {
      item,
      reason: op,
      type: 'SYNCHRONIZED',
      status: 'True',
      message: 'Sync process finished',
    };
  }
}

async function* markedToDeletion(
  item: any,
  op: OperationType,
  handler: WorkItemHandler,
) {
  // Apply progress comment: announces the destroy on the wet-repo PR and
  // streams its output; the result publisher updates it in place at the end.
  const checkRunCtl = await TFCheckRun('destroy', item);
  let error = false;
  let deps: any;
  let terraformExecutionStarted = false;
  const sessionId = generateSessionId();

  try {
    if (op === OperationType.MARKED_TO_DELETION) {
      await handler.writeTerraformOutputInTfResult(item, '', 0);
    }

    const type = 'DELETING';

    yield {
      item,
      reason: op,
      type: 'PROVISIONING',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'DELETED',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'OUT_OF_SYNC',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doApply',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'False',
      message: 'Synth',
    };

    yield {
      item,
      reason: op,
      type,
      status: 'True',
      message: 'Destroying process started',
    };

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addDestroyCommitStatus(
        item,
        'pending',
        'Performing destroy operation...',
        `Terraform Destroy ${item.metadata.name}`,
      );
    }

    deps = await handler.resolveReferences();

    const context: any = buildProvisionerContext(item, deps, sessionId);

    terraformExecutionStarted = true;
    const destroyOutput: any = await runTerraformProvisioner(
      context,
      'destroy',
      checkRunCtl,
      undefined,
      {
        tfCacheDir: path.join(
          TF_CACHES_PATH,
          `slot_${handler.getSlotInfo().slotId}`,
        ),
        hardTimeout: handler.recommendedTimeout(),
        processKilled: (killed: boolean) => {
          if (killed) {
            log.error(
              `The Terraform process for item '${item.kind}/${item.metadata.name}' was killed due to a timeout.`,
            );
          } else {
            log.error(
              `PANIC!!: The Terraform process for item '${item.kind}/${item.metadata.name}' could not be killed`,
            );
          }
        },
      },
    );

    yield {
      item,
      reason: op,
      type,
      status: 'False',
      message: 'Destroying process finished',
    };

    yield {
      item,
      reason: op,
      type: 'DELETED',
      status: 'True',
      message: 'destroyed',
    };

    await handler.finalize(
      handler.pluralKind,
      item.metadata.namespace,
      item,
      'firestartr.dev/finalizer',
    );

    await handler.writeTerraformOutputInTfResult(item, destroyOutput, 0);

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addDestroyCommitStatus(
        item,
        'success',
        'Destroy operation completed',
        `Terraform Destroy ${item.metadata.name}`,
      );
    }

    await tryPublishDestroy(item, destroyOutput, true);

    void handler.success();
  } catch (e: any) {
    error = true;

    const { output: errorMsg } = extractErrorDetails(e);

    checkRunCtl.fnOnError(errorMsg);

    await tryPublishDestroy(item, errorMsg, false);

    await handler.writeTerraformOutputInTfResult(item, errorMsg, 1);

    if (item.metadata.annotations['firestartr.dev/last-state-pr'] || false) {
      await addDestroyCommitStatus(
        item,
        'failure',
        'Destroy operation failed',
        `Terraform Destroy ${item.metadata.name}`,
      );
    }

    void handler.error();
  } finally {
    // Tear up the session workspace only if the project was created
    // (Terraform execution started), regardless of its success or failure.
    if (terraformExecutionStarted) {
      await tearUpSessionWorkspace(
        item,
        deps,
        sessionId,
        error ? 'destroy error' : undefined,
      );
    }

    if (error) {
      yield {
        item,
        reason: op,
        type: 'ERROR',
        status: 'True',
        message: DESTROY_DEFAULT_ERROR_MESSAGE,
      };
    }
  }
}

async function* nothing(item: any, op: OperationType, handler: any) {
  yield {
    item,
    reason: op,
    type: 'NOTHING',
    status: 'True',
    message: 'NOTHING',
  };
}

/**
 *
 * @param {any} item - CR to be applied
 * @param op - Operation type
 * @param handler -
 */
async function* doApply(item: any, op: OperationType, handler: any) {
  const checkRunCtl = await TFCheckRun('apply', item);
  let error = false;
  let deps: any;
  let terraformExecutionStarted = false;
  const sessionId = generateSessionId();

  if (op !== OperationType.RETRY && op !== OperationType.RETRY_SYNC) {
    try {
      await handler.writeTerraformOutputInTfResult(item, '', 0);
    } catch (e) {
      log.warn(`Failed to clear Terraform output: ${e}`);
    }

    try {
      if (handler.removeFromRetry) handler.removeFromRetry();
    } catch (e) {
      log.warn(`Failed to clear retry watcher: ${e}`);
    }
  }

  try {
    yield {
      item,
      reason: op,
      type: 'DELETED',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'False',
      message: 'doApply',
    };

    yield {
      item,
      reason: op,
      type: 'OUT_OF_SYNC',
      status: 'False',
      message: 'doApply',
    };

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doApply',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'False',
      message: 'Synth',
    };

    let output = '';

    const type = 'PROVISIONING';

    yield {
      item,
      reason: op,
      type,
      status: 'True',
      message: 'Provisioning process started',
    };

    deps = await handler.resolveReferences();

    log.info(
      `The Terraform processor is applying and assessing dependencies for item '${item.kind}/${item.metadata.name}' with dependencies: '${deps}'.`,
    );

    const context: any = buildProvisionerContext(item, deps, sessionId);

    terraformExecutionStarted = true;
    log.info(
      `[operator]: runTerraformProvisioner apply - projectPath=${context.projectPath} reuseExistingProject=${context.reuseExistingProject}`,
    );
    const applyOutput: any = await runTerraformProvisioner(
      context,
      'apply',
      checkRunCtl,
      undefined,
      {
        tfCacheDir: path.join(
          TF_CACHES_PATH,
          `slot_${handler.getSlotInfo().slotId}`,
        ),
        hardTimeout: handler.recommendedTimeout(),
        processKilled: (killed: boolean) => {
          if (killed) {
            log.error(
              `The Terraform process for item '${item.kind}/${item.metadata.name}' was killed due to a timeout.`,
            );
          } else {
            log.error(
              `PANIC!!: The Terraform process for item '${item.kind}/${item.metadata.name}' could not be killed`,
            );
          }
        },
      },
    );

    // If tf-debug annotation is present, create a snapshot copy of the
    // session-scoped workspace into the deterministic debug folder. We do
    // this as a best-effort, non-fatal operation so debug artifacts are
    // available for inspection without interfering with the reuse flow.
    try {
      const tfDebug =
        item && item.metadata && item.metadata.annotations
          ? item.metadata.annotations['firestartr.dev/tf-debug']
          : undefined;
      if (sessionId && tfDebug === '1' && context.projectPath) {
        const rawName = item.metadata.name as string;
        const baseName = rawName.replace(
          /-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, // strip uuid
          '',
        );
        const tfStateKey =
          context.tfStateKey ||
          (item?.spec?.firestartr?.tfStateKey as string | undefined);
        const safeKey = tfStateKey
          ? String(tfStateKey).replace(/\//g, '-')
          : '';
        const debugPath = path.join(
          '/tmp/tf-debug',
          `${item.kind.toLowerCase()}-${baseName}${safeKey ? `-${safeKey}` : ''}`,
        );

        // If the session workspace is already the deterministic debugPath,
        // do not remove or copy it (that would delete the freshly-created
        // workspace). Instead, just ensure the debug artifacts folder exists
        // and write the metadata files there. When the source and target are
        // different, perform a best-effort copy as before.
        const srcPath = context.projectPath as string | undefined;
        try {
          if (srcPath && path.resolve(srcPath) === path.resolve(debugPath)) {
            const debugArtifactsDir = path.join(
              debugPath,
              'tf_provisioner_debug',
            );
            await fs.mkdir(debugArtifactsDir, { recursive: true });
            await fs.writeFile(
              path.join(debugArtifactsDir, 'cr.yaml'),
              common.io.toYaml(item),
            );
            await fs.writeFile(
              path.join(debugArtifactsDir, 'deps.yaml'),
              common.io.toYaml(deps),
            );
            log.info(`[operator]: debug snapshot preserved at ${debugPath}`);
          } else {
            // Remove any previous debug snapshot; ignore failures
            try {
              await fs.rm(debugPath, { recursive: true, force: true });
            } catch (e) {
              log.warn(
                `Failed to remove existing debug path ${debugPath}: ${e}`,
              );
            }

            try {
              if (srcPath) await copyDir(srcPath, debugPath);
              const debugArtifactsDir = path.join(
                debugPath,
                'tf_provisioner_debug',
              );
              await fs.mkdir(debugArtifactsDir, { recursive: true });
              await fs.writeFile(
                path.join(debugArtifactsDir, 'cr.yaml'),
                common.io.toYaml(item),
              );
              await fs.writeFile(
                path.join(debugArtifactsDir, 'deps.yaml'),
                common.io.toYaml(deps),
              );
              log.info(`[operator]: debug snapshot created at ${debugPath}`);
            } catch (e: any) {
              log.warn(`[operator]: failed to snapshot debug workspace: ${e}`);
            }
          }
        } catch (e: any) {
          log.warn(`[operator]: debug snapshot flow failed: ${e}`);
        }
      }
    } catch (e: any) {
      log.warn(`[operator]: debug snapshot flow failed: ${e}`);
    }

    context.reuseExistingProject = true;

    log.info(
      `[operator]: runTerraformProvisioner output - projectPath=${context.projectPath} reuseExistingProject=${context.reuseExistingProject}`,
    );

    const terraformOutputJson: any = await runTerraformProvisioner(
      context,
      'output',
    );

    if (!terraformOutputJson) {
      throw new Error(
        `Terraform output is empty for ${item.kind}/${item.metadata.name}`,
      );
    }

    await handler.writeConnectionSecret(item, {
      outputs: { value: terraformOutputJson },
    });

    output += applyOutput;

    yield {
      item,
      reason: op,
      type,
      status: 'False',
      message: 'Terraform apply finished',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'True',
      message: 'terraform apply finished',
    };

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doApply',
    };

    await handler.writeTerraformOutputInTfResult(item, output, 0);

    await tryPublishApply(item, applyOutput, true, 0);

    handler.success();
  } catch (e: any) {
    error = true;

    const { output: errorMsg, exitCode } = extractErrorDetails(e);

    checkRunCtl.fnOnError(errorMsg);

    console.error(e);

    await tryPublishApply(item, errorMsg, false, exitCode);

    log.error(
      `The Terraform processor encountered an error during operation '${op}' for item '${item.kind}/${item.metadata.name}': '${e}'.`,
    );

    handler.error();

    if (errorMsg) {
      await handler.writeTerraformOutputInTfResult(
        item,
        errorMsg,
        exitCode ?? 1,
      );
    }
  } finally {
    // Tear up the session workspace only if the project was created
    // (Terraform execution started), regardless of its success or failure.
    if (terraformExecutionStarted) {
      await tearUpSessionWorkspace(
        item,
        deps,
        sessionId,
        error ? 'provisioning error' : undefined,
      );
    }

    if (error) {
      yield {
        item,
        reason: op,
        type: 'ERROR',
        status: 'True',
        message: APPLY_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'False',
        message: APPLY_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'PROVISIONING',
        status: 'False',
        message: APPLY_DEFAULT_ERROR_MESSAGE,
      };
    }
  }
}

async function* errorPolicyNotAllowsOp(
  item: any,
  op: OperationType,
  handler: any,
  msg: string,
) {
  const reason = 'POLICY CONFLICT';

  await tryPublishError(item, reason, msg);

  yield {
    item,
    reason: op,
    type: 'ERROR',
    status: 'True',
    message: msg,
  };

  yield {
    item,
    reason: op,
    type: 'PROVISIONED',
    status: 'False',
    message: msg,
  };

  yield {
    item,
    reason: op,
    type: 'PROVISIONING',
    status: 'False',
    message: msg,
  };

  yield {
    item,
    reason: op,
    type: 'OUT_OF_SYNC',
    status: 'False',
    message: msg,
  };

  yield {
    item,
    reason: op,
    type: 'DELETED',
    status: 'False',
    message: msg,
  };

  yield {
    item,
    reason: op,
    type: 'PLANNING',
    status: 'False',
    message: msg,
  };

  yield {
    item,
    reason: op,
    type: 'DELETING',
    status: 'False',
    message: msg,
  };

  await handler.writeTerraformOutputInTfResult(item, msg, 1);

  handler.error();
}

/**
 * @description Adapts the CR to the format expected by the terraform provisioner
 * @param item  - CR to be applied
 * @param deps - Dependencies
 */
export function buildProvisionerContext(
  item: any,
  deps: any,
  sessionId?: string,
) {
  const context: any = {};

  context['type'] = item.spec.source;

  context['inline'] = item.spec.module;

  context['module'] = item.spec.module;

  if ('files' in item.spec) {
    context['files'] = item.spec.files;
  }

  context['values'] = JSON.parse(item.spec.values);

  const result = adaptProviders(item, deps);

  context['requiredProviders'] = result.providers;

  context['secrets'] = result.secrets;

  context['backend'] = adaptBackend(item, deps);

  context['tfStateKey'] = item.spec.firestartr.tfStateKey;

  context['references'] = resolveReferences(item, deps);

  const tfStateKey = item?.spec?.firestartr?.tfStateKey;
  if (typeof tfStateKey !== 'string' || tfStateKey.trim() === '') {
    throw new Error(`Invalid terraform state key: ${tfStateKey}`);
  }

  // Preserve the raw CR and resolved dependencies on the context so provisioners
  // can emit debug artifacts when requested. This is intentionally additive
  // and does not change the public runTerraformProvisioner API shape.
  context['rawCr'] = item;
  context['deps'] = deps;

  // Always use a session-scoped projectPath for apply/plan/etc when a
  // sessionId is provided. Do not hand the deterministic debug path to the
  // provisioner; instead, the operator will perform a copy to /tmp/tf-debug
  // after apply if the tf-debug annotation is present. This avoids races and
  // accidental deletion of debug folders during the provisioner lifecycle.
  if (sessionId) {
    context['projectPath'] = path.join(
      TF_PROJECTS_PATH,
      `${item.kind.toLowerCase()}-${item.metadata.name}-${sessionId}`,
    );
  } else {
    const basePath = path.resolve(TF_PROJECTS_PATH);
    const resolvedPath = path.resolve(basePath, tfStateKey);
    if (!resolvedPath.startsWith(basePath + path.sep)) {
      throw new Error(`Invalid terraform state key: ${tfStateKey}`);
    }
    context['projectPath'] = resolvedPath;
  }

  return context;
}

function getRefContextFromCr(cr: any, deps: any) {
  const secrets: any = {};

  // check first there are any secrets to resolve
  if (cr.spec.secrets === undefined) return secrets;

  for (const i of Object.entries(cr.spec.secrets)) {
    const [objectKey, value]: [string, any] = i;

    const { key, name } = value.secretRef;

    const secretDepKeyName = `Secret-${name}`;

    const secret: any = deps[secretDepKeyName as keyof typeof deps];

    if (secret.cr.data[key] === undefined)
      throw new Error(`Secret ${name} does not contain key ${key}`);

    secrets[objectKey] = Buffer.from(secret.cr.data[key], 'base64');
  }
  return secrets;
}

function adaptProviders(item: any, deps: any) {
  const result: any = {};

  result['secrets'] = [];

  result['providers'] = [];

  if (item.spec.context.providers) {
    for (const p of item.spec.context.providers) {
      const { provider, secrets } = adaptProvider(p, deps);

      result['providers'].push(provider);

      result['secrets'] = result['secrets'].concat(secrets);
    }
  }
  return result;
}

/**
 * @param item
 * @param deps
 * @description Adapts the provider configuration to the format expected by the terraform provisioner
 */
function adaptProvider(providerFromItem: any, deps: any) {
  const provider: any = {};

  const providerName = `FirestartrProviderConfig-${providerFromItem.ref.name}`;

  const providerDependency = deps[providerName].cr;

  const providerSecrets = getRefContextFromCr(providerDependency, deps);

  const providerConfigData = replaceConfigSecrets(
    JSON.parse(providerDependency.spec.config),
    providerSecrets,
  );

  const providerInlineData = replaceInlineSecrets(
    providerDependency.spec.inline,
    providerSecrets,
  );

  provider['name'] = providerDependency.spec.type;

  provider['version'] = providerDependency.spec.version;

  provider['source'] = providerDependency.spec.source;

  provider['inline'] = providerInlineData;

  provider['config'] = providerConfigData;

  const secrets: any[] = [];

  if (providerDependency.spec.env) {
    const secretsEnv = JSON.parse(providerDependency.spec.env ?? {});

    for (const key of Object.keys(secretsEnv)) {
      secrets.push({
        key: key,

        value: secretsEnv[key],
      });
    }
  }

  return { provider, secrets };
}

/**
 * @description Adapts the backend configuration to the format expected by the terraform provisioner
 * @param item  - CR to be applied
 * @param deps  - Dependencies
 */
function adaptBackend(item: any, deps: any) {
  const backend: any = {};

  const backendName = `FirestartrProviderConfig-${item.spec.context.backend.ref.name}`;

  const backendDependency = deps[backendName].cr;

  const backendSecrets = getRefContextFromCr(backendDependency, deps);

  const providerConfigData = replaceConfigSecrets(
    JSON.parse(backendDependency.spec.config),
    backendSecrets,
  );

  const providerInlineData = replaceInlineSecrets(
    backendDependency.spec.inline,
    backendSecrets,
  );

  backend[backendDependency.spec.type] = {};

  backend[backendDependency.spec.type]['config'] = providerConfigData;

  backend[backendDependency.spec.type]['inline'] = providerInlineData;

  return backend;
}

/**
 * @param item  - CR to be applied
 * @param deps  - Dependencies
 * @description Resolves references to secrets, provided by the user in the CR
 */
function resolveReferences(item: any, deps: any) {
  try {
    const references: any = {};

    const itemReferences = item.spec.references;

    // if(!process.env.TONISILLO) process.exit(1)
    for (const iRef of itemReferences) {
      const ref = deps[`${iRef.ref.kind}-${iRef.ref.name}`];

      if (iRef.ref.kind === 'Secret') {
        ref.secret = ref.cr;
      }

      if (!ref) {
        throw new Error(
          `Reference ${iRef.ref.kind}-${iRef.ref.name} not found`,
        );
      }

      if (!ref.secret || !ref.secret.data) {
        throw new Error(
          `❌ No outputs secret found in reference ${iRef.ref.name}`,
        );
      }

      let b64Decoded = '';

      try {
        if (ref.secret.data['outputs']) {
          b64Decoded = Buffer.from(
            ref.secret.data['outputs'],
            'base64',
          ).toString('utf-8');
        } else if (Object.keys(ref.secret.data).length > 0) {
          const resultObj: any = {};

          for (const key in ref.secret.data) {
            resultObj[key] = Buffer.from(
              ref.secret.data[key],
              'base64',
            ).toString('utf-8');
          }

          b64Decoded = JSON.stringify(resultObj);
        }
      } catch (e: any) {
        throw new Error(
          `❌ Error decoding outputs from secret ${ref.secret.metadata.name}: ${e}`,
        );
      }

      let outputs: any = {};

      try {
        outputs = JSON.parse(b64Decoded);
      } catch (e: any) {
        console.error(e);

        throw new Error(
          `❌ Error parsing outputs from secret ${ref.secret.metadata.name}: ${e}`,
        );
      }

      if (!outputs[iRef.ref.key]) {
        throw new Error(getErrorOutputMessage(item, iRef.ref.key, ref));
      }

      if (ref.secret.data['outputs']) {
        references[iRef.name] = outputs[iRef.ref.key].value;
      } else {
        references[iRef.name] = outputs[iRef.ref.key];
      }
    }

    return references;
  } catch (e: any) {
    throw new Error(`resolving references: ${e}`);
  }
}

function getErrorOutputMessage(cr: any, key: string, ref: any) {
  if (cr.spec.source === 'Remote') {
    return `

    ❌ No output ${key} found in secret '${ref.secret.metadata.name}' .

    ❗❕ Your terraform project has not the output '${key}' .

    Maybe you forgot to add it or your reference is wrong.

    🔗 Terraform project: ${cr.spec.module}

    🖹 Output example:

    ... your terraform code ...

    # missing output
    output '${key}' {
      value = <your_value>
    }

    `;
  } else if (cr.spec.source === 'Inline') {
    return `❗❕ Could not find output '${key}' in inline module:

      ${cr.spec.module}
    `;
  } else {
    throw new Error(`❌ Source ${cr.spec.source} not supported`);
  }
}
