jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/status', () => ({
  updateTransition: jest.fn(),
}));

jest.mock('../src/processItemDLH', () => ({
  deadLetterHandler: jest.fn(),
}));

jest.mock('../src/metricsServer', () => ({
  __esModule: true,
  default: jest.fn(),
  getProcessItemSlotMetrics: jest.fn(),
}));

jest.mock('../src/metrics/processItem.slot.metrics', () => ({
  ProcessItemSlotMetrics: jest.fn(),
}));

jest.mock('../src/metrics/processItem.global.metrics', () => ({
  ProcessorGlobalMetrics: {
    getInstance: jest.fn().mockReturnValue({
      recordProcessingDuration: jest.fn(),
    }),
    init: jest.fn(),
  },
}));

import { WorkItem, WorkStatus, OperationType } from '../src/definitions';
import {
  DeferredSchedulingBookkeeper,
  MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER,
} from '../src/processItem.blocks';
import { initProcessItemsSlots } from '../src/processItem.slot';

function makeWorkItem(
  uid: string,
  kind: string = 'FirestartrGithubRepository',
  operation: OperationType = OperationType.MARKED_TO_DELETION,
): WorkItem {
  return {
    item: { metadata: { name: 'demo', namespace: 'default', uid }, kind },
    operation,
    workStatus: WorkStatus.PENDING,
    onDelete: () => {},
  } as any as WorkItem;
}

describe('DeferredSchedulingBookkeeper - deferred scheduling bookkeeping', () => {
  let bookkeeper: DeferredSchedulingBookkeeper;

  beforeEach(() => {
    bookkeeper = new DeferredSchedulingBookkeeper();
  });

  it('should NOT defer before or at the threshold', () => {
    const item = makeWorkItem('X1');
    expect(bookkeeper.isDeferredSchedulingApplicable(item)).toBe(true);
    for (let i = 1; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER; i++) {
      expect(bookkeeper.incrementBlockedAttempt(item)).toBe(i);
      expect(bookkeeper.isDeferred(item)).toBe(false);
    }
  });

  it('should defer on the 6th blocked attempt, not before', () => {
    const item = makeWorkItem('X2');
    for (let i = 1; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER; i++)
      bookkeeper.incrementBlockedAttempt(item);
    expect(bookkeeper.isDeferred(item)).toBe(false);
    bookkeeper.incrementBlockedAttempt(item);
    expect(bookkeeper.isDeferred(item)).toBe(true);
    expect(bookkeeper.getDeferredOrder(item)).toBeDefined();
  });

  it('should preserve stable deferred order among many', () => {
    const items = [makeWorkItem('AA'), makeWorkItem('BB'), makeWorkItem('CC')];
    for (const item of items) {
      for (let i = 1; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 1; i++)
        bookkeeper.incrementBlockedAttempt(item);
    }
    const orders = items.map((i) => bookkeeper.getDeferredOrder(i));
    expect(orders).toEqual([1, 2, 3]);
  });

  it('should partition queue into non-deferred and deferred segments, ordered', () => {
    const early = makeWorkItem('YY');
    const late = makeWorkItem('ZZ');
    // Defer early, leave late non-deferred
    for (let i = 0; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER; i++)
      bookkeeper.incrementBlockedAttempt(early);
    bookkeeper.incrementBlockedAttempt(late); // Only 1 blocked - not deferred
    // Compose queue
    const queue = [early, late];
    const { nonDeferred, deferred } =
      bookkeeper.partitionQueueByDeferred(queue);
    expect(nonDeferred).toContain(late);
    expect(deferred).toContain(early);
  });

  it('should remove all bookkeeping data when cleaned up', () => {
    const item = makeWorkItem('R1');
    for (let i = 0; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 1; i++)
      bookkeeper.incrementBlockedAttempt(item);
    expect(bookkeeper.getBlockedAttempts(item)).toBe(
      MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 2,
    );
    expect(bookkeeper.isDeferred(item)).toBe(true);
    bookkeeper.removeBookkeeping(item);
    expect(bookkeeper.getBlockedAttempts(item)).toBe(0);
    expect(bookkeeper.getDeferredOrder(item)).toBeUndefined();
  });

  it('should not defer kinds not in SUPPORTED_PARENT_KINDS', () => {
    const nonRepo = makeWorkItem(
      'XXX',
      'SomeOtherKind',
      OperationType.MARKED_TO_DELETION,
    );
    for (let i = 0; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 10; i++)
      bookkeeper.incrementBlockedAttempt(nonRepo);
    expect(bookkeeper.isDeferredSchedulingApplicable(nonRepo)).toBe(false);
    expect(bookkeeper.isDeferred(nonRepo)).toBe(false);
  });

  it('should not defer non-deletion operations', () => {
    const updatedItem = makeWorkItem('U1', 'FirestartrGithubRepository', OperationType.UPDATED);
    expect(bookkeeper.isDeferredSchedulingApplicable(updatedItem)).toBe(false);
    for (let i = 0; i <= MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 10; i++)
      bookkeeper.incrementBlockedAttempt(updatedItem);
    expect(bookkeeper.isDeferred(updatedItem)).toBe(false);
  });

  it('should apply to RETRY operation with deletionTimestamp', () => {
    const retryItem = {
      item: {
        metadata: {
          name: 'demo',
          namespace: 'default',
          uid: 'retry-uid',
          deletionTimestamp: '2024-01-01T00:00:00Z',
        },
        kind: 'FirestartrGithubRepository',
      },
      operation: OperationType.RETRY,
      workStatus: WorkStatus.PENDING,
      onDelete: () => {},
    } as any as WorkItem;
    expect(bookkeeper.isDeferredSchedulingApplicable(retryItem)).toBe(true);
  });

  it('should not apply to RETRY operation without deletionTimestamp', () => {
    const retryItem = makeWorkItem('retry-no-ts', 'FirestartrGithubRepository', OperationType.RETRY);
    expect(bookkeeper.isDeferredSchedulingApplicable(retryItem)).toBe(false);
  });

  it('should gracefully handle items missing metadata.uid (no throw)', () => {
    const noUidItem = {
      item: { metadata: { name: 'x', namespace: 'default' }, kind: 'FirestartrGithubRepository' },
      operation: OperationType.MARKED_TO_DELETION,
      workStatus: WorkStatus.PENDING,
      onDelete: () => {},
    } as any as WorkItem;
    expect(() => bookkeeper.incrementBlockedAttempt(noUidItem)).not.toThrow();
    expect(bookkeeper.incrementBlockedAttempt(noUidItem)).toBe(0);
    expect(bookkeeper.isDeferred(noUidItem)).toBe(false);
  });
});

