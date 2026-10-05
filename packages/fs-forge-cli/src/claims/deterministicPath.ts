import { posix } from 'path';

import { CLAIM_PATH_CAPABILITIES } from './kindRegistry.js';

import type { ClaimKindName } from './kinds.js';

export type ClaimPathCapability =
  | { readonly requiresExplicitPath: true }
  | { readonly directory: string; readonly requiresExplicitPath: false };

export { CLAIM_PATH_CAPABILITIES };

function pathCapability(kind: string): ClaimPathCapability | undefined {
  return CLAIM_PATH_CAPABILITIES[kind as ClaimKindName];
}

export function assertCreatePath(
  kind: string,
  commit: boolean | undefined,
  explicitPath: string | undefined,
): void {
  const capability = pathCapability(kind);
  if (explicitPath && capability?.requiresExplicitPath === false) {
    throw new Error(
      '--path is only supported for TFWorkspaceClaim and SecretsClaim',
    );
  }
  if (commit === true && capability?.requiresExplicitPath && !explicitPath) {
    throw new Error(`--path is required when committing a ${kind}`);
  }
}

export function deterministicPath(
  kind: string,
  name: string,
  explicitPath?: string,
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid claim name: ${name}`);
  }

  const capability = pathCapability(kind);
  if (capability?.requiresExplicitPath === true) {
    if (!explicitPath) {
      throw new Error(`${kind} requires --path when committing`);
    }
    const normalized = posix.normalize(explicitPath);
    if (
      normalized !== explicitPath ||
      !normalized.startsWith('claims/') ||
      posix.basename(normalized) !== `${name}.yaml`
    ) {
      throw new Error(
        `--path must be a normalized claims/ path ending in ${name}.yaml`,
      );
    }
    return normalized;
  }

  if (explicitPath) {
    throw new Error(
      '--path is only supported for TFWorkspaceClaim and SecretsClaim',
    );
  }

  if (!capability) throw new Error(`Unsupported claim kind: ${kind}`);
  return `claims/${capability.directory}/${name}.yaml`;
}
