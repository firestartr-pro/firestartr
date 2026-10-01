import { getPluralFromKind } from '../definitions';

import { OperationType, WorkItemHandler } from '../informer';

import log from '../logger';

import { setOwnerReference } from '../ownership';

import { upsertFinalizer, unsetFinalizer, getItemByItemPath } from '../ctl';

import { findCRsWithReference } from '../children';

const kindsWithFirestartrGithubRepositoryDependence = [
  'FirestartrGithubRepositorySecretsSection',
  'FirestartrGithubRepositoryFeature',
];

const kindsWithChildren = ['FirestartrGithubRepository'];

export async function manageOwnershipReferences(
  item: any,
  handler: any,
  op: OperationType,
) {
  /*********************************************************************************
  // suspended due to https://github.com/prefapp/gitops-k8s/issues/1767
  if (kindsWithFirestartrGithubRepositoryDependence.indexOf(item.kind) !== -1) {
    // await manageOwnershipReferencesForRepo(item, handler, op);

  }
   *******************************************************************************/
  if (kindsWithFirestartrGithubRepositoryDependence.indexOf(item.kind) !== -1) {
    // we need the parent
    const parentItem = await getItemByItemPath(
      [
        item.metadata.namespace,
        getPluralFromKind('FirestartrGithubRepository'),
        item.spec.repositoryTarget.ref.name,
      ].join('/'),
    );

    await installDependencesFinalizer(parentItem, handler, op);
  }
}

export async function manageOwnershipReferencesPostDeletion(
  item: any,
  handler: any,
  op: OperationType,
) {
  // We will check if the repo has still some references left
  if (kindsWithFirestartrGithubRepositoryDependence.indexOf(item.kind) !== -1) {
    await manageChildrenReferences(item, handler, op);
  }
  // if the parent is being deleted is ok to control there are no more children
  // for preventing a stuck deletion
  else if (kindsWithChildren.indexOf(item.kind) !== -1) {
    await removeFinalizerIfNoMoreChildren(item, handler, op);
  }
}

async function manageChildrenReferences(
  item: any,
  handler: any,
  op: OperationType,
) {
  // for now is only FirestartrGithubRepository
  const parentItem = await getItemByItemPath(
    [
      item.metadata.namespace,
      getPluralFromKind('FirestartrGithubRepository'),
      item.spec.repositoryTarget.ref.name,
    ].join('/'),
  );

  await removeFinalizerIfNoMoreChildren(parentItem, handler, op);
}

async function removeFinalizerIfNoMoreChildren(
  parentItem: any,
  handler: any,
  op: OperationType,
) {
  try {
    let numberOfChildren = 0;

    for (const child of kindsWithFirestartrGithubRepositoryDependence) {
      const children = await findCRsWithReference(
        getPluralFromKind(child),
        parentItem,
      );

      numberOfChildren += children.length;
    }

    log.error(`Number of children ${numberOfChildren}`);

    if (numberOfChildren === 0) {
      log.info(
        `${parentItem.kind}/${parentItem.metadata.name} has no more children. Removing finalizer of foreground-deletion`,
      );

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

async function installDependencesFinalizer(
  item: any,
  handler: any,
  op: OperationType,
) {
  try {
    await upsertFinalizer(
      getPluralFromKind(item.kind),
      item.metadata.namespace,
      item,
      'firestartr.dev/foreground-deletion',
    );
  } catch (err) {
    log.error(
      `Error inserting finalizer for children dependencies ${item.kind}/${item.metadata.name}`,
    );
    throw new Error(
      `Error inserting finalizer for children dependencies ${item.kind}/${item.metadata.name}`,
    );
  }
}

async function manageOwnershipReferencesForRepo(
  item: any,
  handler: any,
  op: OperationType,
) {
  try {
    const repositoryTarget = item.spec?.repositoryTarget?.ref;

    if (!repositoryTarget) {
      throw `Item ${item.kind}/${item.metadata.namespace} is not correct: it does not have a repositoryTarget`;
    }

    await setOwnerReference(
      handler.itemPath(),
      item.metadata.namespace,
      getPluralFromKind(repositoryTarget.kind),
      repositoryTarget.name,
    );
  } catch (err) {
    log.error(
      `Handling ownership for ${item.kind}/${item.metadata.name}: ${err}`,
    );

    throw new Error(
      `Handling ownership for ${item.kind}/${item.metadata.name}: ${err}`,
    );
  }
}
