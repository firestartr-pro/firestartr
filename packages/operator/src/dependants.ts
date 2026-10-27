import { OperationType } from './definitions';
import { isPlanMode } from './plan-mode/config';

const kindsWithDependants = [
  'FirestartrDummyA',
  'FirestartrDummyB',
  'FirestartrGithubRepository',
];

const FOREGROUND_FINALIZERS = [
  'foregroundDeletion',
  'firestartr.dev/foreground-deletion',
];

/**
 * A deletion of a kind with dependants that must wait until a foreground
 * finalizer is gone, i.e. until its dependants have been deleted.
 */
export function deletionWaitsForDependants(
  item: any,
  operation: OperationType,
): boolean {
  if (!kindsWithDependants.includes(item.kind)) return false;

  const isDeletion =
    operation === OperationType.MARKED_TO_DELETION ||
    ((operation === OperationType.RETRY ||
      operation === OperationType.RETRY_SYNC) &&
      'deletionTimestamp' in item.metadata);

  if (!isDeletion) return false;

  return (item.metadata.finalizers ?? []).some((f: string) =>
    FOREGROUND_FINALIZERS.includes(f),
  );
}

/**
 * The processor's blocking gate. Plan mode never waits on dependants: no live
 * deletion will remove the finalizer, so its handler records a SKIPPED plan.
 */
export function needsDeletionBlocking(
  item: any,
  operation: OperationType,
): boolean {
  return !isPlanMode() && deletionWaitsForDependants(item, operation);
}
