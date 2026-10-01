import { OwnerReference } from './types';

import { getConnection, getItem, getItemByItemPath } from './ctl';

import { getPluralFromKind } from './definitions';

import common from 'catalog_common';

import log from './logger';

export async function getOwnerReferences(item: any): Promise<OwnerReference[]> {
  return item.metadata?.ownerReferences || [];
}

export async function setOwnerReference(
  itemPath: string,
  namespace: string,
  ownerKind: string,
  ownerName: string,
  blockOwnerDeletion = true,
) {
  let item: any = null;

  try {
    // we need to search for the owner's uuid
    const owner: any = await getItemByItemPath(
      `${namespace}/${ownerKind}/${ownerName}`,
    );

    const ownerReference: OwnerReference = {
      apiVersion: owner.apiVersion,
      kind: owner.kind,
      name: ownerName,
      controller: true,
      blockOwnerDeletion,
      uid: owner.metadata.uid,
    };

    // we get the item (to prevent race conditions)
    item = await getItemByItemPath(itemPath);

    const ownerReferences: OwnerReference[] =
      item.metadata.ownerReferences ?? [];

    const existingRefIndex = ownerReferences.findIndex(
      (ref) => ref.uid === ownerReference.uid,
    );

    if (existingRefIndex === -1) {
      // Reference does not exist, add it
      ownerReferences.push(ownerReference);
    } else {
      ownerReferences[existingRefIndex] = ownerReference;
    }

    await writeOwnerReferences(
      getPluralFromKind(item.kind),
      item.metadata.namespace,
      item,
      ownerReferences,
    );
  } catch (err) {
    log.error(err);
    throw `Setting OwnerReferences to ${item.kind}/${item.metadata.name}: ${err}`;
  }
}

export async function writeOwnerReferences(
  kind: string,
  namespace: string,
  item: any,
  ownerReferences: OwnerReference[],
) {
  log.debug(
    `The ctl is setting the ownerReferences for '${kind}/${item.metadata.name}' in namespace '${namespace}'.`,
  );

  const { kc, opts } = await getConnection();

  const currentContext = kc.currentContext;
  const context =
    kc.contexts.find((c) => c.name === currentContext) ?? kc.contexts[0];
  const clusterName = context?.cluster;
  const cluster =
    kc.clusters.find((c) => c.name === clusterName) ?? kc.clusters[0];
  if (!cluster?.server) {
    throw new Error(
      `No cluster server found in KubeConfig (context=${currentContext || '<none>'})`,
    );
  }
  const url = `${cluster.server}/apis/firestartr.dev/v1/namespaces/${namespace}/${kind}/${item.metadata.name}`;
  opts.headers['Content-Type'] = 'application/json-patch+json';

  opts.headers['Accept'] = '*';

  const patch = {
    op: 'replace',

    path: '/metadata/ownerReferences',

    value: ownerReferences,
  };

  const r = await fetch(
    url,

    {
      method: 'PATCH',

      headers: opts.headers,

      body: JSON.stringify([patch]),
    },
  );

  if (!r.ok) {
    throw `Error on setOwnerReferences: ${namespace}/${kind}/${item['metadata']['name']}: ${r.statusText}`;
  }

  return r.json();
}
