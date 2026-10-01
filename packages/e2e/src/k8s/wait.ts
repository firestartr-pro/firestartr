import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';
import { FIRESTARTR_API_VERSION } from '../claim-taxonomy';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../utils/async-control';
import { isTransientError } from '../utils/transient-errors';
import { formatK8sError, getStatusCode, shouldRetryRead } from './errors';
import { isCustomResource } from './crd';
import { resolveCrHandle } from './cr-handle';
import type { CrHandle } from './cr-handle';
import { createLazyK8sClients } from './lazy-clients';
import { findTFResultsByReference } from './tfresult';
import {
  assertNamespacedKind,
  isClusterScopedKind,
  type K8sApiError,
  type K8sResource,
  type KubeConfigProvider,
  type WaitForOptions,
} from './types';

const MAX_TFRESULT_TAIL_LINES = 30;

function summarizeTfResult(tfResult: {
  spec?: { action?: string; result?: string };
  status?: { exitCode?: number };
}): string {
  const action = tfResult.spec?.action ?? '?';
  const exitCode = tfResult.status?.exitCode;
  const exitStr = typeof exitCode === 'number' ? ` exitCode=${exitCode}` : '';
  const rawResult = tfResult.spec?.result ?? '';
  const tailLines = rawResult
    .split('\n')
    .filter(Boolean)
    .slice(-MAX_TFRESULT_TAIL_LINES);
  const tail =
    tailLines.length > 0
      ? `\n    tail:\n      ${tailLines.join('\n      ')}`
      : '';
  return `action=${action}${exitStr}${tail}`;
}

async function logTfResultsForCr(
  getKubeConfig: KubeConfigProvider,
  namespace: string,
  kind: string,
  name: string,
): Promise<void> {
  try {
    const tfResults = await findTFResultsByReference(
      getKubeConfig,
      namespace,
      kind,
      name,
    );
    if (tfResults.length === 0) {
      console.log(`  [tfresult] no TFResults for ${kind}/${name}`);
      return;
    }
    for (const tr of tfResults) {
      const trName = tr.metadata?.name ?? '?';
      console.log(`  [tfresult] ${trName}: ${summarizeTfResult(tr)}`);
    }
  } catch {
    // best-effort: don't fail the test if TFResult lookup fails
  }
}

function hasDesiredStatus(resource: K8sResource, status: string): boolean {
  const conditions = resource.status?.conditions;
  if (Array.isArray(conditions)) {
    const match = conditions.find(
      (condition) =>
        condition?.type === status && String(condition?.status) === 'True',
    );
    if (match) {
      // When the condition carries observedGeneration, verify that the
      // operator has observed the current generation of the resource.
      // Without this check, waitForCr returns immediately when a CR is
      // already PROVISIONED from a previous reconcile even though the
      // spec was just updated and the operator hasn't re-processed it.
      const generation = resource.metadata?.generation;
      if (
        generation !== null &&
        generation !== undefined &&
        match.observedGeneration !== null &&
        match.observedGeneration !== undefined &&
        match.observedGeneration < generation
      ) {
        return false;
      }
      return true;
    }
  }

  const simpleStatus =
    resource.status?.state ?? resource.status?.phase ?? resource.status?.status;

  return simpleStatus === status;
}

function getTruthyCondition(resource: K8sResource, type: string) {
  const conditions = resource.status?.conditions;
  if (!Array.isArray(conditions)) return undefined;

  return conditions.find(
    (condition) =>
      condition?.type === type && String(condition?.status) === 'True',
  );
}

function formatConditionDetails(
  condition: ReturnType<typeof getTruthyCondition>,
): string {
  if (!condition) return '';

  let details = '';
  if (condition.reason) {
    details += ` reason='${condition.reason}'`;
  }
  if (condition.message) {
    details += ` message='${condition.message}'`;
  }

  return details ? `${details}.` : '';
}

