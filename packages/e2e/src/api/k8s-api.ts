import {
  applyInBranchFirestartrCrds,
  applyVersionedFirestartrCrds,
} from '../k8s/crd-lifecycle';
import { CRD_KIND } from '../k8s/constants';
import {
  deleteCustomResourcesByAnnotation as deleteCustomResourcesByAnnotationInternal,
  deleteCustomResourcesByLabel as deleteCustomResourcesByLabelInternal,
} from '../k8s/custom-resource-cleanup';
import { logCrDiagnostics } from '../k8s/diagnostics';
import { getGroupTfStateKey as getGroupTfStateKeyInternal } from '../k8s/group-tfstate';
import { removeAnnotationFromManifestResource } from '../k8s/annotations';
import { getPrimaryManifestResource } from '../k8s/manifests';
import { findTFResultsByReference as findTFResultsByReferenceInternal } from '../k8s/tfresult';
import { waitForResourceDeletion } from '../k8s/wait';
import { E2EState } from './state';

import type { K8sClient, K8sResource } from '../k8s/types';
import type {
  DeleteByAnnotationOptions,
  DeleteByLabelOptions,
  K8sApi,
} from '../types';
import type { TFResult } from '../k8s/tfresult';

import log from '../logger';

const DEFAULT_WAIT_TIMEOUT_SECONDS = 300;
const DEFAULT_WAIT_STATUS = 'PROVISIONED';
const DEFAULT_DELETE_TIMEOUT_SECONDS = 300;

export const E2E_LIFECYCLE = 'E2E_LIFECYCLE';

export function logLifecycle(phase: string, identity: string): void {
  process.stdout.write(`[${E2E_LIFECYCLE}] ${phase} ${identity}\n`);
}

// Internal helper: resolves manifest identity, wraps logLifecycle calls and
// logCrDiagnostics so each K8sApi method reads as two lines.
async function withLifecycle<T>(
  phases: { start: string; end: string; fail: string },
  crPath: string,
  logDiagnostics: (crPath: string, cause: unknown) => Promise<void>,
  fn: (resource: K8sResource) => Promise<T>,
): Promise<T> {
  let identity = crPath;
  try {
    const resource = await getPrimaryManifestResource(crPath);
    identity = `${resource.kind}/${resource.metadata?.name ?? '?'}`;
    logLifecycle(phases.start, identity);
    const result = await fn(resource);
    logLifecycle(phases.end, identity);
    return result;
  } catch (err) {
    logLifecycle(phases.fail, identity);
    await logDiagnostics(crPath, err);
    throw err;
  }
}

export function createK8sApi(state: E2EState, k8sClient: K8sClient): K8sApi {
  log.info(`Creating K8s API with namespace: ${state.namespace}`);

  const applyCrPath = async (crPath: string): Promise<void> => {
    await k8sClient.apply(crPath, state.namespace);
  };

  const logDiagnostics = async (
    crPath: string,
    cause: unknown,
  ): Promise<void> => {
    await logCrDiagnostics(
      state.kubeConfigProvider,
      state.namespace,
      crPath,
      cause,
    );
  };

  return {
    setNamespace(namespace: string): void {
      state.namespace = namespace;
    },

    getNamespace(): string {
      return state.namespace;
    },

    async applyCr(crPath: string): Promise<void> {
      return withLifecycle(
        { start: 'applying', end: 'applied', fail: 'apply-failed' },
        crPath,
        logDiagnostics,
        async () => {
          await applyCrPath(crPath);
        },
      );
    },

    async applyCrds(version: string): Promise<void> {
      await applyVersionedFirestartrCrds({
        getKubeConfig: state.kubeConfigProvider,
        applyCr: applyCrPath,
        version,
      });
    },

    async applyInBranchCrds(): Promise<void> {
      await applyInBranchFirestartrCrds({
        getKubeConfig: state.kubeConfigProvider,
        applyCr: applyCrPath,
      });
    },

    async deleteCustomResourcesByLabel({
      kind,
      apiVersion,
      labelSelector,
      timeout = DEFAULT_DELETE_TIMEOUT_SECONDS,
      forceFinalizers = false,
    }: DeleteByLabelOptions): Promise<number> {
      return deleteCustomResourcesByLabelInternal(
        state.kubeConfigProvider,
        state.namespace,
        kind,
        apiVersion,
        labelSelector,
        timeout,
        { forceFinalizers },
      );
    },

    async deleteCustomResourcesByAnnotation({
      kind,
      apiVersion,
      annotationKey,
      annotationValues,
      timeout = DEFAULT_DELETE_TIMEOUT_SECONDS,
      forceFinalizers = false,
    }: DeleteByAnnotationOptions): Promise<number> {
      return deleteCustomResourcesByAnnotationInternal(
        state.kubeConfigProvider,
        state.namespace,
        kind,
        apiVersion,
        annotationKey,
        annotationValues,
        timeout,
        { forceFinalizers },
      );
    },

    async waitForCr(
      crPath: string,
      timeout = DEFAULT_WAIT_TIMEOUT_SECONDS,
      status = DEFAULT_WAIT_STATUS,
    ): Promise<K8sResource> {
      const timeoutMs = timeout * 1000;
      return withLifecycle(
        {
          start: `waiting:${status}`,
          end: `ready:${status}`,
          fail: `wait-failed:${status}`,
        },
        crPath,
        logDiagnostics,
        async (resource) => {
          const resourceName = resource.metadata?.name;
          if (!resourceName) {
            throw new Error(
              `Missing metadata.name in ${resource.kind} resource`,
            );
          }

          return k8sClient.waitFor(
            resource.kind,
            resourceName,
            status,
            timeoutMs,
            {
              namespace: state.namespace,
              apiVersion: resource.apiVersion,
            },
          );
        },
      );
    },

    async deleteCr(
      crPath: string,
      timeout = DEFAULT_DELETE_TIMEOUT_SECONDS,
    ): Promise<void> {
      return withLifecycle(
        { start: 'deleting', end: 'deleted', fail: 'delete-failed' },
        crPath,
        logDiagnostics,
        async (resource) => {
          if (resource.kind === CRD_KIND) {
            throw new Error(
              `Deleting ${CRD_KIND}/${resource.metadata?.name ?? 'unknown'} is not allowed in e2e cleanup.`,
            );
          }

          await k8sClient.delete(crPath, {
            namespace: state.namespace,
            force: false,
            ignoreNotFound: true,
          });

          await waitForResourceDeletion(
            state.kubeConfigProvider,
            state.namespace,
            resource,
            timeout,
          );
        },
      );
    },

    async removeCrAnnotation(
      crPath: string,
      annotationKey: string,
    ): Promise<void> {
      return withLifecycle(
        {
          start: `removing-annotation:${annotationKey}`,
          end: `removed-annotation:${annotationKey}`,
          fail: `remove-annotation-failed:${annotationKey}`,
        },
        crPath,
        logDiagnostics,
        async () => {
          await removeAnnotationFromManifestResource(
            state.kubeConfigProvider,
            state.namespace,
            crPath,
            annotationKey,
          );
        },
      );
    },

    async getGroupTfStateKey(claimName: string): Promise<string | undefined> {
      return getGroupTfStateKeyInternal(
        state.kubeConfigProvider,
        state.namespace,
        claimName,
      );
    },

    async findTFResultByReference(
      refKind: string,
      refName: string,
    ): Promise<TFResult | undefined> {
      const results = await findTFResultsByReferenceInternal(
        state.kubeConfigProvider,
        state.namespace,
        refKind,
        refName,
      );
      return results[0];
    },
  };
}
