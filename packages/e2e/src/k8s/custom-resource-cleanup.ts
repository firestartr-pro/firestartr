import { isCustomResource } from './crd';
import { resolveCrHandle } from './cr-handle';
import type { CrHandle } from './cr-handle';
import { forceDeleteCr } from './force-delete';
import { getStatusCode } from '../errors/status-code';
import { waitForResourceDeletion } from './wait';

import type { K8sApiError, K8sResource, KubeConfigProvider } from './types';

type CleanupContext = {
  kubeConfigProvider: KubeConfigProvider;
  namespace?: string;
};

type MatchedCustomResources = {
  handle: CrHandle;
  items: K8sResource[];
};

export type DeleteCustomResourcesOptions = {
  forceFinalizers?: boolean;
};

function filterByAnnotation(
  items: K8sResource[],
  annotationKey: string,
  annotationValues: string[],
): K8sResource[] {
  const normalizedKey = annotationKey.trim();
  if (!normalizedKey) return [];

  const normalizedValues = annotationValues
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (normalizedValues.length < 1) return [];

  const allowedValues = new Set(normalizedValues);
  return items.filter((item) => {
    const value = item.metadata?.annotations?.[normalizedKey];
    return Boolean(value && allowedValues.has(value));
  });
}

async function listCustomResourcesMatching(
  context: CleanupContext,
  kind: string,
  apiVersion: string,
  getItems: (handle: CrHandle, namespace: string) => Promise<K8sResource[]>,
): Promise<MatchedCustomResources | null> {
  if (!isCustomResource(apiVersion)) {
    throw new Error(
      `Custom resource cleanup requires a custom resource apiVersion, received: ${apiVersion}`,
    );
  }

  const { namespace, kubeConfigProvider } = context;
  if (!namespace) {
    throw new Error('Namespace is required for namespaced resources');
  }

  let handle: CrHandle;
  try {
    handle = await resolveCrHandle(kubeConfigProvider, apiVersion, kind);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('CRD not found')) {
      return null;
    }
    throw err;
  }
  if (!handle.info.namespaced) {
    throw new Error(
      `Cluster-scoped custom resources are not supported: ${kind}`,
    );
  }

  try {
    return { handle, items: await getItems(handle, namespace) };
  } catch (err) {
    const statusCode = getStatusCode(err as K8sApiError);
    if (statusCode === 404 || statusCode === 410) return null;
    throw err;
  }
}

async function deleteCustomResourcesMatching(
  context: CleanupContext,
  kind: string,
  apiVersion: string,
  timeoutSeconds: number,
  options: DeleteCustomResourcesOptions,
  getItems: (handle: CrHandle, namespace: string) => Promise<K8sResource[]>,
): Promise<number> {
  const matched = await listCustomResourcesMatching(
    context,
    kind,
    apiVersion,
    getItems,
  );
  if (matched === null) return 0;

  const { handle, items } = matched;
  const { namespace, kubeConfigProvider } = context;
  const resolvedNamespace = namespace as string;
  const forceFinalizers = options.forceFinalizers ?? false;
  let deleted = 0;

  for (const item of items) {
    const name = item.metadata?.name;
    if (!name) continue;

    if (forceFinalizers) {
      await forceDeleteCr(handle, resolvedNamespace, name, timeoutSeconds);
    } else {
      try {
        await handle.delete(resolvedNamespace, name);
      } catch (err) {
        const statusCode = getStatusCode(err as K8sApiError);
        if (statusCode !== 404 && statusCode !== 410) {
          throw new Error(
            `Failed to delete ${resolvedNamespace}/${kind}/${name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      await waitForResourceDeletion(
        kubeConfigProvider,
        resolvedNamespace,
        { apiVersion, kind, metadata: { namespace: resolvedNamespace, name } },
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
  if (!annotationKey.trim()) return 0;
  if (annotationValues.every((value) => value.trim().length === 0)) return 0;

  return deleteCustomResourcesMatching(
    { kubeConfigProvider, namespace },
    kind,
    apiVersion,
    timeoutSeconds,
    options,
    async (handle, ns) =>
      filterByAnnotation(
        await handle.list(ns),
        annotationKey,
        annotationValues,
      ),
  );
}

/**
 * Lists namespaced custom resources whose annotation value matches one of
 * `annotationValues`. Returns [] when the CRD is not installed or the
 * namespace does not exist; throws when `namespace` is undefined.
 */
export async function listCustomResourcesByAnnotation(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string | undefined,
  kind: string,
  apiVersion: string,
  annotationKey: string,
  annotationValues: string[],
): Promise<K8sResource[]> {
  if (!annotationKey.trim()) return [];
  if (annotationValues.every((value) => value.trim().length === 0)) return [];

  const matched = await listCustomResourcesMatching(
    { kubeConfigProvider, namespace },
    kind,
    apiVersion,
    async (handle, ns) =>
      filterByAnnotation(
        await handle.list(ns),
        annotationKey,
        annotationValues,
      ),
  );

  return matched?.items ?? [];
}