function formatLastObservedStatus(resource: K8sResource): string {
  const simpleStatus =
    resource.status?.state ??
    resource.status?.phase ??
    resource.status?.status ??
    'unknown';

  const trueConditions = (resource.status?.conditions ?? [])
    .filter((condition) => String(condition?.status) === 'True')
    .map((condition) => {
      const reason = condition.reason ? `(${condition.reason})` : '';
      return `${condition.type}=True${reason}`;
    });

  if (!trueConditions.length) {
    return `status=${simpleStatus}`;
  }

  return `status=${simpleStatus} conditions=[${trueConditions.join(', ')}]`;
}

export function createWaitFunction(
  getKubeConfig: KubeConfigProvider,
  defaultNamespace: string,
) {
  const clients = createLazyK8sClients(getKubeConfig);

  return async function waitFor(
    kind: string,
    name: string,
    status: string,
    timeoutMs: number,
    options?: WaitForOptions,
  ): Promise<K8sResource> {
    if (timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive number');
    }

    assertNamespacedKind(kind);

    const pollIntervalMs = options?.pollIntervalMs ?? 5000;
    const namespace = options?.namespace ?? defaultNamespace;
    const apiVersion = options?.apiVersion ?? FIRESTARTR_API_VERSION;
    const isClusterScoped = isClusterScopedKind(kind);
    let lastObservedResource: K8sResource | null = null;

    if (!isClusterScoped && !namespace) {
      throw new Error(`Namespace is required for ${kind}/${name}`);
    }

    let resourceKey = isClusterScoped
      ? `${kind}/${name}`
      : `${namespace}/${kind}/${name}`;

    let handle: CrHandle | null = null;
    if (isCustomResource(apiVersion)) {
      handle = await resolveCrHandle(getKubeConfig, apiVersion, kind);

      if (!handle.info.namespaced) {
        throw new Error(
          `Cluster-scoped custom resources are not supported: ${kind}/${name}`,
        );
      }

      if (!namespace) {
        throw new Error(`Namespace is required for ${kind}/${name}`);
      }

      resourceKey = `${namespace}/${kind}/${name}`;
    }

    return pollUntil(
      async () => {
        try {
          let body: K8sResource;

          if (handle) {
            body = await handle.read(namespace, name);
          } else {
            const readNamespace = isClusterScoped ? undefined : namespace;
            resourceKey = isClusterScoped
              ? `${kind}/${name}`
              : `${namespace}/${kind}/${name}`;

            const readObj = {
              apiVersion,
              kind,
              metadata: {
                name,
                namespace: readNamespace,
              },
            };
            const response = await clients.getApi().read(readObj);
            body = response as K8sResource;
          }

          // Log TFResult state alongside CR status for observability.
          const statusField =
            body.status?.state ??
            body.status?.phase ??
            body.status?.status ??
            'unknown';
          const conditions = (body.status?.conditions ?? [])
            .filter((c) => String(c?.status) === 'True')
            .map((c) => {
              const r = c.reason ? `(${c.reason})` : '';
              return `${c.type}=True${r}`;
            });
          const condStr = conditions.length
            ? ` conditions=[${conditions.join(', ')}]`
            : '';
          console.log(
            `[waitFor] ${resourceKey} status=${statusField}${condStr}`,
          );
          await logTfResultsForCr(getKubeConfig, namespace, kind, name);

          return body;
        } catch (err) {
          const statusCode = getStatusCode(err as Error);
          const errorBody = (err as any)?.body ?? (err as any)?.response?.body;
          const errorMsg = err instanceof Error ? err.message : String(err);
          common.logger.error(
            `K8s API read error for ${resourceKey}: status=${statusCode ?? 'unknown'} message=${errorMsg} body=${errorBody ? JSON.stringify(errorBody) : 'empty'}`,
          );

          if (statusCode === 401) {
            if (!handle) {
              // only reset the outer clients when no handle is active;
              // the handle owns its own lazy client and already retried internally.
              common.logger.warn(
                `Unauthorized while reading ${resourceKey}; refreshing Kubernetes client and retrying.`,
              );
              clients.reset();
            }
            throw err;
          }

          if (shouldRetryRead(err as Error)) {
            throw err;
          }

          throw new Error(
            `Failed to read ${resourceKey}: ${formatK8sError(err as Error)}`,
          );
        }
      },
      {
        timeoutMs,
        intervalMs: pollIntervalMs,
        isDone: (body) => {
          lastObservedResource = body;

          if (status !== 'ERROR') {
            const errorCondition = getTruthyCondition(body, 'ERROR');
            if (errorCondition) {
              throw new Error(
                `Resource ${resourceKey} reported ERROR=True while waiting for status '${status}'.${formatConditionDetails(errorCondition)}`,
              );
            }
          }

          return hasDesiredStatus(body, status);
        },
        shouldRetryError: (err) => {
          const statusCode = getStatusCode(err as Error);
          return statusCode === 401 || shouldRetryRead(err as Error);
        },
        createTimeoutError: () => {
          const lastObserved = lastObservedResource
            ? ` Last observed: ${formatLastObservedStatus(lastObservedResource)}.`
            : '';

          return new Error(
            `Timed out waiting for ${resourceKey} to reach status '${status}' after ${timeoutMs}ms.${lastObserved}`,
          );
        },
      },
    );
  };
}

