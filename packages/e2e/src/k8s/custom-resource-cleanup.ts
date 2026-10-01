import { isCustomResource } from './crd';
import { resolveCrHandle } from './cr-handle';
import type { CrHandle } from './cr-handle';
import { forceDeleteCr } from './force-delete';
import { getStatusCode } from './errors';
import { waitForResourceDeletion } from './wait';

import type { K8sApiError, K8sResource, KubeConfigProvider } from './types';

type CleanupContext = {
  kubeConfigProvider: KubeConfigProvider;
  namespace?: string;
};

export type DeleteCustomResourcesOptions = {
  forceFinalizers?: boolean;
};

async function deleteCustomResourcesMatching(
  context: CleanupContext,
  kind: string,
  apiVersion: string,
  timeoutSeconds: number,
  options: DeleteCustomResourcesOptions,
  getItems: (handle: CrHandle, namespace: string) => Promise<K8sResource[]>,
): Promise<number> {
  if (!isCustomResource(apiVersion)) {
    throw new Error(
      `deleteCustomResourcesMatching requires a custom resource apiVersion, received: ${apiVersion}`,
    );
  }

  const { namespace, kubeConfigProvider } = context;
  if (!namespace) {
    throw new Error('Namespace is required to delete namespaced resources');
  }

  let handle: CrHandle;
  try {
    handle = await resolveCrHandle(kubeConfigProvider, apiVersion, kind);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('CRD not found')) {
      return 0;
    }
    throw err;
  }
  if (!handle.info.namespaced) {
    throw new Error(
      `Cluster-scoped custom resources are not supported: ${kind}`,
    );
  }

  let items: K8sResource[];
  try {
    items = await getItems(handle, namespace);
  } catch (err) {
    const statusCode = getStatusCode(err as K8sApiError);
    if (statusCode === 404 || statusCode === 410) return 0;
    throw err;
  }

  const forceFinalizers = options.forceFinalizers ?? false;
  let deleted = 0;

  for (const item of items) {
    const name = item.metadata?.name;
    if (!name) continue;

    if (forceFinalizers) {
      await forceDeleteCr(handle, namespace, name, timeoutSeconds);
    } else {
      try {
        await handle.delete(namespace, name);
      } catch (err) {
        const statusCode = getStatusCode(err as K8sApiError);
        if (statusCode !== 404 && statusCode !== 410) {
          throw new Error(
            `Failed to delete ${namespace}/${kind}/${name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      await waitForResourceDeletion(
        kubeConfigProvider,
        namespace,
        { apiVersion, kind, metadata: { namespace, name } },
        timeoutSeconds,
      );
    }

    deleted += 1;
  }

  return deleted;
}

export async function deleteCustomResourcesByLabel(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string | undefined,
  kind: string,
  apiVersion: string,
  labelSelector: string,
  timeoutSeconds: number,
  options: DeleteCustomResourcesOptions = {},
): Promise<number> {
  if (!labelSelector.trim()) return 0;

  return deleteCustomResourcesMatching(
    { kubeConfigProvider, namespace },
    kind,
    apiVersion,
    timeoutSeconds,
    options,
    (handle, ns) => handle.list(ns, labelSelector),
  );
}

export async function deleteCustomResourcesByAnnotation(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string | undefined,
  kind: string,
  apiVersion: string,
  annotationKey: string,
  annotationValues: string[],
  timeoutSeconds: number,
  options: DeleteCustomResourcesOptions = {},
): Promise<number> {
  const normalizedKey = annotationKey.trim();
  if (!normalizedKey) return 0;

  const normalizedValues = annotationValues
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (normalizedValues.length < 1) return 0;

  const allowedValues = new Set(normalizedValues);

  return deleteCustomResourcesMatching(
    { kubeConfigProvider, namespace },
    kind,
    apiVersion,
    timeoutSeconds,
    options,
    async (handle, ns) => {
      const allItems = await handle.list(ns);
      return allItems.filter((item) => {
        const value = item.metadata?.annotations?.[normalizedKey];
        return Boolean(value && allowedValues.has(value));
      });
    },
  );
}
