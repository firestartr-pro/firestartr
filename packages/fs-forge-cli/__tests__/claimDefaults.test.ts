import { describe, expect, it, jest } from '@jest/globals';

import { claimsRepo } from '../src/claims/claimsRepo';
import { applyDefaultsFromRepo } from '../src/claims/defaults';

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

describe('applyDefaultsFromRepo', () => {
  it('fails when strict defaults resolution is ambiguous', async () => {
    const claim = { kind: 'ComponentClaim', name: 'svc' };
    const repo = createRepo({
      listBlobPaths: jest.fn(async () => [
        'a/claims_defaults.yaml',
        'b/claims_defaults.yaml',
      ]),
    });

    await expect(applyDefaultsFromRepo(repo, claim, 'strict')).rejects.toThrow(
      'Multiple claims_defaults.yaml files found: a/claims_defaults.yaml, b/claims_defaults.yaml',
    );
  });

  it('warns and returns an unchanged copy for tolerant ambiguity', async () => {
    const claim = { kind: 'ComponentClaim', name: 'svc' };
    const repo = createRepo({
      listBlobPaths: jest.fn(async () => [
        'a/claims_defaults.yaml',
        'b/claims_defaults.yaml',
      ]),
    });
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const result = await applyDefaultsFromRepo(repo, claim, 'tolerant');

    expect(result).toEqual(claim);
    expect(result).not.toBe(claim);
    expect(stderr).toHaveBeenCalledWith(
      'Warning: Skipping defaults: Multiple claims_defaults.yaml files found: ' +
        'a/claims_defaults.yaml, b/claims_defaults.yaml; cannot determine which to use\n',
    );
    stderr.mockRestore();
  });

  it('loads and applies the conventional Defaults file without fallback traversal', async () => {
    const listBlobPaths = jest.fn(async () => [
      'other/claims_defaults.yaml',
    ]);
    const repo = createRepo({
      readFile: jest.fn(async (_ref, path: string) =>
        path === 'claims/claims_defaults.yaml'
          ? file('ComponentClaim:\n  platformOwner: group:default\n')
          : null,
      ),
      listBlobPaths,
    });

    await expect(
      applyDefaultsFromRepo(
        repo,
        { kind: 'ComponentClaim', name: 'svc' },
        'strict',
      ),
    ).resolves.toEqual({
      kind: 'ComponentClaim',
      name: 'svc',
      platformOwner: 'group:default',
    });
    expect(listBlobPaths).not.toHaveBeenCalled();
  });

  it('loads and applies a unique fallback Defaults file', async () => {
    const repo = createRepo({
      readFile: jest.fn(async (_ref, path: string) =>
        path === 'config/claims_defaults.yaml'
          ? file('ComponentClaim:\n  platformOwner: group:default\n')
          : null,
      ),
      listBlobPaths: jest.fn(async () => [
        'claims/components/svc.yaml',
        'config/claims_defaults.yaml',
      ]),
    });

    await expect(
      applyDefaultsFromRepo(
        repo,
        { kind: 'ComponentClaim', name: 'svc' },
        'strict',
      ),
    ).resolves.toEqual({
      kind: 'ComponentClaim',
      name: 'svc',
      platformOwner: 'group:default',
    });
  });

  it('returns an unchanged copy when no Defaults file exists', async () => {
    const claim = { kind: 'ComponentClaim', name: 'svc' };
    const repo = createRepo();

    const result = await applyDefaultsFromRepo(repo, claim, 'strict');

    expect(result).toEqual(claim);
    expect(result).not.toBe(claim);
  });
});
