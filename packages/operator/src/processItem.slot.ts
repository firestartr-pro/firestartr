import { WorkItem, WorkStatus } from './definitions';

import log from './logger';

import { updateTransition } from './status';

import { deadLetterHandler } from './processItemDLH';

import { getProcessItemSlotMetrics } from './metricsServer';

import { ProcessItemSlotMetrics } from './metrics/processItem.slot.metrics';
import { ProcessorGlobalMetrics } from './metrics/processItem.global.metrics';

export function initProcessItemsSlots(
  nSlots: number,
  initMetrics = true,
  onWorkItemBlockedByHandler?: (workItem: WorkItem) => void,
): ProcessItemSlots {
  log.info(`Initializing ${nSlots} processing slots...`);

  return new ProcessItemSlots(nSlots, initMetrics, onWorkItemBlockedByHandler);
}

export class ProcessItemSlots {
  _slots: ProcessItemSlot[];

  _nSlots: number;

  _guardRails: GuardRails;

  constructor(
    nSlots: number,
    initMetrics: boolean,
    onWorkItemBlockedByHandler?: (workItem: WorkItem) => void,
  ) {
    this._guardRails = new GuardRails();

    // let's init the slots
    this._nSlots = nSlots;

    this._slots = new Array(nSlots).fill(0).map((_, i) => {
      const slot = new ProcessItemSlot(i);

      if (initMetrics) {
        try {
          slot.metrics = getProcessItemSlotMetrics(i);
        } catch (error) {
          log.warn(
            `Process item slot metrics unavailable for slot ${i}; continuing without per-slot metrics.`,
            error,
          );
        }
      }

      slot.actions = {
        blockItem: (item) => this._guardRails.block(item),

        unblockItem: (item) => this._guardRails.unblock(item),

        onWorkItemBlockedByHandler,
      };

      return slot;
    });
  }

  *getIdleSlots() {
    for (const slot of this._slots) {
      if (slot.idle) yield slot;
    }
  }

  allSlotsAreIdle() {
    return this._slots.every((slot) => slot.idle);
  }

  isWorkItemBlocked(workItem: WorkItem) {
    return this._guardRails.isBlocked(workItem.item);
  }
}

class GuardRails {
  _processing: Map<string, boolean>;

  constructor() {
    this._processing = new Map();
  }

  block(item) {
    const itemPath = this.itemToGuard(item);

    this._processing.set(itemPath, true);
  }

  unblock(item) {
    const itemPath = this.itemToGuard(item);

    this._processing.delete(itemPath);
  }

  isBlocked(item) {
    const itemPath = this.itemToGuard(item);

    return this._processing.has(itemPath);
  }

  itemToGuard(item: any) {
    return `${item.kind}/${item.metadata.namespace}/${item.metadata.name}`;
  }
}

export class ProcessItemSlot {
  _idle: boolean;

  _id: number;

  _actions:
    | {
        blockItem: (item) => void;
        unblockItem: (item) => void;
        onWorkItemBlockedByHandler?: (workItem: WorkItem) => void;
      }
    | undefined;

  _metrics: ProcessItemSlotMetrics;

  constructor(id: number) {
    this._id = id;
    this._idle = true;
  }

  set actions(actions: {
    blockItem: (item) => void;
    unblockItem: (item) => void;
    onWorkItemBlockedByHandler?: (workItem: WorkItem) => void;
  }) {
    this._actions = actions;
  }

  get actions() {
    return this._actions;
  }

  get idle() {
    return this._idle;
  }

  get id() {
    return this._id;
  }

  set metrics(metrics: ProcessItemSlotMetrics) {
    this._metrics = metrics;
  }

  get metrics() {
    return this._metrics;
  }

  async runWorkItem(workItem: WorkItem) {
    this._idle = false;

    const startTime = Date.now(); // ← capture exact start for global metrics

    try {
      if (this.actions) {
        this.actions.blockItem(workItem.item);
      }

      if (this.metrics) {
        this.metrics.runItemStarted();
      }

      await this.__run(workItem);
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.includes('Error on getItemByItemPath')
      ) {
        log.debug(
          `Item '${workItem.item.kind}/${workItem.item.metadata.name}' was not found, so its work item is being removed from the processor queue.`,
        );

        workItem.workStatus = WorkStatus.FINISHED;
      } else {
        log.error(
          `An unmanaged error occurred while the processor was handling the '${workItem.operation}' operation for item '${workItem.item.kind}/${workItem.item.metadata.name}' in namespace '${workItem.item.metadata.namespace}'. Current work status is '${workItem.workStatus}'. The error was: '${e}'.`,
        );

        await deadLetterHandler(workItem);

        console.error(e);
      }
    } finally {
      if (this.actions) {
        this.actions.unblockItem(workItem.item);
      }

      // if metrics are enabled, we record the processing duration for this item
      // and update the global metrics
      if (this.metrics) {
        this.metrics.runItemFinished();

        // REPORT TO GLOBAL SINGLETON for metrics
        const durationSeconds = (Date.now() - startTime) / 1000;
        ProcessorGlobalMetrics.getInstance().recordProcessingDuration(
          durationSeconds,
        );
      }

      workItem.isPicked = false;
    }

    this._idle = true;
  }

  async __run(workItem: WorkItem) {
    if (!workItem.getItem || !workItem.process || !workItem.operation) return;

    const raceDelayMs = process.env.RACE_DELAY_MS
      ? Number.parseInt(process.env.RACE_DELAY_MS, 10)
      : 0;
    if (raceDelayMs > 0) {
      const jitter = Math.floor(Math.random() * raceDelayMs);
      await new Promise((r) => setTimeout(r, jitter));
    }

    const item: any = await workItem.getItem();

    workItem.item = item;

    // we check if the workItem needs blocking
    // if it does need it we return because we cannot
    // process this item
    if (
      'needsBlocking' in workItem.handler &&
      workItem.handler.needsBlocking(item, workItem.operation)
    ) {
      log.debug(`Item ${item.kind}/${item.metadata.namespace} needs blocking`);
      // Fire-and-forget: the callback is synchronous bookkeeping only;
      // no async side effects are expected from this callback.
      this._actions?.onWorkItemBlockedByHandler?.(workItem);
      return;
    }

    workItem.workStatus = WorkStatus.PROCESSING;

    workItem.slotId = this.id;
    workItem.handler.getSlotInfo = () => ({ slotId: this.id });

    for await (const condition of workItem.process(
      item,
      workItem.operation,
      workItem.handler,
    )) {
      if (workItem.handler === undefined)
        throw new Error('handler is undefined');

      await updateTransition(
        workItem.handler.itemPath(),

        condition.reason,

        condition.type,

        condition.status,

        condition.message,

        condition.updateStatusOnly || false,
      );
    }

    workItem.workStatus = WorkStatus.FINISHED;
  }
}