const DELETE_POLL_INTERVAL_MS = 5000;

async function createResourceReadProbe(
  kubeConfigProvider: KubeConfigProvider,
  fallbackNamespace: string | undefined,
  resource: K8sResource,
): Promise<() => Promise<K8sResource>> {
  const name = resource.metadata?.name;
  if (!name) {
    throw new Error(`Missing metadata.name in ${resource.kind} resource`);
  }

  const namespace = resource.metadata?.namespace ?? fallbackNamespace;
  if (!namespace) {
    throw new Error(`Namespace is required for ${resource.kind}/${name}`);
  }

  if (isCustomResource(resource.apiVersion)) {
    const handle = await resolveCrHandle(
      kubeConfigProvider,
      resource.apiVersion,
      resource.kind,
    );

    if (!handle.info.namespaced) {
      throw new Error(
        `Cluster-scoped custom resources are not supported: ${resource.kind}/${name}`,
      );
    }

    return () => handle.read(namespace, name);
  }

  const api = k8s.KubernetesObjectApi.makeApiClient(kubeConfigProvider());
  const readObject = {
    apiVersion: resource.apiVersion,
    kind: resource.kind,
    metadata: { name, namespace },
  };

  return async () => {
    const response = await api.read(readObject);
    return response as K8sResource;
  };
}

export async function readResource(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string | undefined,
  resource: K8sResource,
): Promise<K8sResource> {
  const probe = await createResourceReadProbe(
    kubeConfigProvider,
    namespace,
    resource,
  );
  return probe();
}

export async function waitForResourceDeletion(
  kubeConfigProvider: KubeConfigProvider,
  namespace: string | undefined,
  resource: K8sResource,
  timeoutSeconds: number,
): Promise<void> {
  const timeoutMs = timeoutSeconds * 1000;
  const kind = resource.kind;
  const name = resource.metadata?.name ?? 'unknown';
  const resolvedNamespace = resource.metadata?.namespace ?? namespace;
  const probe = await createResourceReadProbe(
    kubeConfigProvider,
    namespace,
    resource,
  );

  await pollUntil(
    async () => {
      try {
        await probe();
        return false;
      } catch (err) {
        const statusCode = getStatusCode(err as K8sApiError);
        if (statusCode === 404 || statusCode === 410) {
          return true;
        }

        if (isTransientError(err)) {
          throw createRetryableError(err);
        }

        throw new Error(
          `Failed while waiting for deletion of ${resolvedNamespace}/${kind}/${name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    },
    {
      timeoutMs,
      intervalMs: DELETE_POLL_INTERVAL_MS,
      isDone: (deleted) => deleted,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for ${resolvedNamespace}/${kind}/${name} to be deleted after ${timeoutMs}ms.`,
        ),
    },
  );
}
