import { OperationType } from '../definitions';

/**
 * Whether a finished plan records a synchronization. A deletion and a
 * NOTHING artifact don't: neither runs the sync the live operator would,
 * so a pending or overdue sync must stay due.
 */
export function planRecordsSync(operation: OperationType): boolean {
  return (
    operation !== OperationType.MARKED_TO_DELETION &&
    operation !== OperationType.NOTHING
  );
}
