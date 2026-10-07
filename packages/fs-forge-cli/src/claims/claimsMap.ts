import type { RepoFile } from '../github/api.js';

export interface ClaimsMapEntry {
  filePath: string;
}

export interface ClaimsMap {
  headers: { sha: string };
  claims: Record<string, ClaimsMapEntry>;
}

export interface ResolvedClaim extends RepoFile {
  filePath: string;
}

export function parseClaimsMap(content: string): ClaimsMap {
  const value: unknown = JSON.parse(content);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('headers' in value) ||
    typeof value.headers !== 'object' ||
    value.headers === null ||
    !('sha' in value.headers) ||
    typeof value.headers.sha !== 'string' ||
    !('claims' in value) ||
    typeof value.claims !== 'object' ||
    value.claims === null ||
    Array.isArray(value.claims)
  ) {
    throw new Error('claims-map.json has an invalid shape');
  }

  const claims = value.claims as Record<string, unknown>;
  if (
    Object.values(claims).some(
      (entry) =>
        typeof entry !== 'object' ||
        entry === null ||
        !('filePath' in entry) ||
        typeof entry.filePath !== 'string',
    )
  ) {
    throw new Error('claims-map.json has an invalid claim entry');
  }
  return value as ClaimsMap;
}

export function claimExists(
  map: ClaimsMap,
  kind: string,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(map.claims, `${kind}-${name}`);
}
