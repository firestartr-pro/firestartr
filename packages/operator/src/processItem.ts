import { WorkItem, WorkStatus } from './informer';
import { DeferredSchedulingBookkeeper } from './processItem.blocks';

import log from './logger';

import common from 'catalog_common';

import { loopWorkItemDebug } from './processItem.debug';

import { loopDiagnosticFile } from './processItem.diagnostic';

import { initSignalsHandler } from './signals';

import { initProcessItemsSlots } from './processItem.slot';

import { getItemByItemPathOrNull } from './ctl';

import { sortQueue } from './queueSort';
import {
  buildActiveParentKeys,
  buildDeferredParentKeys,
  hasActiveParent,
} from './parentDependency';

const queue: WorkItem[] = [];

let _deferredBookkeeper: DeferredSchedulingBookkeeper | null = null;
let _activeParentKeys: Set<string> = new Set();
let _deferredParentKeys: Set<string> = new Set();

// We get the number of max slots from the environment variable, if it is not set, we default to 1
function getMaxSlotsFromEnvironment(): number {
  const rawMaxSlots = common.environment.getFromEnvironment(
    common.types.envVars.operatorNumberOfMaxSlots,
  );

  const parsedMaxSlots = Number.parseInt(rawMaxSlots || '1', 10);

  if (!Number.isFinite(parsedMaxSlots) || parsedMaxSlots < 1) {
    return 1;
  }

  return parsedMaxSlots;
}

const MAX_SLOTS = getMaxSlotsFromEnvironment();
export function getQueueMetrics() {
  let renamed = 0;
  let updated = 0;
  let created = 0;
  let sync = 0;
  let marked_to_deletion = 0;
  let nothing = 0;
  let retry = 0;
  let unknown = 0;

  queue.forEach((workItem: WorkItem) => {
    switch (workItem.operation) {
      case 'RENAMED':
        renamed++;
        break;

      case 'UPDATED':
        updated++;
        break;

      case 'CREATED':
        created++;
        break;

      case 'SYNC':
        sync++;
        break;

      case 'MARKED_TO_DELETION':
        marked_to_deletion++;
        break;

      case 'NOTHING':
        nothing++;
        break;

      case 'RETRY':
        retry++;
        break;

      default:
        unknown++;
        break;
    }
  });

  return {
    nItems: queue.length,

    nItemsFinished: queue.filter(
      (workItem: WorkItem) => workItem.workStatus === WorkStatus.FINISHED,
    ).length,

    nItemsPending: queue.filter(
      (workItem: WorkItem) => workItem.workStatus === WorkStatus.PENDING,
    ).length,

    nItemsProcessing: queue.filter(
      (workItem: WorkItem) => workItem.workStatus === WorkStatus.PROCESSING,
    ).length,

    nItemsInDeadLetterHandling: queue.filter(
      (workItem: WorkItem) => workItem.isDeadLetter === true,
    ).length,

    nItemsBlocked: queue.filter(
      (workItem: WorkItem) =>
        workItem.isBlocked === true ||
        hasActiveParent(workItem, _activeParentKeys, _deferredParentKeys),
    ).length,

    nItemsDeferred: _deferredBookkeeper
      ? queue.filter((workItem: WorkItem) =>
          _deferredBookkeeper!.isDeferred(workItem),
        ).length
      : 0,

    nItemsTypes: {
      nothing,
      retry,
      renamed,
      updated,
      sync,
      created,
      marked_to_deletion,
      unknown,
    },
  };
}

let INIT = false;

let podIsTerminating = false;

const handleTerminationSignal = (signal: string) => {
  podIsTerminating = true;

  // If there is no processor loop and no queued work, exit immediately so we don't
  // wait on other event-loop handles (informer watches, keep-alives, etc.).
  if (!INIT && queue.length === 0) {
    log.info(
      `The processor is going to shut down (received ${signal}, no loop started)`,
    );

    process.exit(0);
  }
};

initSignalsHandler(
  new Map<string, () => void>([
    ['SIGTERM', () => handleTerminationSignal('SIGTERM')],
    ['SIGINT', () => handleTerminationSignal('SIGINT')],
  ]),
);

/**
 * Pushes a WorkItem to the queue
 * @param {WorkItem} workItem - WorkItem to process
 */
export async function processItem(workItem: WorkItem) {
  log.info(
    `The processor received a new work item for '${workItem.operation}' operation on '${workItem.item.kind}/${workItem.item.metadata.name}' in namespace '${workItem.item.metadata.namespace}'. Current work status is '${workItem.workStatus}'.`,
  );

  queue.push(workItem);

  if (!INIT) {
    loop().catch((err) => {
      console.error(err);
    });

    INIT = true;
  }
}

/**
 * Wait until there is a WorkItem to process and then process it
 * @returns {void}
 */
