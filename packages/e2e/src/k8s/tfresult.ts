import { FIRESTARTR_API_VERSION } from '../claim-taxonomy';
import { resolveCrHandle } from './cr-handle';

import type { K8sResource, KubeConfigProvider } from './types';

const TFRESULT_KIND = 'TFResult';

export interface TFResultSpec {
  action: 'init' | 'plan' | 'apply' | 'destroy' | 'synth';
  reference: {
    refKind: string;
    refName: string;
  };
  result: string;
}

export interface TFResult extends K8sResource {
  spec?: TFResultSpec;
  status?: K8sResource['status'] & {
    exitCode?: number;
    lastUpdateTime?: string;
  };
}

export async function listTFResults(
  getKubeConfig: KubeConfigProvider,
  namespace: string | undefined,
): Promise<TFResult[]> {
  if (!namespace) {
    throw new Error('Namespace is required to list TFResults');
  }

  const handle = await resolveCrHandle(
    getKubeConfig,
    FIRESTARTR_API_VERSION,
    TFRESULT_KIND,
  );

  const items = await handle.list(namespace);
  return items as TFResult[];
}

// Find TFResult resources by reference (refKind and refName).
export async function findTFResultsByReference(
  getKubeConfig: KubeConfigProvider,
  namespace: string | undefined,
  refKind: string,
  refName: string,
): Promise<TFResult[]> {
  const allResults = await listTFResults(getKubeConfig, namespace);

  return allResults.filter(
    (result) =>
      result.spec?.reference?.refKind === refKind &&
      result.spec?.reference?.refName === refName,
  );
}
