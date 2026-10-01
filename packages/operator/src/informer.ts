import common from 'catalog_common';

import { observe } from './reflector';

import {
  getItemByItemPath,
  upsertFinalizer,
  writePlanInGithubPR,
  writeTerraformOutputInTFResult,
  unsetFinalizer,
  writeConnectionSecret,
  getSecret,
  deleteSecret,
} from './ctl';

import {
  NeedsCreationOrUpdate,
  upsertInitialStatus,
  needsProvisioningOnCreateOrUpdate,
  updateRetryStatusInCR,
} from './status';

import { syncer } from './syncer';

import { initRetry, nextRetryMs, getMaxRetry } from './retry';
import {
  getKindFromPlural,
  getTimeoutForOperation,
  retryOpForReason,
} from './definitions';
import { Dependencies, resolve } from './resolver';

import { setSyncStatus, getSyncStatus } from './syncCtl';

import { resolveSecretRef } from './resolver';

import log from './logger';
import { logActivity } from './activity-log';

import { OperationType, WorkStatus } from './definitions';
import type { WorkItemHandler, WorkItem } from './definitions';
export { OperationType, WorkStatus };
export type { WorkItemHandler, WorkItem };

const kindsWithFinalizer = [
  'FirestartrDummyA',
  'FirestartrDummyB',
  'FirestartrDummyC',
  'FirestartrTerraformWorkspace',
  'FirestartrGithubGroup',
  'FirestartrGithubMembership',
  'FirestartrGithubRepository',
  'FirestartrGithubRepositoryFeature',
  'FirestartrGithubOrgWebhook',
  'FirestartrGithubOrganizationSettings',
  'FirestartrGithubOrganizationVariableSection',
  'FirestartrGithubRepositorySecretsSection',
];

const kindsWithDependants = [
  'FirestartrDummyA',
  'FirestartrDummyB',
  'FirestartrGithubRepository',
];

/**
 * Observe whenever a new item is added, modified or deleted in a given kind
 * @param {string} pluralKind - Kind to observe
 * @param {string} namespace - Namespace to observe
 * @param {Function} queue - Callback to queue work items for processing
 * @param {Function} compute - Callback to process the work items
 * @returns {void}
 */
export async function observeKind(
  pluralKind: string,
  namespace: string,
  queue: Function,
  compute: Function,
) {
  const lastWorkItems: any = {};

  log.info(
    `The informer has started observing the '${pluralKind}' resource in namespace '${namespace}'.`,
  );

  // onSync
  const enqueueCallback = (event: string) => {
    return async (item: any) => {
      const workItem: WorkItem | null = await inform(
        pluralKind,
        item,
        event,
        getLastWorkItem(pluralKind, lastWorkItems, item),
      );

      if (workItem) {
        workItem.onDelete = () =>
          delete lastWorkItems[itemPath(pluralKind, item)];

        setLastWorkItem(pluralKind, lastWorkItems, item, workItem);

        enqueue(pluralKind, workItem, queue, compute, syncCtl, retryCtl);
      }
    };
  };

  const retryCtl = await initRetry(await enqueueCallback('onRetry'));

  const syncCtl = await syncer(await enqueueCallback('onSync'));

  await observe(
    pluralKind,

    namespace,

    // on add
    async (item: any) => {
      logActivity(
        'ADD',
        item.kind,
        item.metadata.name,
        namespace,
        item.metadata.resourceVersion,
      );
      log.info(
        `The informer has detected a new item, '${item.metadata.name}', for '${pluralKind}' in namespace '${namespace}'.`,
      );

      await handleUpsertFinalizer(pluralKind, namespace, item);
      await upsertInitialStatus(pluralKind, namespace, item);

      const workItem: WorkItem | null = await inform(
        pluralKind,
        item,
        'onAdd',
        getLastWorkItem(pluralKind, lastWorkItems, item),
      );

      syncCtl.addItem(itemPath(pluralKind, item));

      if (workItem) {
        setLastWorkItem(pluralKind, lastWorkItems, item, workItem);

        enqueue(pluralKind, workItem, queue, compute, syncCtl, retryCtl);
      }
    },

    // on modify
    async (item: any) => {
      logActivity(
        'MODIFY',
        item.kind,
        item.metadata.name,
        namespace,
        item.metadata.resourceVersion,
      );
      log.info(
        `The informer has detected that item '${item.metadata.name}' for '${pluralKind}' in namespace '${namespace}' was modified.`,
      );

      const workItem: WorkItem | null = await inform(
        pluralKind,
        item,
        'onUpdate',
        getLastWorkItem(pluralKind, lastWorkItems, item),
      );

      if (workItem) {
        setLastWorkItem(pluralKind, lastWorkItems, item, workItem);

        enqueue(pluralKind, workItem, queue, compute, syncCtl, retryCtl);
      }
    },

    // on delete
    async (item: any) => {
      logActivity(
        'DELETE',
        item.kind,
        item.metadata.name,
        namespace,
        item.metadata.resourceVersion,
      );
      log.info(
        `The informer has detected that item '${item.metadata.name}' for '${pluralKind}' in namespace '${namespace}' was deleted.`,
      );

      const workItem: WorkItem | null = await inform(
        pluralKind,
        item,
        'onMarkedToDeletion',
        getLastWorkItem(pluralKind, lastWorkItems, item),
      );

      if (workItem) {
        setLastWorkItem(pluralKind, lastWorkItems, item, workItem);

        enqueue(pluralKind, workItem, queue, compute, syncCtl, retryCtl);
      }

      syncCtl.deleteItem(itemPath(pluralKind, item));
    },

    // on rename
    async (item: any) => {
      logActivity(
        'RENAME',
        item.kind,
        item.metadata.name,
        namespace,
        item.metadata.resourceVersion,
      );
      log.info(
        `The informer has detected that an item for '${pluralKind}' in namespace '${namespace}' has been renamed to '${item.metadata.name}'.`,
      );

      const workItem: WorkItem | null = await inform(
        pluralKind,
        item,
        'onRename',
        getLastWorkItem(pluralKind, lastWorkItems, item),
      );

      // Add the renamed item to the sync queue
      syncCtl.addItem(itemPath(pluralKind, item));

      log.debug(
        `The informer is renaming item '${workItem.item.metadata.name}' of kind '${workItem.item.kind}' due to a change in its name.`,
      );

      if (workItem) {
        const oldName =
          workItem.item.metadata.labels[
            common.types.controller.FirestartrLabelOldName
          ];

        await handleUnsetFinalizer(pluralKind, namespace, item);

        // Remove the old item from the syncer, only new item will should be provisioned
        syncCtl.deleteItem(
          itemPathByName(pluralKind, workItem.item.metadata.namespace, oldName),
        );

        setLastWorkItem(pluralKind, lastWorkItems, item, workItem);

        enqueue(pluralKind, workItem, queue, compute, syncCtl, retryCtl);
      }
    },
  );
  await loop();
}

