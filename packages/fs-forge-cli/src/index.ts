export { deriveFlags, deriveVariantGroups } from './utils/deriveFlags.js';
export type { FlagSpec, FlagType, VariantGroup } from './utils/deriveFlags.js';
export { buildClaimFromFlags } from './utils/buildClaim.js';
export { validateClaim, registerValidator } from './utils/ajvValidation.js';
export type { ValidationResult } from './utils/ajvValidation.js';
export { ClaimsClient } from './claims/client.js';
export {
  claimExists,
  loadClaimsMap,
  resolveClaim,
} from './claims/claimsMap.js';
export {
  assertCreatePath,
  CLAIM_PATH_CAPABILITIES,
  deterministicPath,
} from './claims/deterministicPath.js';
export type { ClaimPathCapability } from './claims/deterministicPath.js';
export {
  AmbiguousDefaultsError,
  applyDefaultsFromRepo,
  resolveDefaultsFile,
} from './claims/defaults.js';
export type { ClaimDefaultsMode } from './claims/defaults.js';
export { applyClaimDefaults } from './defaults/applier.js';
export { runClaimMutation } from './mutations/orchestrator.js';
export type {
  ClaimMutationOptions,
  ClaimMutationPresentationOptions,
  ClaimMutationResult,
} from './mutations/orchestrator.js';
