import log from '../src/logger';

import { OperationType, WorkItemHandler } from '../src/informer';

import {
  APPLY_DEFAULT_ERROR_MESSAGE,
  DESTROY_DEFAULT_ERROR_MESSAGE,
  PLAN_DEFAULT_ERROR_MESSAGE,
  SYNC_DEFAULT_ERROR_MESSAGE,
} from '../src/utils/operationErrorMessages';

import { getPluralFromKind } from '../src/definitions';

import { upsertFinalizer, unsetFinalizer, getItemByItemPath } from '../src/ctl';

import { traverseCRCollection } from '../src/ctl_collections';

const dummyChildrenMap: Record<string, string[]> = {
  FirestartrDummyA: ['FirestartrDummyB'],
  FirestartrDummyB: ['FirestartrDummyC'],
};

export function processFirestartrDummies(item: any, op: string, handler: any) {
  log.info(`FirestartrDummies Processor: ${op}`);

  try {
    switch (op) {
      case OperationType.UPDATED:
        return updated(item, op, handler);

      case OperationType.CREATED:
        return created(item, op, handler);

      case OperationType.RENAMED:
        return renamed();

      case OperationType.MARKED_TO_DELETION:
        return marked(item, op, handler);

      case OperationType.RETRY:
        return retry();

      case OperationType.NOTHING:
        return nothing();

      default:
        throw new Error(`Operation ${op} not supported`);
    }
  } catch (e: any) {
    log.error(
      `The Dummy processor encountered an error during operation '${op}': '${e}'.`,
    );
    throw e;
  }
}

async function* updated(item: any, op: OperationType, handler: any) {
  log.info(`Updated op in ${item.kind}/${item.metadata.name}`);
  for await (const transition of doRun(item, op, handler)) {
    yield transition;
  }

  await manageDummyOwnershipReferences(item, handler);
}

async function* created(item: any, op: OperationType, handler: any) {
  for await (const transition of doRun(item, op, handler)) {
    yield transition;
  }

  await manageDummyOwnershipReferences(item, handler);
}

async function manageDummyOwnershipReferences(item: any, _handler: any) {
  /*******************************************************************************
  // suspended due to https://github.com/prefapp/gitops-k8s/issues/1767
  if ('needs' in item.spec) {
    const needs = item.spec.needs;
    await setOwnerReference(
      handler.itemPath(),
      item.metadata.namespace,
      getPluralFromKind(needs.kind),
      needs.name,
    );
  }
  ********************************************************************************/
  if ('needs' in item.spec) {
    await installParentFinalizer(item);
  }
}

async function manageDummyOwnershipPostDeletion(item: any, _handler: any) {
  if ('needs' in item.spec) {
    await manageChildrenReferences(item);
  }
  if (Object.prototype.hasOwnProperty.call(dummyChildrenMap, item.kind)) {
    await removeFinalizerIfNoMoreChildren(item);
  }
}

async function installParentFinalizer(item: any) {
  const needs = item.spec.needs;
  const parentItem = await getItemByItemPath(
    [item.metadata.namespace, getPluralFromKind(needs.kind), needs.name].join(
      '/',
    ),
  );
  await upsertFinalizer(
    getPluralFromKind(parentItem.kind),
    parentItem.metadata.namespace,
    parentItem,
    'firestartr.dev/foreground-deletion',
  );
}

async function manageChildrenReferences(item: any) {
  const parentItem = await getItemByItemPath(
    [
      item.metadata.namespace,
      getPluralFromKind(item.spec.needs.kind),
      item.spec.needs.name,
    ].join('/'),
  );
  await removeFinalizerIfNoMoreChildren(parentItem);
}

async function removeFinalizerIfNoMoreChildren(parentItem: any) {
  try {
    let numberOfChildren = 0;
    const childKinds = dummyChildrenMap[parentItem.kind];
    if (!childKinds) return;

    for (const childKind of childKinds) {
      const children = await findDummiesWithNeeds(childKind, parentItem);
      numberOfChildren += children.length;
    }

    if (numberOfChildren === 0) {
      try {
        await unsetFinalizer(
          getPluralFromKind(parentItem.kind),
          parentItem.metadata.namespace,
          parentItem,
          'firestartr.dev/foreground-deletion',
        );
      } catch (unsetErr: any) {
        if (typeof unsetErr === 'string' && unsetErr.includes('Not Found')) {
          log.info(
            `${parentItem.kind}/${parentItem.metadata.name} was already deleted; skipping finalizer removal`,
          );
        } else {
          throw unsetErr;
        }
      }
    }
  } catch (err) {
    log.error(
      `Error managing children references in item: ${parentItem.kind}/${parentItem.metadata.name}: ${err}`,
    );
    throw new Error(
      `Error managing children references in item: ${parentItem.kind}/${parentItem.metadata.name}: ${err}`,
    );
  }
}