async function handleUpsertFinalizer(
  pluralKind: string,
  namespace: string,
  item: any,
) {
  if (kindsWithFinalizer.includes(getKindFromPlural(pluralKind))) {
    await upsertFinalizer(
      pluralKind,
      namespace,
      item,
      common.types.controller.FirestartrFinalizer,
    );
  }
}

async function handleUnsetFinalizer(
  pluralKind: string,
  namespace: string,
  item: any,
) {
  if (kindsWithFinalizer.includes(getKindFromPlural(pluralKind))) {
    await unsetFinalizer(
      pluralKind,
      namespace,
      item,
      common.types.controller.FirestartrFinalizer,
    );
  }
}

/**
 * Enqueue a work item for processing
 * @param {string} pluralKind - Kind to observe
 * @param {WorkItem} workItem - Work item to process
 * @param {Function} queue - Callback to queue work items for processing
 * @param {Function} compute - Callback to process the work items
 * @param {Function} syncCtl - Callback to control syncs
 * @param {Function} retryCtl - Callback to control retries
 * @param {Function} renameCtl - Callback to control renames
 * @returns {void}
 */
function enqueue(
  pluralKind: string,
  workItem: WorkItem,
  queue: any,
  compute: Function,
  syncCtl: any,
  retryCtl: any,
) {
  workItem.getItem = () => {
    return getItemByItemPath(itemPath(pluralKind, workItem.item));
  };

  workItem.isDeadLetter = false;

  workItem.handler = {
    finalize: unsetFinalizer,

    pluralKind,

    informPlan: writePlanInGithubPR,

    writeTerraformOutputInTfResult: async (
      item: any,
      output: string,
      exitCode?: number,
    ) => {
      const result = await writeTerraformOutputInTFResult(
        item,
        output,
        exitCode,
      );

      const resolvedExitCode =
        exitCode !== undefined ? exitCode : /\berror\b/i.test(output) ? 1 : 0;

      const retryCount = result?.status?.retryCount ?? 0;

      const backoffCounter = Math.max(retryCount - 1, 0);

      const nextRetryTime =
        resolvedExitCode === 0 || backoffCounter >= getMaxRetry()
          ? undefined
          : new Date(Date.now() + nextRetryMs(backoffCounter)).toISOString();

      await updateRetryStatusInCR(
        pluralKind,
        item.metadata.namespace,
        item.metadata.name,
        retryCount,
        nextRetryTime,
      );

      return result;
    },

    writeConnectionSecret: writeConnectionSecret,

    resolveReferences: () =>
      resolve(workItem.item, getItemByItemPath, getSecret),

    resolveOwnOutputs: () => {
      return resolveSecretRef(
        workItem.item.metadata.namespace,
        workItem.item,
        getSecret,
      );
    },

    deleteSecret: () =>
      deleteSecret(
        workItem.item.spec.writeConnectionSecretToRef.name,
        workItem.item.metadata.namespace,
      ),

    itemPath: () => itemPath(pluralKind, workItem.item),

    error: () => retryCtl.errorReconciling(itemPath(pluralKind, workItem.item)),

    success: () =>
      retryCtl.successReconciling(itemPath(pluralKind, workItem.item)),

    removeFromRetry: () =>
      retryCtl.successReconciling(itemPath(pluralKind, workItem.item)),

    recommendedTimeout: () => {
      const customTimeoutAnnotation = common.generic.getFirestartrAnnotation(
        'test-custom-timeout',
      );

      let customTimeout: number | null = null;

      if (
        'annotations' in workItem.item.metadata &&
        customTimeoutAnnotation in workItem.item.metadata.annotations &&
        !isNaN(
          parseInt(workItem.item.metadata.annotations[customTimeoutAnnotation]),
        )
      ) {
        customTimeout = parseInt(
          workItem.item.metadata.annotations[customTimeoutAnnotation],
        );
      } else {
        customTimeout = getTimeoutForOperation(workItem.operation);
      }

      return customTimeout;
    },
    needsBlocking: (item: any, operation: OperationType) => {
      if (kindsWithDependants.indexOf(item.kind) === -1) {
        return false;
      }

      // only for delete operations
      if (operation !== OperationType.MARKED_TO_DELETION) {
        if (
          operation === OperationType.RETRY ||
          operation === OperationType.RETRY_SYNC
        ) {
          // is the retry a delete operation?
          if (!('deletionTimestamp' in workItem.item.metadata)) {
            return false;
          }
        } else {
          return false;
        }
      }

      if (
        item.metadata.finalizers &&
        (item.metadata.finalizers.indexOf('foregroundDeletion') !== -1 ||
          item.metadata.finalizers.indexOf(
            'firestartr.dev/foreground-deletion',
          ) !== -1)
      ) {
        // it will block for five seconds
        workItem.isBlocked = true;

        const tTimeout = setTimeout(() => {
          workItem.isBlocked = false;
        }, 1000 * 5);

        workItem.fUnblock = () => {
          clearTimeout(tTimeout);

          workItem.isBlocked = false;
        };

        return true;
      } else {
        workItem.isBlocked = false;

        return false;
      }
    },

    getSlotInfo: () => null,
  };

  workItem.process = async function* (
    item: any,
    operation: OperationType,
    handler: any,
  ) {
    const needsUpdateSyncConditions =
      operation === OperationType.RENAMED ||
      operation === OperationType.UPDATED ||
      operation === OperationType.SYNC ||
      operation === OperationType.CREATED ||
      operation === OperationType.RETRY ||
      operation === OperationType.RETRY_SYNC;

    await setSyncStatus(
      workItem.handler.itemPath(),
      operation,
      'False',
      'Sync process started',
    );

    for await (const transition of compute(item, operation, handler)) {
      yield transition;
    }

    if (needsUpdateSyncConditions) {
      if (
        operation === OperationType.SYNC ||
        operation === OperationType.RETRY_SYNC
      ) {
        // Fetch the CR once and reuse for both hasSyncFailed check and ERROR guard
        const currentItem = await getItemByItemPath(
          workItem.handler.itemPath(),
        );

        const syncStatus = await getSyncStatus(
          workItem.handler.itemPath(),
          currentItem,
        );

        if (syncStatus.hasSyncFailed) {
          return;
        }

        const errorCondition = currentItem?.status?.conditions?.find(
          (c: { type?: string; status?: string }) =>
            c.type === 'ERROR' && c.status === 'True',
        );

        if (errorCondition) {
          log.debug(
            `Skipping SYNCHRONIZED=True update for ${workItem.handler.itemPath()} because ERROR is active`,
          );

          await setSyncStatus(
            workItem.handler.itemPath(),
            operation,
            'False',
            'Synchronization skipped because ERROR condition is active',
          );

          void syncCtl.updateItem(itemPath(pluralKind, item));
          return;
        }
      }

      await setSyncStatus(
        workItem.handler.itemPath(),
        operation,
        operation === OperationType.SYNC ||
          operation === OperationType.RETRY_SYNC
          ? 'True'
          : 'False',
        'Sync process finished',
      );

      void syncCtl.updateItem(itemPath(pluralKind, item));
    } else {
      log.debug(
        `The informer received an item with an operation type of '${operation}', which is not a specific operation.`,
      );
    }
  };

  workItem.isBlocked = false;

  queue(workItem);
}

