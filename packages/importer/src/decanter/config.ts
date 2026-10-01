import * as fs from 'fs';
import common from 'catalog_common';
import { resolveCodeownersRef } from 'cdk8s_renderer';

let claimsPath = '';

export function setClaimsPath(path: string) {
  claimsPath = path;
}

export function getClaimsPath() {
  if (!claimsPath) {
    throw new Error('Claims path not set');
  }

  return claimsPath;
}

/**
 * resources path
 */
let resourcesPath = '';

export function setResourcesPath(path: string) {
  resourcesPath = path;
}

export function getResourcesPath() {
  if (!resourcesPath) {
    throw new Error('Resources path not set');
  }

  return resourcesPath;
}

/**
 * config path
 */
let configPath = '';

export function setConfigPath(path: string) {
  configPath = path;
}

export function getConfigPath() {
  if (!configPath) {
    throw new Error('Config path not set');
  }

  return configPath;
}

/**
 * claimsDefaults path
 */
let claimsDefaultsPath = '';

export function setClaimsDefaultsPath(path: string) {
  claimsDefaultsPath = path;
}

export function getClaimsDefaultsPath() {
  if (!claimsDefaultsPath) {
    throw new Error('Claims defaults path not set');
  }

  return claimsDefaultsPath;
}

/**
 * Cached default owner claim reference from claims_defaults.yaml.
 * Loaded once via loadClaimsDefaultsOnce() to avoid repeated file reads.
 */
let defaultOwnerClaimRef: string | null = null;

/**
 * Resolved default owner CODEOWNERS handles, derived from defaultOwnerClaimRef
 * through the same claim-to-external-name mapping used by CODEOWNERS generation.
 */
let defaultOwnerHandles: { team: string | null; user: string | null } = {
  team: null,
  user: null,
};

/**
 * Loads claims_defaults.yaml once and caches the default owner claim reference.
 * Must be called after setClaimsDefaultsPath() and before any decanter runs.
 */
export function loadClaimsDefaultsOnce(): void {
  try {
    const raw = fs.readFileSync(
      `${getClaimsDefaultsPath()}/claims_defaults.yaml`,
      'utf-8',
    );
    const defaults = common.io.fromYaml(raw) as any;
    defaultOwnerClaimRef = defaults?.ComponentClaim?.owner ?? null;
  } catch {
    defaultOwnerClaimRef = null;
  }
}

/**
 * Returns the cached default owner claim reference (e.g., "group:group_a" or "user:user_a").
 * Returns null if not loaded or not set in claims_defaults.yaml.
 */
export function getDefaultOwnerClaimRef(): string | null {
  return defaultOwnerClaimRef;
}

/**
 * Resolves the default owner claim reference to CODEOWNERS handle(s) using the
 * same claim-to-external-name mapping used by CODEOWNERS generation.
 * Must be called after the referenced claims have been seeded into the renderer
 * (i.e., after setPreviousCRs) so resolveCodeownersRef can resolve them.
 */
export function resolveDefaultOwnerHandles(org: string, crs?: any): void {
  defaultOwnerHandles = { team: null, user: null };
  const claimRef = defaultOwnerClaimRef;
  if (!org || !claimRef || !claimRef.includes(':')) {
    return;
  }
  try {
    const [kind] = claimRef.split(':');
    const handle = resolveCodeownersRef(claimRef, org, crs).toLowerCase();
    if (kind === 'group') {
      defaultOwnerHandles.team = handle;
    } else if (kind === 'user') {
      defaultOwnerHandles.user = handle;
    }
  } catch {
    // referenced claim not resolvable → no default owner escape hatch
  }
}

/**
 * Returns the resolved default owner CODEOWNERS handles, if any.
 */
export function getDefaultOwnerHandles(): {
  team: string | null;
  user: string | null;
} {
  return defaultOwnerHandles;
}

/**
 * Resets the cached default owner claim ref and handles (useful for testing).
 */
export function resetClaimsDefaultsCache(): void {
  defaultOwnerClaimRef = null;
  defaultOwnerHandles = { team: null, user: null };
}

export default {
  setClaimsPath,

  getClaimsPath,

  setResourcesPath,

  getResourcesPath,

  setConfigPath,

  getConfigPath,

  setClaimsDefaultsPath,

  getClaimsDefaultsPath,

  loadClaimsDefaultsOnce,

  getDefaultOwnerClaimRef,

  resolveDefaultOwnerHandles,

  getDefaultOwnerHandles,

  resetClaimsDefaultsCache,
};
