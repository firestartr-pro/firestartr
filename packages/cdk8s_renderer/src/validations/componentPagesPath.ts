import { RenderClaims } from '../renderer/types';

/**
 * Intentionally a no-op.
 *
 * Claim-kind-specific constraints such as ComponentClaim
 * providers.github.pages.source.path belong in the ComponentClaim schema
 * or in the claim->CR build/normalization step, not in src/validations.
 *
 * This function is kept to preserve the existing exported API for callers.
 */
export function validateComponentPagesPath(_renderClaims: RenderClaims): void {
  return;
}
