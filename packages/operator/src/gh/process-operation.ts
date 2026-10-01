import { OperationType, WorkItemHandler } from '../informer';

import ghProvisioner from 'gh_provisioner';

import { isImportMode, isImportModeSkipPlan } from '../..';

import {
  manageOwnershipReferences,
  manageOwnershipReferencesPostDeletion,
} from './ownership';

import { GHCheckRun } from '../user-feedback-ops/gh-checkrun';
import { TFCheckRun } from '../user-feedback-ops/tf-checkrun';

import { addDestroyCommitStatus } from '../ctl';

import {
  tryPublishApply,
  tryPublishDestroy,
} from '../user-feedback-ops/user-feedback-ops';

import log from '../logger';

import {
  APPLY_DEFAULT_ERROR_MESSAGE,
  DESTROY_DEFAULT_ERROR_MESSAGE,
} from '../utils/operationErrorMessages';

import { extractErrorDetails } from '../utils';

import path from 'path';

const TF_CACHES_PATH = '/tmp/tfcaches';

export function processOperation(item: any, op: OperationType, handler: any) {
  log.info(`Processing operation ${op} on ${item.kind}/${item.metadata?.name}`);
  try {
    switch (op) {
      case OperationType.UPDATED:
        return updated(item, op, handler);

      case OperationType.CREATED:
        return created(item, op, handler);

      case OperationType.RENAMED:
        return renamed(item, op, handler);

      case OperationType.SYNC:
        return sync(item, op, handler);

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
    log.error(`Operation ${op} failed: ${e}`);
    throw e;
  }
}

async function* created(item: any, op: OperationType, handler: any) {
  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }

  await manageOwnershipReferences(item, handler, op);
}

async function* renamed(item: any, op: OperationType, handler: any) {
  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }

  await manageOwnershipReferences(item, handler, op);
}

async function* updated(item: any, op: OperationType, handler: any) {
  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }

  await manageOwnershipReferences(item, handler, op);
}

export async function* retry(item: any, op: OperationType, handler: any) {
  if ('deletionTimestamp' in item.metadata) {
    for await (const transition of markedToDeletion(item, op, handler)) {
      yield transition;
    }
  } else if (op === OperationType.RETRY_SYNC) {
    for await (const transition of sync(
      item,
      OperationType.RETRY_SYNC,
      handler,
    )) {
      yield transition;
    }
  } else {
    for await (const transition of doApply(item, op, handler)) {
      yield transition;
    }
  }
}

export async function* sync(item: any, op: OperationType, handler: any) {
  yield {
    item,
    reason: op,
    type: 'SYNCHRONIZED',
    status: 'False',
    message: 'Synth',
  };

  for await (const transition of doApply(item, op, handler)) {
    yield transition;
  }

  yield {
    item,
    reason: op,
    type: 'SYNCHRONIZED',
    status: 'True',
    message: 'terraform execution finished',
  };
}

