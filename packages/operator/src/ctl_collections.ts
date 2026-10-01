import { getConnection } from './ctl';

import * as k8s from '@kubernetes/client-node';

import log from './logger';

// generator function to traverse elements
// it is async and iterable
export async function* traverseCRCollection<T = any>(
  pluralKind: string,
  namespace: string,
  options: {
    limit?: number;
  } = {},
  apiGroup = 'firestartr.dev',
  apiVersion = 'v1',
): AsyncGenerator<T> {
  const { limit = 300 } = options; // between 250-300

  try {
    let continueToken: string | undefined = undefined;

    const { kc, opts } = await getConnection();

    const k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);

    const apiGroup = 'firestartr.dev';

    const apiVersion = 'v1';

    const apiPaths = `/apis/${apiGroup}/${apiVersion}/namespaces/${namespace}/${pluralKind}`;

    do {
      const res = await k8sApi.listNamespacedCustomObject({
        group: apiGroup,
        version: apiVersion,
        namespace,
        plural: pluralKind,
        _continue: continueToken,
        limit,
      });

      const body = res as any;
      const items: T[] = body.items || [];

      for (const item of items) {
        yield item;
      }

      continueToken = body.metadata?.continue;
    } while (continueToken);
  } catch (err) {
    log.error(`Error traversing ${namespace}/${pluralKind}: ${err}`);
    throw new Error(`Error traversing ${namespace}/${pluralKind}: ${err}`);
  }
}
