import { describe, expect, it, jest } from '@jest/globals';

import { ClaimsClient } from '../src/claims/client';
import {
  AmbiguousDefaultsError,
  resolveDefaultsFile,
} from '../src/claims/defaults';

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    getDefaultBranch: jest.fn(async () => 'main'),
    getRawFile: jest.fn(async () => null),
    listFilesRecursive: jest.fn(async () => []),
    ...overrides,
  } as unknown as ClaimsClient;
}

const DEFAULTS_YAML = 'ComponentClaim:\n  platformOwner: group:default\n';

describe('resolveDefaultsFile', () => {
  it('reads the primary claims/claims_defaults.yaml path', async () => {
    const getRawFile = jest.fn(async (path: string) =>
      path === 'claims/claims_defaults.yaml' ? DEFAULTS_YAML : null,
    );
    const listFilesRecursive = jest.fn(async () => []);
    const client = createClient({ getRawFile, listFilesRecursive });

    const defaults = await resolveDefaultsFile(client);

    expect(defaults).toEqual({
      ComponentClaim: { platformOwner: 'group:default' },
    });
    expect(listFilesRecursive).not.toHaveBeenCalled();
  });

  it('falls back to a single match found anywhere in the repo tree', async () => {
    const getRawFile = jest.fn(async (path: string) =>
      path === 'config/claims_defaults.yaml' ? DEFAULTS_YAML : null,
    );
    const listFilesRecursive = jest.fn(async () => [
      'claims/components/a.yaml',
      'config/claims_defaults.yaml',
    ]);
    const client = createClient({ getRawFile, listFilesRecursive });

    const defaults = await resolveDefaultsFile(client);

    expect(defaults).toEqual({
      ComponentClaim: { platformOwner: 'group:default' },
    });
    expect(getRawFile).toHaveBeenCalledWith(
      'config/claims_defaults.yaml',
      'main',
    );
  });

  it('fails hard when the fallback search is ambiguous', async () => {
    const listFilesRecursive = jest.fn(async () => [
      'a/claims_defaults.yaml',
      'b/claims_defaults.yaml',
    ]);
    const client = createClient({ listFilesRecursive });

    await expect(resolveDefaultsFile(client)).rejects.toThrow(
      AmbiguousDefaultsError,
    );
    await expect(resolveDefaultsFile(client)).rejects.toThrow(
      'Multiple claims_defaults.yaml files found: a/claims_defaults.yaml, b/claims_defaults.yaml',
    );
  });

  it('returns null when no defaults file exists anywhere', async () => {
    const client = createClient();

    expect(await resolveDefaultsFile(client)).toBeNull();
  });

  it('caches per client so repeated calls do not re-fetch', async () => {
    const getRawFile = jest.fn(async (path: string) =>
      path === 'claims/claims_defaults.yaml' ? DEFAULTS_YAML : null,
    );
    const client = createClient({ getRawFile });

    await resolveDefaultsFile(client);
    await resolveDefaultsFile(client);

    expect(getRawFile).toHaveBeenCalledTimes(1);
  });

  it('retries after an error instead of caching the failure', async () => {
    const getRawFile = jest
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(DEFAULTS_YAML);
    const client = createClient({ getRawFile });

    await expect(resolveDefaultsFile(client)).rejects.toThrow('boom');
    await expect(resolveDefaultsFile(client)).resolves.toEqual({
      ComponentClaim: { platformOwner: 'group:default' },
    });
    expect(getRawFile).toHaveBeenCalledTimes(2);
  });
});
