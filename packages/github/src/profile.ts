// Profile definitions and store for github package (immutable and ambient profiles)

export type GithubProfileType = 'snapshot' | 'ambient';

export interface GithubProfile {
  name: string;
  type: GithubProfileType;
  // For snapshot profiles, immutable config (env snapshot)
  config?: Record<string, string>;
}

const profileStore: Map<string, GithubProfile> = new Map();

/**
 * Create or ensure a GitHub profile.
 * Snapshots store a frozen config; ambient profiles resolve env dynamically.
 * Idempotent: matching is a no-op, conflict throws.
 */
export function createProfile(
  name: string,
  profile: Omit<GithubProfile, 'name'>,
): void {
  if (
    profile.type === 'snapshot' &&
    (!profile.config || Object.keys(profile.config).length === 0)
  ) {
    throw new Error(`Snapshot profile "${name}" requires a non-empty config`);
  }
  const existing = profileStore.get(name);

  // check for idempotency: skip if identical profile
  if (existing) {
    if (
      existing.type === profile.type &&
      (profile.type === 'ambient' ||
        (profile.type === 'snapshot' &&
          JSON.stringify(Object.entries(existing.config ?? {}).sort()) ===
            JSON.stringify(Object.entries(profile.config ?? {}).sort())))
    ) {
      return; // idempotent no-op
    }
    // Conflicting definition
    throw new Error(
      `Conflicting redefinition of profile "${name}". Existing type: ${existing.type}, new type: ${profile.type}`,
    );
  }
  const frozenConfig =
    profile.type === 'snapshot'
      ? Object.freeze({ ...(profile.config ?? {}) })
      : undefined;
  profileStore.set(
    name,
    Object.freeze({
      ...profile,
      name,
      config: frozenConfig,
    }) as GithubProfile,
  );
}

/**
 * Lookup a stored github profile by name.
 */
export function getProfile(name: string): GithubProfile | undefined {
  return profileStore.get(name);
}

/**
 * Internal use: clear all profiles (for testing).
 */
export function _clearProfiles() {
  profileStore.clear();
}
