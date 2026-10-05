export { deriveFlags, deriveVariantGroups } from './utils/deriveFlags.js';
export type { FlagSpec, FlagType, VariantGroup } from './utils/deriveFlags.js';
export { buildClaimFromFlags } from './utils/buildClaim.js';
export { createClaimValidator } from './utils/ajvValidation.js';
export type { ValidationResult } from './utils/ajvValidation.js';
export { claimExists } from './claims/claimsMap.js';
export {
  AmbiguousDefaultsError,
  claimsRepo,
  dispatchUnprovision,
  loadClaimsMap,
  publishClaim,
  resolveClaim,
} from './claims/claimsRepo.js';
export { createGitHubApi } from './github/index.js';
export { pollDispatchedRun } from './claims/workflowRun.js';
export {
  assertCreatePath,
  deterministicPath,
} from './claims/deterministicPath.js';
export { CLAIM_PATH_CAPABILITIES } from './claims/kindRegistry.js';
export type { ClaimPathCapability } from './claims/deterministicPath.js';
export {
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
