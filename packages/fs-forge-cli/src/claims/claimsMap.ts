import { posix } from 'path';

import { ClaimsClient, RepoFile } from './client.js';

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

function parseClaimsMap(content: string): ClaimsMap {
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

export async function loadClaimsMap(
  client: ClaimsClient,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 30,
): Promise<ClaimsMap> {
  for (
    let attempt = 0;
    await client.hasInFlightClaimsMapWorkflow();
    attempt++
  ) {
    if (attempt >= maxAttempts) {
      throw new Error('Timed out waiting for claims-map generation');
    }
    await wait(2000);
  }

  const current = await client.getFile('claims-map.json', 'claims-index');
  if (current) return parseClaimsMap(current.content);

  const stale = await client.getFile('claims-map.json.stale', 'claims-index');
  if (stale) {
    throw new Error(
      'The claims map is stale; wait for generate-claims-map.yaml to recover',
    );
  }
  throw new Error('The claims repo does not have a claims map yet');
}

export function claimExists(
  map: ClaimsMap,
  kind: string,
  name: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(map.claims, `${kind}-${name}`);
}

export async function resolveClaim(
  client: ClaimsClient,
  map: ClaimsMap,
  reference: string,
): Promise<ResolvedClaim> {
  const entry = map.claims[reference];
  if (!entry) throw new Error(`Claim not found: ${reference}`);

  const normalized = posix.normalize(entry.filePath);
  if (
    normalized !== entry.filePath ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid claim path in claims map: ${entry.filePath}`);
  }

  const defaultBranch = await client.getDefaultBranch();
  const file = await client.getFile(`claims/${normalized}`, defaultBranch);
  if (!file) {
    throw new Error(`Claim file is missing: claims/${normalized}`);
  }
  return { ...file, filePath: `claims/${normalized}` };
}
