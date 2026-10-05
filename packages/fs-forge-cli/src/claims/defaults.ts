import { applyClaimDefaults } from '../defaults/applier.js';
import { AmbiguousDefaultsError, readDefaultsFile } from './claimsRepo.js';

import type { ClaimsRepo } from './claimsRepo.js';

export { AmbiguousDefaultsError };

// Per-claims-repo in-memory cache: repeated calls within one CLI invocation
// do not re-fetch the defaults file.
const defaultsCache = new WeakMap<
  ClaimsRepo,
  Promise<Record<string, unknown> | null>
>();

export async function resolveDefaultsFile(
  repo: ClaimsRepo,
): Promise<Record<string, unknown> | null> {
  const cached = defaultsCache.get(repo);
  if (cached) return cached;

  const pending = readDefaultsFile(repo);
  defaultsCache.set(repo, pending);
  try {
    return await pending;
  } catch (error) {
    defaultsCache.delete(repo);
    throw error;
  }
}

/**
 * Locates, parses, caches, and additively applies repo-level Claim defaults.
 * Strict use preserves every resolution error. Tolerant use skips only an
 * ambiguous fallback location, emits a warning, and returns an unchanged clone.
 */
export type ClaimDefaultsMode = 'strict' | 'tolerant';

export async function applyDefaultsFromRepo(
  repo: ClaimsRepo,
  claim: Record<string, unknown>,
  mode: ClaimDefaultsMode,
): Promise<Record<string, unknown>> {
  try {
    const defaults = await resolveDefaultsFile(repo);
    return applyClaimDefaults(claim, defaults ?? {});
  } catch (error) {
    if (mode === 'strict' || !(error instanceof AmbiguousDefaultsError)) {
      throw error;
    }
    process.stderr.write(`Warning: Skipping defaults: ${error.message}\n`);
    return applyClaimDefaults(claim, {});
  }
}
