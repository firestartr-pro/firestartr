import { sortRenderClaimsByKind } from '../refsSorter/refsSorter';
import { RenderClaims } from './types';

export function sortKinds(orderedKinds: string[], claims: RenderClaims) {
  const result: RenderClaims[] = [];

  for (const kind of orderedKinds) {
    const kindRenderClaims: any = sortRenderClaimsByKind(claims, [kind]);

    result.push(kindRenderClaims);
  }

  return result;
}
