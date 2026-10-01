import * as k8s from '@kubernetes/client-node';
import type { CrdInfo } from './types';

const crdCache = new Map<string, CrdInfo>();

function getCrdApi(kubeConfig: () => k8s.KubeConfig): k8s.ApiextensionsV1Api {
  return kubeConfig().makeApiClient(k8s.ApiextensionsV1Api);
}

export function isCustomResource(apiVersion: string): boolean {
  return (
    apiVersion.includes('/') && !apiVersion.startsWith('apiextensions.k8s.io/')
  );
}

export function parseApiVersion(apiVersion: string): {
  group: string;
  version: string;
} {
  const [group, version] = apiVersion.split('/');
  return { group, version };
}

export async function resolveCustomResourceInfo(
  kubeConfig: () => k8s.KubeConfig,
  group: string,
  kind: string,
): Promise<CrdInfo> {
  const cacheKey = `${group}/${kind}`;
  const cached = crdCache.get(cacheKey);
  if (cached) return cached;

  const response = await getCrdApi(kubeConfig).listCustomResourceDefinition({});
  const crd = response.items.find(
    (item) => item.spec.group === group && item.spec.names.kind === kind,
  );

  if (!crd) {
    throw new Error(`CRD not found for ${group}/${kind}`);
  }

  const info: CrdInfo = {
    plural: crd.spec.names.plural,
    namespaced: crd.spec.scope === 'Namespaced',
  };

  crdCache.set(cacheKey, info);
  return info;
}
