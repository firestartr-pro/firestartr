import common from 'catalog_common';

import { retryAsync } from '../utils/async-control';
import {
  CLEAR_FINALIZERS_PATCH,
  JSON_PATCH_HEADERS,
  MERGE_PATCH_HEADERS,
} from './constants';
import { parseApiVersion, resolveCustomResourceInfo } from './crd';
import { getStatusCode } from './errors';
import { createLazyK8sClients } from './lazy-clients';

import type {
  CrdInfo,
  K8sListResource,
  K8sResource,
  KubeConfigProvider,
} from './types';

const UNAUTHORIZED_STATUS_CODE = 401;
const UNAUTHORIZED_RETRY_ATTEMPTS = 2;

// A resolved handle for one (apiVersion, kind) pair.
// Hides all CustomObjectsApi 9-arg calls, lazy-client caching, and
// namespaced/cluster-scoped routing from callers.
export interface CrHandle {
  // CRD metadata resolved at construction time.
  readonly info: CrdInfo;

  // The full apiVersion string this handle was built from.
  readonly apiVersion: string;

  // The kind this handle was built from.
  readonly kind: string;

  // The kubeconfig provider used to create this handle.
  readonly provider: KubeConfigProvider;

  // Read a single resource by name.
  read(namespace: string | undefined, name: string): Promise<K8sResource>;

  // List resources, optionally filtered by labelSelector.
  // cluster-scoped list ignores labelSelector — no current caller needs it.
  list(
    namespace: string | undefined,
    labelSelector?: string,
  ): Promise<K8sResource[]>;

  // Delete a resource by name.
  delete(namespace: string | undefined, name: string): Promise<void>;

  // Apply a merge-patch to a resource.
  patch(
    namespace: string | undefined,
    name: string,
    body: object,
  ): Promise<void>;

  // Clear all finalizers on a resource (shorthand for patch with CLEAR_FINALIZERS_PATCH).
  clearFinalizers(namespace: string | undefined, name: string): Promise<void>;
}

// Resolve a CR handle for the given provider + apiVersion + kind.
// Caches CRD metadata via crd.ts and owns one lazy-client instance with
// 401-unauthorized refresh/retry.
export async function resolveCrHandle(
  provider: KubeConfigProvider,
  apiVersion: string,
  kind: string,
): Promise<CrHandle> {
  const { group, version } = parseApiVersion(apiVersion);
  const info: CrdInfo = await resolveCustomResourceInfo(provider, group, kind);
  const clients = createLazyK8sClients(provider);

  const withRetry = <T>(label: string, op: () => Promise<T>): Promise<T> =>
    retryAsync(op, {
      attempts: UNAUTHORIZED_RETRY_ATTEMPTS + 1,
      shouldRetry: (err) =>
        getStatusCode(err as Error) === UNAUTHORIZED_STATUS_CODE,
      onRetry: (_err, attempt) => {
        common.logger.warn(
          `Unauthorized while ${label}; refreshing Kubernetes client and retrying (${attempt}/${UNAUTHORIZED_RETRY_ATTEMPTS}).`,
        );
        clients.reset();
      },
    });

  const api = () => clients.getCustomApi();

  const handle: CrHandle = {
    info,
    apiVersion,
    kind,
    provider,

    async read(namespace, name) {
      if (info.namespaced) {
        if (!namespace) {
          throw new Error(`Namespace is required for ${kind}/${name}`);
        }
        try {
          const response = await withRetry(`reading ${kind}/${name}`, () =>
            api().getNamespacedCustomObject({
              group,
              version,
              namespace,
              plural: info.plural,
              name,
            }),
          );
          return response as K8sResource;
        } catch (err) {
          const errBody = (err as any)?.body ?? (err as any)?.response?.body;
          common.logger.error(
            `K8s API read error via CrHandle for ${namespace}/${kind}/${name}: status=${(err as any)?.statusCode ?? 'unknown'} message=${err instanceof Error ? err.message : String(err)} body=${errBody ? JSON.stringify(errBody) : 'empty'}`,
          );
          throw err;
        }
      }
      try {
        const response = await withRetry(`reading ${kind}/${name}`, () =>
          api().getClusterCustomObject({
            group,
            version,
            plural: info.plural,
            name,
          }),
        );
        return response as K8sResource;
      } catch (err) {
        common.logger.error(
          `K8s API read error via CrHandle for ${kind}/${name}: status=${(err as any)?.statusCode ?? 'unknown'} message=${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    },

    async list(namespace, labelSelector) {
      if (info.namespaced) {
        if (!namespace) {
          throw new Error(`Namespace is required to list ${kind}`);
        }
        const response = (await withRetry(`listing ${kind}`, () =>
          labelSelector
            ? api().listNamespacedCustomObject({
                group,
                version,
                namespace,
                plural: info.plural,
                labelSelector,
              })
            : api().listNamespacedCustomObject({
                group,
                version,
                namespace,
                plural: info.plural,
              }),
        )) as K8sListResource;
        return Array.isArray(response?.items) ? response.items : [];
      }
      const response = (await withRetry(`listing ${kind}`, () =>
        api().listClusterCustomObject({ group, version, plural: info.plural }),
      )) as K8sListResource;
      return Array.isArray(response?.items) ? response.items : [];
    },

    async delete(namespace, name) {
      if (info.namespaced) {
        if (!namespace) {
          throw new Error(`Namespace is required for ${kind}/${name}`);
        }
        await withRetry(`deleting ${kind}/${name}`, () =>
          api().deleteNamespacedCustomObject({
            group,
            version,
            namespace,
            plural: info.plural,
            name,
          }),
        );
        return;
      }
      await withRetry(`deleting ${kind}/${name}`, () =>
        api().deleteClusterCustomObject({
          group,
          version,
          plural: info.plural,
          name,
        }),
      );
    },

    async patch(namespace, name, body: object) {
      if (info.namespaced) {
        if (!namespace) {
          throw new Error(`Namespace is required for ${kind}/${name}`);
        }
        await withRetry(`patching ${kind}/${name}`, () =>
          api().patchNamespacedCustomObject(
            {
              group,
              version,
              namespace,
              plural: info.plural,
              name,
              body,
            },
            MERGE_PATCH_HEADERS,
          ),
        );
        return;
      }
      await withRetry(`patching ${kind}/${name}`, () =>
        api().patchClusterCustomObject(
          {
            group,
            version,
            plural: info.plural,
            name,
            body,
          },
          MERGE_PATCH_HEADERS,
        ),
      );
    },

    clearFinalizers(namespace, name) {
      if (info.namespaced) {
        if (!namespace) {
          throw new Error(`Namespace is required for ${kind}/${name}`);
        }
        return withRetry(`clearing finalizers for ${kind}/${name}`, () =>
          api().patchNamespacedCustomObject(
            {
              group,
              version,
              namespace,
              plural: info.plural,
              name,
              body: [CLEAR_FINALIZERS_PATCH],
            },
            JSON_PATCH_HEADERS,
          ),
        ).then(() => undefined);
      }

      return withRetry(`clearing finalizers for ${kind}/${name}`, () =>
        api().patchClusterCustomObject(
          {
            group,
            version,
            plural: info.plural,
            name,
            body: [CLEAR_FINALIZERS_PATCH],
          },
          JSON_PATCH_HEADERS,
        ),
      ).then(() => undefined);
    },
  };

  return handle;
}