async function loop() {
  loopWorkItemDebug(queue);
  loopDiagnosticFile(queue, MAX_SLOTS);

  const deferredBookkeeper = new DeferredSchedulingBookkeeper();

  _deferredBookkeeper = deferredBookkeeper;

  const processItemSlotsManager = initProcessItemsSlots(
    MAX_SLOTS,
    true,
    (w: WorkItem) => deferredBookkeeper.incrementBlockedAttempt(w),
  );

  if (process.env.GARBAGE_QUEUE_COLLECTOR) {
    void workItemGarbageCollector(queue, deferredBookkeeper);
  }

  const nextWorkItem = () => {
    // First, sort the queue and partition it for deferred scheduling.
    const sorted = sortQueue(queue);
    const { nonDeferred, deferred } =
      deferredBookkeeper.partitionQueueByDeferred(sorted);

    // Helper for selection logic
    function pickEligible(arr: WorkItem[]) {
      return arr
        .filter(
          (w: WorkItem) =>
            !w.isBlocked &&
            !w.isPicked &&
            !processItemSlotsManager.isWorkItemBlocked(w),
        )
        .find((w: WorkItem) => w.workStatus === WorkStatus.PENDING);
    }

    // Always prefer non-deferred, only defer if absolutely nothing eligible
    return pickEligible(nonDeferred) || pickEligible(deferred);
  };
  initSignalsHandler(
    new Map<string, () => void>([['SIGTERM', () => (podIsTerminating = true)]]),
  );

  log.info(`
    ------- Processor main loop started with a maximum of '${MAX_SLOTS}' concurrent slots to process items. -------
  `);

  while (1) {
    if (podIsTerminating && processItemSlotsManager.allSlotsAreIdle()) {
      log.info('The processor is going to shutdown (pod is terminating)');

      process.exit(0);

      break;
    }

    // Compute sort/partition + parent-key sets once per scheduling round so
    // that buildDeferredParentKeys (which hits the API server) and the
    // sort/partition are not repeated for every idle slot in the same iteration.
    const sorted = sortQueue(queue);
    const { nonDeferred, deferred } =
      deferredBookkeeper.partitionQueueByDeferred(sorted);
    const activeParentKeys = buildActiveParentKeys(queue);
    const deferredParentKeys = await buildDeferredParentKeys(
      queue,
      activeParentKeys,
      getItemByItemPathOrNull,
    );

    _activeParentKeys = activeParentKeys;
    _deferredParentKeys = deferredParentKeys;

    const pickEligible = (arr: WorkItem[]) =>
      arr
        .filter(
          (w: WorkItem) =>
            !w.isBlocked &&
            !w.isPicked &&
            !processItemSlotsManager.isWorkItemBlocked(w) &&
            !hasActiveParent(w, activeParentKeys, deferredParentKeys),
        )
        .find((w: WorkItem) => w.workStatus === WorkStatus.PENDING);

    // every time an idle slot is available, we check if there is a work item to process and if there is, we process it
    // if there are more idle slots than work items, the next iterations of the loop will just do nothing
    // until there are new work items to process

    for (const idleSlot of processItemSlotsManager.getIdleSlots()) {
      if (podIsTerminating) {
        break;
      }

      const w: WorkItem | undefined =
        pickEligible(nonDeferred) || pickEligible(deferred);

      if (w) {
        // synchronously mark the work item as picked
        w.isPicked = true;

        const logMessage = `${new Date().toISOString()} : Processing OPERATION: ${w.operation} ITEM: ${w.item.kind}/${w.item.metadata.name}`;

        common.io.writeLogFile('process_item', logMessage);

        log.info(
          `The processor (${idleSlot.id}) is currently handling a '${w.operation}' operation for item '${w.item.kind}/${w.item.metadata.name}' in namespace '${w.item.metadata.namespace}'. The current work status is '${w.workStatus}'.`,
        );

        // we do not wait for the item to be processed to start processing the next one,
        // we just start processing it in a new slot
        void idleSlot.runWorkItem(w);
      }
    }

    await wait(podIsTerminating ? 200 : 2000);
  }
}

export { sortQueue } from './queueSort';

/**
 * Wait for a given time
 * @param t Time to wait in milliseconds
 * @returns
 */
function wait(t = 2000) {
  return new Promise((ok: any) => setTimeout(ok, t));
}

/**
 * Periodically checks the queue for finished WorkItems and removes them
 * @param {WorkItem[]} queue - Queue of WorkItems
 */
export async function workItemGarbageCollector(
  queue: WorkItem[],
  bookkeeper?: DeferredSchedulingBookkeeper,
) {
  while (1) {
    log.debug(`The garbage collector processed '${queue.length}' work items.`);

    for (let i = queue.length - 1; i >= 0; i--) {
      const wi = queue[i];
      if (wi.workStatus === WorkStatus.FINISHED) {
        bookkeeper?.removeBookkeeping(wi);
        // Because the queue is a constant, we cannot reassign it, instead we
        // use splice which modifies the array in place
        //wi.onDelete()
        queue.splice(i, 1);
      }
    }

    log.debug(
      `The garbage collector finished its run, leaving '${queue.length}' work items in the queue.`,
    );

    await wait(10 * 1000);
  }
}