describe('DeferredSchedulingBookkeeper - integration with processItem slot', () => {
  let bookkeeper: DeferredSchedulingBookkeeper;
  const onBlockedCalls: WorkItem[] = [];

  beforeEach(() => {
    bookkeeper = new DeferredSchedulingBookkeeper();
    onBlockedCalls.length = 0;
  });

  it('should increment blocked attempt via slot onWorkItemBlockedByHandler callback', async () => {
    const blockedItem = makeWorkItem('slot-test-uid');

    // Track calls via our own spy that also calls the real bookkeeper
    const onWorkItemBlockedByHandler = jest.fn((w: WorkItem) => {
      onBlockedCalls.push(w);
      bookkeeper.incrementBlockedAttempt(w);
    });

    const slots = initProcessItemsSlots(1, false, onWorkItemBlockedByHandler);

    // Build a work item that triggers needsBlocking
    const workItem: WorkItem = {
      ...blockedItem,
      getItem: async () => blockedItem.item,
      process: async function* () { /* never reached */ },
      handler: {
        finalize: async () => ({}),
        pluralKind: 'githubrepositories',
        informPlan: async () => {},
        writeTerraformOutputInTfResult: async () => ({}),
        writeConnectionSecret: async () => {},
        resolveReferences: async () => ({} as any),
        resolveOwnOutputs: async () => undefined,
        deleteSecret: async () => null,
        itemPath: () => 'test/path',
        error: async () => {},
        success: async () => {},
        recommendedTimeout: () => 1000,
        needsBlocking: (_item: any, _operation: any) => true,
      } as any,
    };

    const [slot] = [...slots.getIdleSlots()];
    await slot.runWorkItem(workItem);

    // The callback should have been called once (when needsBlocking fired)
    expect(onWorkItemBlockedByHandler).toHaveBeenCalledTimes(1);
    expect(onBlockedCalls[0]).toBe(workItem);
    // And the bookkeeper should have recorded the blocked attempt
    expect(bookkeeper.getBlockedAttempts(blockedItem)).toBe(1);
  });

  it('should move item to deferred segment after MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER+1 blocks', () => {
    const item = makeWorkItem('defer-test');

    // Simulate MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 1 blocking events
    for (let i = 0; i < MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 1; i++) {
      bookkeeper.incrementBlockedAttempt(item);
    }

    expect(bookkeeper.isDeferred(item)).toBe(true);

    const otherItem = makeWorkItem('other');
    const queue = [item, otherItem];
    const { nonDeferred, deferred } = bookkeeper.partitionQueueByDeferred(queue);

    expect(deferred).toContain(item);
    expect(nonDeferred).toContain(otherItem);
    expect(nonDeferred).not.toContain(item);
  });

  it('should clean up deferred item from bookkeeper when removed by garbage collector', () => {
    const item = makeWorkItem('gc-test');

    for (let i = 0; i < MAX_BLOCKED_ATTEMPTS_BEFORE_DEFER + 1; i++) {
      bookkeeper.incrementBlockedAttempt(item);
    }
    expect(bookkeeper.isDeferred(item)).toBe(true);

    // Simulate GC removing the finished item
    bookkeeper.removeBookkeeping(item);

    expect(bookkeeper.getBlockedAttempts(item)).toBe(0);
    expect(bookkeeper.isDeferred(item)).toBe(false);
    expect(bookkeeper.getDeferredOrder(item)).toBeUndefined();
  });
});
