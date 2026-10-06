import * as k8s from '@kubernetes/client-node';
import type { KubeConfigProvider } from './types';

type LazyK8sClients = {
  getApi: () => k8s.KubernetesObjectApi;
  getCustomApi: () => k8s.CustomObjectsApi;
  reset: () => void;
};

export function createLazyK8sClients(
  getKubeConfig: KubeConfigProvider,
): LazyK8sClients {
  let k8sApi: k8s.KubernetesObjectApi | null = null;
  let customObjectsApi: k8s.CustomObjectsApi | null = null;

  const getApi = (): k8s.KubernetesObjectApi => {
    if (!k8sApi) {
      k8sApi = k8s.KubernetesObjectApi.makeApiClient(getKubeConfig());
    }
    return k8sApi;
  };

  const getCustomApi = (): k8s.CustomObjectsApi => {
    if (!customObjectsApi) {
      customObjectsApi = getKubeConfig().makeApiClient(k8s.CustomObjectsApi);
    }
    return customObjectsApi;
  };

  const reset = (): void => {
    k8sApi = null;
    customObjectsApi = null;
  };

  return {
    getApi,
    getCustomApi,
    reset,
  };
}
