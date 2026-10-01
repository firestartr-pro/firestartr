import { createApplyFunction } from './apply';
import { createDeleteFunction } from './delete';
import { createWaitFunction } from './wait';
import type { K8sClient, KubeConfigProvider } from './types';

/**
 * Create a Kubernetes client with apply and wait capabilities.
 */
export function createK8sClient(
  getKubeConfig: KubeConfigProvider,
  defaultNamespace: string,
): K8sClient {
  return {
    apply: createApplyFunction(getKubeConfig, defaultNamespace),
    delete: createDeleteFunction(getKubeConfig, defaultNamespace),
    waitFor: createWaitFunction(getKubeConfig, defaultNamespace),
  };
}

// Re-export all public APIs
export {
  createKubeConfigProvider,
  loadKubeConfig,
  resolveKubeconfigSource,
} from './config';
export { formatK8sError, getStatusCode, shouldRetryRead } from './errors';
export { isCustomResource, resolveCustomResourceInfo } from './crd';
export { listTFResults, findTFResultsByReference } from './tfresult';
export type {
  CrdInfo,
  K8sApiError,
  K8sListResource,
  K8sResource,
  KubeconfigSource,
  KubeConfigProvider,
} from './types';
export type { TFResult, TFResultSpec } from './tfresult';
