import { WorkItem, WorkStatus } from './informer';

import log from './logger';

import { updateTransition } from './status';

import { incrementDiagnosticErrorCount } from './diagnosticErrors';

/*
 * Dead-Letter Handler
 *
 * It manages failed WorkItems with an uncontrolled exception
 * it always closes the WorkItem and tries to put the CR in an ERROR state
 */
export async function deadLetterHandler(workItem: WorkItem) {
  const { operation } = workItem;

  const itemPath = workItem.handler.itemPath();

  workItem.workStatus = WorkStatus.FINISHED;
  workItem.isDeadLetter = true;

  incrementDiagnosticErrorCount();

  // we try to put the CR in a correct state
  try {
    await updateTransition(
      itemPath,
      operation,
      'ERROR',
      'True',
      'Uncontrolled error (DLH)',
    );

    await updateTransition(
      itemPath,
      operation,
      'PROVISIONED',
      'False',
      'Uncontrolled error (DLH)',
    );

    await updateTransition(
      itemPath,
      operation,
      'PROVISIONING',
      'False',
      'Uncontrolled error (DLH)',
    );
  } catch (err) {
    log.error(
      `Error handling WorkItem in DeadLetter state: ${workItem.handler.itemPath()}: ${err}`,
    );
  }
}
