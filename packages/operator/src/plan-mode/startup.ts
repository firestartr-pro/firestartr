import { OperationType, retryOpForReason } from '../definitions';

/**
 * The operation Plan mode audits for a CR found at startup that the live
 * gate would not provision: the live retry for an active ERROR, NOTHING
 * otherwise. Every CR then gets an artifact.
 */
export function planStartupOperation(item: any): OperationType {
  const errorCondition = item.status?.conditions?.find(
    (c: any) => c.type === 'ERROR' && c.status === 'True',
  );

  return errorCondition
    ? retryOpForReason(errorCondition.reason)
    : OperationType.NOTHING;
}
