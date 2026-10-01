import { getConnection, getServerUrl } from '../ctl';
import * as client from '@kubernetes/client-node';
import common from 'catalog_common';

export async function getTFWorkspaceRefs(
  _claimKind: string,
  claimName: string,
  namespace: string,
) {
  const { kc, opts } = await getConnection();

  await kc.makeApiClient(client.CustomObjectsApi);

  const normalizedClaimName = common.generic.normalizeLabel(claimName);

  console.log('💡', normalizedClaimName);

  const url = `${getServerUrl(kc)}/apis/firestartr.dev/v1/namespaces/${namespace}/terraformworkspaces?labelSelector=claim-ref%3D${normalizedClaimName}`;

  opts.headers['Content-Type'] = 'application/json';

  opts.headers['Accept'] = 'application/json';

  const r = await fetch(url, { method: 'get', headers: opts.headers });

  if (!r.ok) {
    const err = new Error(
      `Error on getTFWorkspaceRefs: ${claimName}: ${r.statusText}`,
    );

    throw err;
  }

  const apiObject: any = await r.json();

  const foundApiObjects = apiObject.items.filter(
    (item: any) =>
      item.metadata.annotations['firestartr.dev/claim-ref'] ===
      `TFWorkspaceClaim/${claimName}`,
  );

  if (foundApiObjects.length === 0) return null;

  if (foundApiObjects.length > 1)
    throw new Error(`More than one TFWorkspace found for claim ${claimName}`);

  return foundApiObjects[0];
}

export async function getCRfromClaimRef(
  claimKind: string,

  claimName: string,

  namespace: string,
) {
  try {
    const cr = await getTFWorkspaceRefs(claimKind, claimName, namespace);

    return cr;
  } catch (err: any) {
    if (err.code === 404 || err.statusCode === 404) {
      return null;
    } else {
      console.error(`Error on getTFWorkspaceRefs: ${err}`);

      throw err;
    }
  }
}
