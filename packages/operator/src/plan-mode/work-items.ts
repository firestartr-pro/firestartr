import { OperationType } from '../definitions';

/**
 * Whether a finished plan records a synchronization. A deletion (including
 * a retried one) and a NOTHING artifact don't: neither runs the sync the
 * live operator would, so a pending or overdue sync must stay due, and a
 * deleting CR must not get periodic syncs rearmed.
 */
export function planRecordsSync(operation: OperationType, item: any): boolean {
  return (
    operation !== OperationType.MARKED_TO_DELETION &&
    operation !== OperationType.NOTHING &&
    !item?.metadata?.deletionTimestamp
  );
}

/**
 * The retry for a failed plan, from the plan that failed (Plan mode never
 * writes ERROR): a failed sync retries as RETRY_SYNC, so the sync-policy
 * check still applies.
 */
export function planRetryOperation(
  failedOperation: OperationType | undefined,
): OperationType {
  return failedOperation === OperationType.SYNC ||
    failedOperation === OperationType.RETRY_SYNC
    ? OperationType.RETRY_SYNC
    : OperationType.RETRY;
}
