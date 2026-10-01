import common from 'catalog_common';

import { getConnection, getItem, getItemByItemPath } from './ctl';

import { traverseCRCollection } from './ctl_collections';

import log from './logger';

export async function findCRsWithReference(kind: string, item: any) {
  try {
    const crChildren = [];

    for await (const crItem of traverseCRCollection(
      kind,
      item.metadata.namespace,
    )) {
      if ('repositoryTarget' in crItem.spec) {
        const repositoryTarget = crItem.spec.repositoryTarget as any;
        if (
          repositoryTarget.ref.name === item.metadata.name &&
          repositoryTarget.ref.kind === item.kind
        ) {
          crChildren.push(crItem);
        }
      }
    }

    return crChildren;
  } catch (err) {
    log.error(
      `Error finding Crs with reference for ${item.kind}/${item.metadata.name}: ${err}`,
    );
    throw new Error(
      `Error finding Crs with reference for ${item.kind}/${item.metadata.name}: ${err}`,
    );
  }
}