function itemPath(kind: string, item: any) {
  return `${item.metadata.namespace}/${kind}/${item.metadata.name}`;
}

function itemPathByName(kind: string, namespace: string, name: string) {
  return `${namespace}/${kind}/${name}`;
}

function getLastWorkItem(
  kind: string,
  workItemsMap: any,
  item: any,
): WorkItem | null {
  return workItemsMap[itemPath(kind, item)];
}

function setLastWorkItem(
  kind: string,
  workItemsMap: any,
  item: any,
  workItem: WorkItem,
) {
  return (workItemsMap[itemPath(kind, item)] = workItem);
}

/**
 *
 * @param {string} pluralKind - Kind to inform about
 * @param {any} item - Object to inform about
 * @param {string} op - Type of operation to inform about
 * @param {WorkItem} lastWorkItem -
 * @returns
 */
async function inform(
  pluralKind: string,
  item: any,
  op: string,
  lastWorkItem: WorkItem | null = null,
): Promise<WorkItem | null> {
  let workItem: WorkItem | null = lastWorkItem;

  let needed: NeedsCreationOrUpdate;

  if (getKindFromPlural(pluralKind) !== item.kind) return null;

  switch (op) {
    case 'onSync':
      if (
        workItem !== null &&
        workItem.workStatus !== WorkStatus.FINISHED &&
        (workItem.operation === OperationType.SYNC ||
          workItem.operation === OperationType.RETRY_SYNC)
      ) {
        return null;
      }

      workItem = {
        operation: OperationType.SYNC,

        item,

        workStatus: WorkStatus.PENDING,

        onDelete: function () {},

        upsertTime: Date.now(),
      };

      return workItem;

    case 'onRename':
      needed = await needsProvisioningOnCreateOrUpdate(item);

      if (needed.needs) {
        log.debug(
          `The informer is triggering a new provisioning process for the renamed item '${item.kind}/${item.metadata.name}'. Reason: ${needed.reason}.`,
        );

        workItem = {
          operation: OperationType.RENAMED,

          item,

          workStatus: WorkStatus.PENDING,

          onDelete: function () {},

          upsertTime: Date.now(),
        };

        return workItem;
      }

      return null;

    case 'onRetry': {
      if (workItem !== null && workItem.workStatus !== WorkStatus.FINISHED) {
        return null;
      }

      const errorCondition = item.status?.conditions?.find(
        (c: any) => c.type === 'ERROR' && c.status === 'True',
      );
      const retryOp = retryOpForReason(errorCondition?.reason);

      workItem = {
        operation: retryOp,

        item,

        workStatus: WorkStatus.PENDING,

        onDelete: function () {},

        upsertTime: Date.now(),
      };

      return workItem;
    }

    case 'onAdd':
      needed = await needsProvisioningOnCreateOrUpdate(item);

      if (needed.needs) {
        workItem = {
          operation:
            needed.reason === 'CREATED'
              ? OperationType.CREATED
              : OperationType.UPDATED,

          item,

          workStatus: WorkStatus.PENDING,

          onDelete: function () {},

          upsertTime: Date.now(),
        };

        return workItem;
      }

      return null;

    case 'onMarkedToDeletion':
      if (workItem !== null && workItem.workStatus === WorkStatus.PENDING) {
        workItem.operation = OperationType.MARKED_TO_DELETION;
        workItem.upsertTime = Date.now();
        return null;
      } else {
        workItem = {
          operation: OperationType.MARKED_TO_DELETION,

          item,

          workStatus: WorkStatus.PENDING,

          onDelete: function () {},

          upsertTime: Date.now(),
        };

        return workItem;
      }

    case 'onUpdate':
      if (workItem !== null && workItem.workStatus === WorkStatus.PENDING) {
        workItem.operation = OperationType.UPDATED;

        return null;
      } else {
        workItem = {
          operation: OperationType.UPDATED,

          item,

          workStatus: WorkStatus.PENDING,

          onDelete: function () {},

          upsertTime: Date.now(),
        };

        return workItem;
      }

    default:
      throw new Error(`Unknown operation ${op}`);
  }
}

async function loop() {
  const f = () =>
    new Promise<void>((resolve) => setTimeout(() => resolve(), 1000));

  while (1) {
    await f();
  }
}
