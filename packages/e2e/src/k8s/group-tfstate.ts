import common from 'catalog_common';
import {
  CLAIM_KIND_TO_CR_KIND,
  FIRESTARTR_API_VERSION,
} from '../claim-taxonomy';
import { resolveCrHandle } from './cr-handle';

import type { KubeConfigProvider } from './types';

export async function getGroupTfStateKey(
  getKubeConfig: KubeConfigProvider,
  namespace: string | undefined,
  claimName: string,
): Promise<string | undefined> {
  if (!namespace) {
    throw new Error('Namespace is required to look up group tfStateKey');
  }

  const handle = await resolveCrHandle(
    getKubeConfig,
    FIRESTARTR_API_VERSION,
    CLAIM_KIND_TO_CR_KIND['GroupClaim'],
  );

  const claimRef = `GroupClaim/${claimName}`;
  const claimRefAnnotation =
    common.generic.getFirestartrAnnotation('claim-ref');

  const items = await handle.list(namespace);

  const match = items.find(
    (item) => item.metadata?.annotations?.[claimRefAnnotation] === claimRef,
  );

  return (match?.spec as { firestartr?: { tfStateKey?: string } })?.firestartr
    ?.tfStateKey;
}
