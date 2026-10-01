import common from 'catalog_common';

import log from './src/logger';

export async function* dummy(item: any, op: string, handler: any) {
  log.info(`Running ${op}`);

  const type = op === 'MARKED_TO_DELETION' ? 'DELETING' : 'PROVISIONING';

  const deps = await handler.resolveReferences();

  yield {
    itemPath: handler.itemPath,
    type: 'ERROR',
    status: 'False',
    updateStatusOnly: true,
  };

  yield {
    itemPath: handler.itemPath,
    type: 'PROVISIONED',
    status: 'False',
    updateStatusOnly: true,
  };

  yield {
    itemPath: handler.itemPath,
    reason: op,
    type,
    status: 'True',
    message: 'DUMMY',
  };

  yield {
    itemPath: handler.itemPath,
    reason: op,
    type: 'PLANNING',
    status: 'True',
    message: 'Provisioning item',
  };

  await fWait(2000);

  yield {
    itemPath: handler.itemPath,
    reason: op,
    type: 'PLANNING',
    status: 'False',
    message: 'DUMMY',
  };

  await fWait(5000);

  yield {
    itemPath: handler.itemPath,
    reason: op,
    type,
    status: 'False',
    message: 'DUMMY PROVISIONING',
  };

  if (op === 'MARKED_TO_DELETION') {
    log.info(`Deleting ${item.kind}/${item.metadata.name}`);

    await handler.finalize(
      'githubgroups',
      item.metadata.namespace,
      item,
      common.types.controller.FirestartrFinalizer,
    );

    log.debug(`Writting Output in TFResult ${op}`);

    await handler.writeTerraformOutputInTfResult(item, 'DUMMY DELETED OUPUT');
  } else if (op === 'UPDATED') {
    log.info(`Updating ${item.kind}/${item.metadata.name}`);

    log.debug(`Writting Connection Secret ${op}`);

    await handler.writeConnectionSecret(item, { dummy: { value: 'dummy' } });

    log.debug(`Writting Output in TFResult ${op}`);

    await handler.writeTerraformOutputInTfResult(item, 'DUMMY UPDATED OUPUT');

    yield {
      itemPath: handler.itemPath,
      reason: op,
      type: 'ERROR',
      status: 'True',
      message: 'An error ocurred',
    };

    yield {
      itemPath: handler.itemPath,
      type: 'PROVISIONING',
      status: 'False',
      updateStatusOnly: true,
    };

    yield {
      itemPath: handler.itemPath,
      type: 'PROVISIONED',
      status: 'False',
      updateStatusOnly: true,
    };
  } else if (op === 'CREATED' || op === 'RENAMED') {
    log.info(`Creating ${item.kind}/${item.metadata.name}`);

    log.debug(`Writting Connection Secret ${op}`);

    await handler.writeConnectionSecret(item, { dummy: { value: 'dummy' } });

    log.debug(`Writting Output in TFResult ${op}`);

    await handler.writeTerraformOutputInTfResult(item, 'DUMMY CREATED OUPUT');

    yield {
      itemPath: handler.itemPath,
      reason: op,
      type: 'PROVISIONED',
      status: 'True',
      message: 'DUMMY',
    };
  }

  log.info(`Finished ${op}`);
}

function fWait(ms: number) {
  return new Promise((resolve: Function, reject: Function) => {
    setTimeout(
      () => {
        resolve();
      },

      ms,
    );
  });
}
