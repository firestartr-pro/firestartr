import { isCatalogEntity } from '../validations/references';
import { CLAIM_REF_ANNOTATION } from './constants';

const VARIANT_OF_ANNOTATION = 'firestartr.dev/variant-of';

function isVariantCR(cr: any): boolean {
  return cr.metadata?.annotations?.[VARIANT_OF_ANNOTATION] !== undefined;
}

export function getPreviousCRfromClaim(
  claim: any,
  previousCRs: any,
  expectedKind?: string,
) {
  const previousCRsKeys = Object.keys(previousCRs);

  const isVariantClaim = !!claim._parentClaimName;

  for (const previousCRKey of previousCRsKeys) {
    const previousCR = previousCRs[previousCRKey];

    if (isCatalogEntity(previousCR)) continue;

    if (isExcludedFromPreviousCR(previousCR.kind)) continue;

    if (expectedKind && previousCR.kind !== expectedKind) continue;

    const crVariant = isVariantCR(previousCR);

    if (isVariantClaim && !crVariant) continue;

    if (!isVariantClaim && crVariant) continue;

    const crClaimRef = previousCR.metadata.annotations[CLAIM_REF_ANNOTATION];

    if (crClaimRef === `${claim.kind}/${claim.name}`) {
      return previousCR;
    }

    // For variant claims, the claim-ref annotation uses the parent claim name
    // (via _parentClaimName), but claim.name is the composed name.
    // Match on parent claim-ref plus composed provider name as CR name prefix.
    if (
      isVariantClaim &&
      crClaimRef === `${claim.kind}/${claim._parentClaimName}`
    ) {
      for (const provider of Object.keys(claim.providers || {})) {
        const providerName = claim.providers[provider]?.name;
        if (
          providerName &&
          previousCR.metadata.name.startsWith(providerName + '-')
        ) {
          return previousCR;
        }
      }
    }
  }

  return false;
}

function isExcludedFromPreviousCR(crKind: string) {
  return ['FirestartrGithubRepositoryFeature'].includes(crKind);
}
