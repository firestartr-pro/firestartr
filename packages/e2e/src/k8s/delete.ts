import * as k8s from '@kubernetes/client-node';
import { formatK8sError, getStatusCode } from './errors';
import { isCustomResource } from './crd';
import { resolveCrHandle } from './cr-handle';
import { forceDeleteCr } from './force-delete';
import common from 'catalog_common';
import { retryAsync } from '../utils/async-control';
import { CRD_KIND } from './constants';
import {
  assertManifestPath,
  expandManifestList,
  formatResourceLabel,
  readManifestFile,
} from './manifests';
import { createLazyClients } from './lazy-clients';
import {
  assertNamespacedKind,
  type DeleteOptions,
  resolveResourceNamespace,
  type K8sResource,
  type KubeConfigProvider,
} from './types';

const DEFAULT_FORCE_DELETE_TIMEOUT_SECONDS = 300;

type NormalizedDeleteOptions = {
  namespace?: string;
  force: boolean;
  ignoreNotFound: boolean;
  timeoutSeconds: number;
};

const DEFAULT_DELETE_OPTIONS: NormalizedDeleteOptions = {
  force: false,
  ignoreNotFound: true,
  timeoutSeconds: DEFAULT_FORCE_DELETE_TIMEOUT_SECONDS,
};
const UNAUTHORIZED_STATUS_CODE = 401;
const UNAUTHORIZED_RETRY_ATTEMPTS = 2;

function normalizeDeleteOptions(
  options?: DeleteOptions,
): NormalizedDeleteOptions {
  return {
    namespace: options?.namespace ?? DEFAULT_DELETE_OPTIONS.namespace,
    force: options?.force ?? DEFAULT_DELETE_OPTIONS.force,
    ignoreNotFound:
      options?.ignoreNotFound ?? DEFAULT_DELETE_OPTIONS.ignoreNotFound,
    timeoutSeconds:
      options?.timeoutSeconds ?? DEFAULT_DELETE_OPTIONS.timeoutSeconds,
  };
}

function shouldIgnoreDeleteError(
  err: unknown,
  ignoreNotFound: boolean,
): boolean {
  if (!ignoreNotFound) return false;
  const status = getStatusCode(err as Error);
  return status === 404 || status === 410;
}

