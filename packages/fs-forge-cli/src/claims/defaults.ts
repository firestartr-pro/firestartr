import { posix } from 'path';
import YAML from 'yaml';

import { applyClaimDefaults } from '../defaults/applier.js';
import { ClaimsClient } from './client.js';

const DEFAULTS_FILE_NAME = 'claims_defaults.yaml';
const PRIMARY_DEFAULTS_PATH = `claims/${DEFAULTS_FILE_NAME}`;

/**
 * Raised when the primary defaults path is missing but several files named
 * `claims_defaults.yaml` exist elsewhere in the repo, so the file to use is
 * ambiguous. The Claim defaults composition classifies this condition for
 * strict defaults commands and tolerant automatic defaults use.
 */
export class AmbiguousDefaultsError extends Error {
  readonly candidates: string[];

  constructor(candidates: string[]) {
    super(
      `Multiple ${DEFAULTS_FILE_NAME} files found: ${candidates.join(', ')}; ` +
        'cannot determine which to use',
    );
    this.name = 'AmbiguousDefaultsError';
    this.candidates = candidates;
  }
}

// Per-claims-client in-memory cache: repeated calls within one CLI invocation
// do not re-fetch the defaults file.
const defaultsCache = new WeakMap<
  ClaimsClient,
  Promise<Record<string, unknown> | null>
>();

export async function resolveDefaultsFile(
  client: ClaimsClient,
): Promise<Record<string, unknown> | null> {
  const cached = defaultsCache.get(client);
  if (cached) return cached;

  const pending = fetchDefaultsFile(client);
  defaultsCache.set(client, pending);
  try {
    return await pending;
  } catch (error) {
    defaultsCache.delete(client);
    throw error;
  }
}

async function fetchDefaultsFile(
  client: ClaimsClient,
): Promise<Record<string, unknown> | null> {
  const branch = await client.getDefaultBranch();

  const primary = await client.getRawFile(PRIMARY_DEFAULTS_PATH, branch);
  if (primary !== null) return parseDefaultsYaml(primary);

  const files = await client.listFilesRecursive(branch);
  const matches = files
    .filter((file) => posix.basename(file) === DEFAULTS_FILE_NAME)
    .sort();
  if (matches.length > 1) throw new AmbiguousDefaultsError(matches);
  if (matches.length === 0) return null;

  const content = await client.getRawFile(matches[0], branch);
  return content === null ? null : parseDefaultsYaml(content);
}

function parseDefaultsYaml(content: string): Record<string, unknown> {
  const value: unknown = YAML.parse(content);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${DEFAULTS_FILE_NAME} does not contain a YAML object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Locates, parses, caches, and additively applies repo-level Claim defaults.
 * Strict use preserves every resolution error. Tolerant use skips only an
 * ambiguous fallback location, emits a warning, and returns an unchanged clone.
 */
export type ClaimDefaultsMode = 'strict' | 'tolerant';

export async function applyDefaultsFromRepo(
  client: ClaimsClient,
  claim: Record<string, unknown>,
  mode: ClaimDefaultsMode,
): Promise<Record<string, unknown>> {
  try {
    const defaults = await resolveDefaultsFile(client);
    return applyClaimDefaults(claim, defaults ?? {});
  } catch (error) {
    if (mode === 'strict' || !(error instanceof AmbiguousDefaultsError)) {
      throw error;
    }
    process.stderr.write(`Warning: Skipping defaults: ${error.message}\n`);
    return applyClaimDefaults(claim, {});
  }
}