async function* markedToDeletion(
  item: any,
  op: OperationType,
  handler: WorkItemHandler,
) {
  // here we store the current callbacks that
  // are being used (synth|tf-apply...)
  let checkRunCtl: any;
  let checkRunTFCtl: any;
  let error = false;

  try {
    const type = 'DELETING';

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
      message: 'Synth Project',
    };

    yield {
      item,
      reason: op,
      type,
      status: 'True',
      message: 'Destroying process started',
    };

    const deps = await handler.resolveReferences();

    const annotation = 'firestartr.dev/last-state-pr';
    const statePr = item?.metadata?.annotations?.[annotation];
    const hasStatePr = typeof statePr === 'string' && statePr.trim().length > 0;

    if (!hasStatePr) {
      log.warn(
        `CR ${item?.kind ?? 'UnknownKind'}/${item?.metadata?.name ?? 'unknown'} ` +
          `has no "${annotation}" annotation; skipping GitHub Check Runs (synth, terraform apply).`,
      );
    } else {
      log.debug(
        `CR ${item.kind}/${item.metadata.name} uses "${annotation}" = ${statePr}`,
      );

      checkRunCtl = await GHCheckRun('synth', item);
      checkRunTFCtl = await TFCheckRun('destroy', item);
    }

    const opts: any = {};
    opts.ctl = {};
    opts.ctl['hardTimeout'] = handler.recommendedTimeout();
    opts.ctl['processKilled'] = (killed: boolean) => {
      if (killed) {
        log.error(
          `The Terraform process for item '${item.kind}/${item.metadata.name}' was killed due to a timeout.`,
        );
      } else {
        log.error(
          `PANIC!!: The Terraform process for item '${item.kind}/${item.metadata.name}' could not be killed`,
        );
      }
    };
    opts.ctl['tfCacheDir'] = path.join(
      TF_CACHES_PATH,
      `slot_${handler.getSlotInfo().slotId}`,
    );

    const destroyOutput = await ghProvisioner.runGhProvisioner(
      {
        mainCr: item,
        deps,
      },

      {
        ...opts,
        delete: true,
        ...(hasStatePr
          ? {
              logStreamCallbacksGHProvisioner: checkRunCtl,

              logStreamCallbacksTF: checkRunTFCtl,
            }
          : {}),
      },
    );

    const output: string = destroyOutput;

    yield {
      item,
      reason: op,
      type,
      status: 'False',
      message: 'Destroying process finished',
    };

    await handler.finalize(
      handler.pluralKind,
      item.metadata.namespace,
      item,
      'firestartr.dev/finalizer',
    );

    await handler.writeTerraformOutputInTfResult(item, output, 0);

    if (hasStatePr) {
      await addDestroyCommitStatus(
        item,
        'success',
        'Destroy operation completed',
        `Terraform Destroy ${item.metadata.name}`,
      );
    }

    await tryPublishDestroy(item, output, true);

    await manageOwnershipReferencesPostDeletion(item, handler, op);

    void handler.success();
  } catch (e: any) {
    error = true;

    const { output: errorMsg, exitCode: errCode } = extractErrorDetails(e);

    // if there is a current checkRun working
    // we close it with an error
    if (checkRunCtl) checkRunCtl.fnOnError(errorMsg);
    // also close the Terraform check run: its periodic flush would
    // otherwise keep rewriting the apply progress comment after the
    // final destroy result is published
    if (checkRunTFCtl) checkRunTFCtl.fnOnError(errorMsg);

    await tryPublishDestroy(item, errorMsg, false);

    await handler.writeTerraformOutputInTfResult(item, errorMsg, errCode ?? 1);

    void handler.error();
  } finally {
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

///**
// * @param {any} item - CR to be applied
// * @param op - Operation type
// * @param handler -
// */
async function* doApply(item: any, op: OperationType, handler: any) {
  // here we store the current callbacks that
  // are being used (synth|tf-apply...)
  let checkRunCtl: any;
  let checkRunTFCtl: any;
  let error = false;

  if (op !== OperationType.RETRY && op !== OperationType.RETRY_SYNC) {
    try {
      await handler.writeTerraformOutputInTfResult(item, '', 0);
    } catch (e) {
      log.warn(
        `Failed to reset retry count: ${e instanceof Error ? e.stack || e.message : JSON.stringify(e)}`,
      );
    }
  }

  try {
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
      message: 'Synth Project',
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

    let opts: any = {};

    isImportModeSkipPlan()
      ? (opts = { import: true, skipPlan: true })
      : isImportMode()
        ? (opts = { import: true })
        : null;

    if (
      op === OperationType.UPDATED ||
      op === OperationType.RENAMED ||
      op === OperationType.RETRY ||
      op === OperationType.RETRY_SYNC ||
      op === OperationType.SYNC
    ) {
      opts['update'] = true;
    } else if (op === OperationType.CREATED) {
      opts['create'] = true;
    }

    const deps = await handler.resolveReferences();

    deps['self-outputs'] = {
      cr: await handler.resolveOwnOutputs(),
    };

    log.info(
      `Item ${item.metadata.name} has the following dependencies: ${Object.keys(deps)}`,
    );

    const annotation = 'firestartr.dev/last-state-pr';
    const statePr = item?.metadata?.annotations?.[annotation];
    const hasStatePr = typeof statePr === 'string' && statePr.trim().length > 0;

    if (!hasStatePr) {
      log.warn(
        `CR ${item?.kind ?? 'UnknownKind'}/${item?.metadata?.name ?? 'unknown'} ` +
          `has no "${annotation}" annotation; skipping GitHub Check Runs (synth, terraform apply).`,
      );
    } else {
      log.debug(
        `CR ${item.kind}/${item.metadata.name} uses "${annotation}" = ${statePr}`,
      );

      checkRunCtl = await GHCheckRun('synth', item);
      checkRunTFCtl = await TFCheckRun('apply', item);
    }

    // we write from the inside
    let terraformOutputJson: any;

    opts['fJsonOutput'] = (output: any) => (terraformOutputJson = output);

    opts.ctl = {};
    opts.ctl['hardTimeout'] = handler.recommendedTimeout();
    opts.ctl['processKilled'] = (killed: boolean) => {
      if (killed) {
        log.error(
          `The Terraform process for item '${item.kind}/${item.metadata.name}' was killed due to a timeout.`,
        );
      } else {
        log.error(
          `PANIC!!: The Terraform process for item '${item.kind}/${item.metadata.name}' could not be killed`,
        );
      }
    };
    opts.ctl['tfCacheDir'] = path.join(
      TF_CACHES_PATH,
      `slot_${handler.getSlotInfo().slotId}`,
    );

    const applyOutput: any = await ghProvisioner.runGhProvisioner(
      {
        mainCr: item,
        deps,
      },

      {
        ...opts,
        ...(hasStatePr
          ? {
              logStreamCallbacksGHProvisioner: checkRunCtl,

              logStreamCallbacksTF: checkRunTFCtl,
            }
          : {}),
      },
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

    void handler.success();
  } catch (e: any) {
    error = true;

    const { output: errorMsg, exitCode: errCode } = extractErrorDetails(e);

    // being one the exitCode
    await tryPublishApply(item, errorMsg, false, errCode ?? 1);

    // if there is a current checkRun working
    // we close it with an error
    if (checkRunCtl) checkRunCtl.fnOnError(errorMsg);
    if (checkRunTFCtl) checkRunTFCtl.fnOnError(errorMsg);

    log.error(`Error applying item ${item.metadata.name}: ${errorMsg}`);

    handler.error();

    if (errorMsg) {
      await handler.writeTerraformOutputInTfResult(
        item,
        errorMsg,
        errCode ?? 1,
      );
    }
  } finally {
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