export function createDeleteFunction(
  getKubeConfig: KubeConfigProvider,
  defaultNamespace: string,
) {
  const clients = createLazyClients(getKubeConfig);

  const callWithUnauthorizedRetry = async <T>(
    operationLabel: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    return retryAsync(operation, {
      attempts: UNAUTHORIZED_RETRY_ATTEMPTS + 1,
      shouldRetry: (err) => {
        const statusCode = getStatusCode(err as Error);
        return statusCode === UNAUTHORIZED_STATUS_CODE;
      },
      onRetry: (_err, attempt) => {
        common.logger.warn(
          `Unauthorized while ${operationLabel}; refreshing Kubernetes client and retrying (${attempt}/${UNAUTHORIZED_RETRY_ATTEMPTS}).`,
        );
        clients.reset();
      },
    });
  };

  async function deleteCustomResource(
    obj: K8sResource,
    options: NormalizedDeleteOptions,
  ): Promise<void> {
    const name = obj.metadata?.name;
    if (!name) return;

    const handle = await resolveCrHandle(
      getKubeConfig,
      obj.apiVersion,
      obj.kind,
    );

    if (!handle.info.namespaced) {
      throw new Error(
        `Cluster-scoped custom resources are not supported: ${obj.kind}/${name}`,
      );
    }

    const namespace = obj.metadata?.namespace;
    if (!namespace) {
      throw new Error(
        `Namespace is required for ${obj.kind}/${name} (apiVersion ${obj.apiVersion})`,
      );
    }

    if (options.force) {
      // Force mode delegates entirely to forceDeleteCr:
      // delete → ignore 404/410 → clear finalizers → re-delete → wait.
      await forceDeleteCr(handle, namespace, name, options.timeoutSeconds);
      return;
    }

    const label = formatResourceLabel(obj.kind, name, obj.metadata?.namespace);

    try {
      await handle.delete(namespace, name);
    } catch (err) {
      if (shouldIgnoreDeleteError(err, options.ignoreNotFound)) {
        common.logger.warn(
          `Skipping missing ${label}: ${formatK8sError(err as Error)}`,
        );
        return;
      }
      throw new Error(
        `Failed to delete ${label}: ${formatK8sError(err as Error)}`,
      );
    }
  }

  async function deleteStandardResource(
    obj: K8sResource,
    options: NormalizedDeleteOptions,
  ): Promise<void> {
    const name = obj.metadata?.name;
    if (!name) return;

    const namespace = obj.metadata?.namespace;

    const deleteObj: k8s.KubernetesObject = {
      apiVersion: obj.apiVersion,
      kind: obj.kind,
      metadata: {
        name,
        namespace,
      },
    };

    const label = formatResourceLabel(obj.kind, name, obj.metadata?.namespace);

    try {
      await callWithUnauthorizedRetry(`deleting ${label}`, async () => {
        await clients.getApi().delete(deleteObj);
      });
    } catch (err) {
      if (shouldIgnoreDeleteError(err, options.ignoreNotFound)) {
        common.logger.warn(
          `Skipping missing ${label}: ${formatK8sError(err as Error)}`,
        );
        return;
      }
      if (!options.force) {
        throw err;
      }
      common.logger.warn(
        `Failed to delete ${label}: ${formatK8sError(err as Error)}`,
      );
    }

    if (!options.force) return;

    // Same two-phase force deletion for built-in resources.
    const patchObj: k8s.KubernetesObject = {
      apiVersion: obj.apiVersion,
      kind: obj.kind,
      metadata: {
        name,
        namespace,
        finalizers: [],
      },
    };

    try {
      await callWithUnauthorizedRetry(
        `removing finalizers for ${label}`,
        async () => {
          await clients
            .getApi()
            .patch(
              patchObj,
              undefined,
              undefined,
              undefined,
              undefined,
              k8s.PatchStrategy.MergePatch,
            );
        },
      );
    } catch (err) {
      if (!shouldIgnoreDeleteError(err, options.ignoreNotFound)) {
        common.logger.warn(
          `Failed to remove finalizers for ${label}: ${formatK8sError(err as Error)}`,
        );
      }
    }

    try {
      await callWithUnauthorizedRetry(`deleting ${label}`, async () => {
        await clients.getApi().delete(deleteObj);
      });
    } catch (err) {
      if (!shouldIgnoreDeleteError(err, options.ignoreNotFound)) {
        common.logger.warn(
          `Failed to delete ${label}: ${formatK8sError(err as Error)}`,
        );
      }
    }
  }

  async function deleteObject(
    obj: K8sResource,
    options: NormalizedDeleteOptions,
  ): Promise<void> {
    if (!obj || typeof obj !== 'object') return;
    if (!obj.apiVersion || !obj.kind) return;

    if (obj.kind === CRD_KIND) {
      const name = obj.metadata?.name ?? 'unknown';
      throw new Error(
        `Deleting ${CRD_KIND}/${name} is not allowed in e2e cleanup.`,
      );
    }

    assertNamespacedKind(obj.kind);

    obj.metadata = obj.metadata ?? {};

    resolveResourceNamespace(obj, options.namespace);

    if (obj.metadata?.name) {
      const label = formatResourceLabel(
        obj.kind,
        obj.metadata.name,
        obj.metadata.namespace,
      );
      common.logger.info(`Deleting ${label}`);
    }

    if (isCustomResource(obj.apiVersion)) {
      await deleteCustomResource(obj, options);
    } else {
      await deleteStandardResource(obj, options);
    }
  }

  return async function del(
    inputPath: string,
    options?: DeleteOptions,
  ): Promise<void> {
    const resolvedOptions = normalizeDeleteOptions(options);
    if (!resolvedOptions.namespace) {
      resolvedOptions.namespace = defaultNamespace;
    }

    assertManifestPath(inputPath);

    const files = common.io.getFileListRecursively(
      inputPath,
      [],
      ['.yaml', '.yml'],
    );

    for (const file of files) {
      const parsed = await readManifestFile(file);
      const objects = expandManifestList(parsed);

      for (const obj of objects) {
        await deleteObject(obj, resolvedOptions);
      }
    }
  };
}
