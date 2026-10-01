// processItem.blocks.ts
// Responsible for all in-memory deferred-scheduling bookkeeping for blocked parent deletions.
//
// Always extract WorkItem identity for all in-memory maps and keys by calling
// getWorkItemIdentity() from definitions.ts, and NOT by constructing your own key.
// This ensures spec compliance and future maintainability.
//
// Does NOT detect "blocked" state (caller must supply outcome). Purely key/value scheduler-local state logic per spec.

// --- Types ---

import type { WorkItem } from './definitions';
import { getWorkItemIdentity, OperationType } from './definitions';
// Only use getWorkItemIdentity(item) for identity bookkeeping and maps.

// --- Config: Deferral Policy ---

/**
 * Maximum number of blocked attempts allowed before an item is moved to the deferred segment.
 * An item becomes deferred once its blocked-attempt count exceeds this value.
 */
export const MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER = 5;

// Initial supported parent kind(s): extensible for future cases
export const SUPPORTED_PARENT_KINDS = new Set(['FirestartrGithubRepository']);

// --- Bookkeeper Class ---

/**
 * Encapsulates all deferred-scheduling bookkeeping state for one scheduler queue.
 * Instantiate once per queue (alongside processItemSlotsManager) inside loop().
 */
export class DeferredSchedulingBookkeeper {
  private _blockedAttempts: Map<string, number> = new Map();
  private _deferredEntryOrder: Map<string, number> = new Map();
  private _deferredOrderCounter = 0;

  // --- Applicability Logic ---

  /**
   * Returns true only for supported parent kinds AND only for deletion operations.
   * Per spec Definition 2: applicable when operation is MARKED_TO_DELETION,
   * or RETRY with metadata.deletionTimestamp set.
   */
  isDeferredSchedulingApplicable(item: WorkItem): boolean {
    const kind =
      item.item && item.item.kind ? item.item.kind : (item as any).kind;
    if (!SUPPORTED_PARENT_KINDS.has(kind)) return false;
    const op = item.operation;
    if (op === OperationType.MARKED_TO_DELETION) return true;
    if (
      (op === OperationType.RETRY || op === OperationType.RETRY_SYNC) &&
      item.item?.metadata?.deletionTimestamp
    )
      return true;
    return false;
  }

  // --- Bookkeeping API ---

  /**
   * Increments block counter for item (only call when item has been detected as blocked).
   * Returns new value. Promotes item to deferred segment if threshold crossed.
   */
  incrementBlockedAttempt(item: WorkItem): number {
    if (!this.isDeferredSchedulingApplicable(item)) return 0;
    const id = getWorkItemIdentity(item);
    if (id === undefined) return 0;
    const prev = this._blockedAttempts.get(id) || 0;
    const next = prev + 1;
    this._blockedAttempts.set(id, next);
    if (
      next > MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER &&
      !this._deferredEntryOrder.has(id)
    ) {
      this._deferredEntryOrder.set(id, ++this._deferredOrderCounter);
    }
    return next;
  }

  getBlockedAttempts(item: WorkItem): number {
    if (!this.isDeferredSchedulingApplicable(item)) return 0;
    const id = getWorkItemIdentity(item);
    if (id === undefined) return 0;
    return this._blockedAttempts.get(id) || 0;
  }

  isDeferred(item: WorkItem): boolean {
    if (!this.isDeferredSchedulingApplicable(item)) return false;
    return this.getBlockedAttempts(item) > MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER;
  }

  getDeferredOrder(item: WorkItem): number | undefined {
    if (!this.isDeferredSchedulingApplicable(item)) return undefined;
    const id = getWorkItemIdentity(item);
    if (id === undefined) return undefined;
    return this._deferredEntryOrder.get(id);
  }

  removeBookkeeping(item: WorkItem): void {
    if (!this.isDeferredSchedulingApplicable(item)) return;
    const id = getWorkItemIdentity(item);
    if (id === undefined) return;
    this._blockedAttempts.delete(id);
    this._deferredEntryOrder.delete(id);
  }

  // --- Queue Partitioning ---

  /**
   * Splits queue into non-deferred and deferred, preserving original order,
   * but sorts deferred by stable insertion order.
   */
  partitionQueueByDeferred<T extends WorkItem>(
    queue: T[],
  ): { nonDeferred: T[]; deferred: T[] } {
    const nonDeferred: T[] = [];
    const deferred: T[] = [];
    for (const item of queue) {
      if (this.isDeferredSchedulingApplicable(item) && this.isDeferred(item)) {
        deferred.push(item);
      } else {
        nonDeferred.push(item);
      }
    }
    deferred.sort((a, b) => {
      const orderA = this.getDeferredOrder(a) || 0;
      const orderB = this.getDeferredOrder(b) || 0;
      return orderA - orderB;
    });
    return { nonDeferred, deferred };
  }

  // --- TESTING / DEBUG ---

  clearAllBookkeeping(): void {
    this._blockedAttempts.clear();
    this._deferredEntryOrder.clear();
    this._deferredOrderCounter = 0;
  }
}