async function findDummiesWithNeeds(kind: string, parentItem: any) {
  const children = [];
  const pluralKind = getPluralFromKind(kind);
  for await (const crItem of traverseCRCollection(
    pluralKind,
    parentItem.metadata.namespace,
  )) {
    if (
      'needs' in crItem.spec &&
      crItem.spec.needs.name === parentItem.metadata.name &&
      crItem.spec.needs.kind === parentItem.kind
    ) {
      children.push(crItem);
    }
  }
  return children;
}

async function renamed() {
  throw new Error('Renamed operation not prepared');
}

async function* sync(item: any, op: OperationType, handler: any) {
  for await (const transition of doRun(item, op, handler)) {
    yield transition;
  }
}

async function* marked(item: any, op: OperationType, handler: any) {
  for await (const transition of markedToDeletion(item, op, handler)) {
    yield transition;
  }
}

async function* retry() {}

async function* nothing() {}

async function* markedToDeletion(item: any, op: OperationType, handler: any) {
  let error = false;

  try {
    const type = 'DELETING';

    yield {
      item,
      reason: op,
      type: 'PROVISIONING',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'DELETED',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'PLANNING',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'OUT_OF_SYNC',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doApply',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'False',
      message: 'Synth',
    };

    yield {
      item,
      reason: op,
      type,
      status: 'True',
      message: 'Destroying process started',
    };

    await handler.resolveReferences();

    await processDummy(item, op);

    yield {
      item,
      reason: op,
      type,
      status: 'False',
      message: 'Destroying process finished',
    };

    yield {
      item,
      reason: op,
      type: 'DELETED',
      status: 'True',
      message: 'destroyed',
    };

    await handler.finalize(
      handler.pluralKind,
      item.metadata.namespace,
      item,
      'firestartr.dev/finalizer',
    );

    await manageDummyOwnershipPostDeletion(item, handler);

    void handler.success();
  } catch (e: any) {
    error = true;

    void handler.error();
  } finally {
    if (error) {
      yield {
        item,
        reason: op,
        type: 'ERROR',
        status: 'True',
        message: DESTROY_DEFAULT_ERROR_MESSAGE,
      };
    }
  }
}

async function* doRun(item: any, op: OperationType, handler: any) {
  let error = false;

  try {
    yield {
      item,
      reason: op,
      type: 'DELETED',
      status: 'False',
      message: 'markedToDeletion',
    };

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doRun',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'False',
      message: 'Run processor',
    };

    //let output = '';

    const type = 'PROVISIONING';

    yield {
      item,
      reason: op,
      type,
      status: 'True',
      message: 'Provisioning process started',
    };

    const deps = await handler.resolveReferences();

    log.info(
      `The dummy processor is applying and assessing dependencies for item '${item.kind}/${item.metadata.name}' with dependencies: '${deps}'.`,
    );

    await processDummy(item, op);

    yield {
      item,
      reason: op,
      type,
      status: 'False',
      message: 'Dummy Processor apply finished',
    };

    yield {
      item,
      reason: op,
      type: 'PROVISIONED',
      status: 'True',
      message: 'Dummy Processor apply finished',
    };

    yield {
      item,
      reason: op,
      type: 'ERROR',
      status: 'False',
      message: 'doApply',
    };

    await handler.success();
  } catch (e: any) {
    error = true;

    console.error(e);

    log.error(
      `The Dummy processor encountered an error during operation '${op}' for item '${item.kind}/${item.metadata.name}': '${e}'.`,
    );

    await handler.error();
  } finally {
    if (error) {
      yield {
        item,
        reason: op,
        type: 'ERROR',
        status: 'True',
        message: APPLY_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'PROVISIONED',
        status: 'False',
        message: APPLY_DEFAULT_ERROR_MESSAGE,
      };

      yield {
        item,
        reason: op,
        type: 'PROVISIONING',
        status: 'False',
        message: APPLY_DEFAULT_ERROR_MESSAGE,
      };
    }
  }
}

async function processDummy(item: any, op: OperationType) {
  const s =
    op === OperationType.MARKED_TO_DELETION
      ? item.spec?.computation?.numberOfSecondsToDestroy
      : item.spec?.computation?.numberOfSeconds;

  log.info(
    `Processing dummy (op = ${op}) ${item.kind}/${item.metadata.name}: computing for ${s} seconds`,
  );

  if (!s) throw new Error('Unprocessable dummy: no seconds section');

  await fWait(s * 1000);
}

function fWait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(
      () => {
        resolve();
      },

      ms,
    );
  });
}
