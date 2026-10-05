import { describe, expect, it, jest } from '@jest/globals';

import {
  AmbiguousDefaultsError,
  claimsRepo,
} from '../src/claims/claimsRepo';
import { resolveDefaultsFile } from '../src/claims/defaults';

import type { ClaimsRepo } from '../src/claims/claimsRepo';
import type { GitHubApi, RepoFile } from '../src/github/api';

function createRepo(overrides: Partial<GitHubApi> = {}): ClaimsRepo {
  const api = {
    getDefaultBranch: jest.fn(async () => 'main'),
    readFile: jest.fn(async () => null),
    listBlobPaths: jest.fn(async () => []),
    ...overrides,
  } as unknown as GitHubApi;
  return claimsRepo(api, 'example-org');
}

const REF = { owner: 'example-org', repo: 'claims' };

function file(content: string): RepoFile {
  return { path: 'path', content, sha: 'sha' };
}

const DEFAULTS_YAML = 'ComponentClaim:\n  platformOwner: group:default\n';

describe('resolveDefaultsFile', () => {
  it('reads the primary claims/claims_defaults.yaml path', async () => {
    const readFile = jest.fn(async (_ref, path: string) =>
      path === 'claims/claims_defaults.yaml' ? file(DEFAULTS_YAML) : null,
    );
    const listBlobPaths = jest.fn(async () => []);
    const repo = createRepo({ readFile, listBlobPaths });

    const defaults = await resolveDefaultsFile(repo);

    expect(defaults).toEqual({
      ComponentClaim: { platformOwner: 'group:default' },
    });
    expect(listBlobPaths).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith(
      REF,
      'claims/claims_defaults.yaml',
      'main',
    );
  });

  it('falls back to a single match found anywhere in the repo tree', async () => {
    const readFile = jest.fn(async (_ref, path: string) =>
      path === 'config/claims_defaults.yaml' ? file(DEFAULTS_YAML) : null,
    );
    const listBlobPaths = jest.fn(async () => [
      'claims/components/a.yaml',
      'config/claims_defaults.yaml',
    ]);
    const repo = createRepo({ readFile, listBlobPaths });

    const defaults = await resolveDefaultsFile(repo);

    expect(defaults).toEqual({
      ComponentClaim: { platformOwner: 'group:default' },
    });
    expect(listBlobPaths).toHaveBeenCalledWith(REF, 'main');
    expect(readFile).toHaveBeenLastCalledWith(
      REF,
      'config/claims_defaults.yaml',
      'main',
    );
  });

  it('fails hard when the fallback search is ambiguous', async () => {
    const listBlobPaths = jest.fn(async () => [
      'a/claims_defaults.yaml',
      'b/claims_defaults.yaml',
    ]);
    const repo = createRepo({ listBlobPaths });

    await expect(resolveDefaultsFile(repo)).rejects.toThrow(
      AmbiguousDefaultsError,
    );
    await expect(resolveDefaultsFile(repo)).rejects.toThrow(
      'Multiple claims_defaults.yaml files found: a/claims_defaults.yaml, b/claims_defaults.yaml',
    );
  });

  it('returns null when no defaults file exists anywhere', async () => {
    const repo = createRepo();

    expect(await resolveDefaultsFile(repo)).toBeNull();
  });

  it('caches per repo so repeated calls do not re-fetch', async () => {
    const readFile = jest.fn(async (_ref, path: string) =>
      path === 'claims/claims_defaults.yaml' ? file(DEFAULTS_YAML) : null,
    );
    const repo = createRepo({ readFile });

    await resolveDefaultsFile(repo);
    await resolveDefaultsFile(repo);

    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('retries after an error instead of caching the failure', async () => {
    const readFile = jest
      .fn<(ref: unknown, path: string) => Promise<RepoFile | null>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(file(DEFAULTS_YAML));
    const repo = createRepo({ readFile });

    await expect(resolveDefaultsFile(repo)).rejects.toThrow('boom');
    await expect(resolveDefaultsFile(repo)).resolves.toEqual({
      ComponentClaim: { platformOwner: 'group:default' },
    });
    expect(readFile).toHaveBeenCalledTimes(2);
  });
});
