import { describe, expect, it, jest } from '@jest/globals';

import {
  claimExists,
} from '../src/claims/claimsMap';
import {
  claimsRepo,
  loadClaimsMap,
  resolveClaim,
} from '../src/claims/claimsRepo';
import {
  assertCreatePath,
  deterministicPath,
} from '../src/claims/deterministicPath';
import { CLAIM_PATH_CAPABILITIES } from '../src/claims/kindRegistry';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { ClaimsRepo } from '../src/claims/claimsRepo';

describe('claim path capabilities', () => {
  it('declares the path capability for every claim kind', () => {
    expect(CLAIM_PATH_CAPABILITIES).toEqual({
      ComponentClaim: {
        directory: 'components',
        requiresExplicitPath: false,
      },
      GroupClaim: { directory: 'groups', requiresExplicitPath: false },
      UserClaim: { directory: 'users', requiresExplicitPath: false },
      SystemClaim: { directory: 'systems', requiresExplicitPath: false },
      DomainClaim: { directory: 'domains', requiresExplicitPath: false },
      OrgWebhookClaim: {
        directory: 'orgWebhook',
        requiresExplicitPath: false,
      },
      OrgSettingsClaim: {
        directory: 'orgSettings',
        requiresExplicitPath: false,
      },
      ArgoDeployClaim: { directory: 'argocd', requiresExplicitPath: false },
      TFWorkspaceClaim: { requiresExplicitPath: true },
      SecretsClaim: { requiresExplicitPath: true },
    });
  });

  it.each([
    'ComponentClaim',
    'GroupClaim',
    'UserClaim',
    'SystemClaim',
    'DomainClaim',
    'OrgWebhookClaim',
    'ArgoDeployClaim',
    'OrgSettingsClaim',
  ])('rejects explicit paths and ignores a missing commit path for %s', (kind) => {
    expect(() => assertCreatePath(kind, true, undefined)).not.toThrow();
    expect(() =>
      assertCreatePath(kind, false, 'claims/example.yaml'),
    ).toThrow(
      '--path is only supported for TFWorkspaceClaim and SecretsClaim',
    );
  });

  it.each(['TFWorkspaceClaim', 'SecretsClaim'])(
    'requires a commit path for %s',
    (kind) => {
      expect(() => assertCreatePath(kind, true, undefined)).toThrow(
        `--path is required when committing a ${kind}`,
      );
      expect(() => assertCreatePath(kind, false, undefined)).not.toThrow();
    },
  );
});

describe('deterministicPath', () => {
  it.each([
    ['ComponentClaim', 'claims/components/example.yaml'],
    ['GroupClaim', 'claims/groups/example.yaml'],
    ['UserClaim', 'claims/users/example.yaml'],
    ['SystemClaim', 'claims/systems/example.yaml'],
    ['DomainClaim', 'claims/domains/example.yaml'],
    ['OrgWebhookClaim', 'claims/orgWebhook/example.yaml'],
    ['ArgoDeployClaim', 'claims/argocd/example.yaml'],
    ['OrgSettingsClaim', 'claims/orgSettings/example.yaml'],
  ])('maps %s to its claims directory', (kind, expected) => {
    expect(deterministicPath(kind, 'example')).toBe(expected);
  });

  it('requires a safe explicit path for TFWorkspaceClaim and SecretsClaim', () => {
    expect(() => deterministicPath('TFWorkspaceClaim', 'workspace')).toThrow(
      'requires --path',
    );
    expect(
      deterministicPath(
        'SecretsClaim',
        'secret',
        'claims/secrets/platform/secret.yaml',
      ),
    ).toBe('claims/secrets/platform/secret.yaml');
    expect(() =>
      deterministicPath(
        'SecretsClaim',
        'secret',
        'claims/../outside/secret.yaml',
      ),
    ).toThrow('normalized claims/ path');
    expect(() => deterministicPath('ComponentClaim', '../escape')).toThrow(
      'Invalid claim name',
    );
  });
});

function repoWith(api: MemoryGitHubApi): ClaimsRepo {
  return claimsRepo(api, 'example-org');
}

describe('claims map', () => {
  it('waits for generation and reads a claim from its mapped path', async () => {
    const api = new MemoryGitHubApi();
    const repo = repoWith(api);
    api.setDefaultBranch(repo.ref, 'main');
    api.setWorkflowRuns(repo.ref, 'generate-claims-map.yaml', 'main', [
      {
        id: 1,
        htmlUrl: 'https://github.com/example-org/claims/actions/runs/1',
        status: 'queued',
        conclusion: null,
        displayTitle: 'generate',
      },
    ]);
    api.setFile(
      repo.ref,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'base' },
        claims: {
          'ComponentClaim-example': {
            filePath: 'nested/components/example.yaml',
          },
        },
      }),
      'map-sha',
    );
    api.setFile(
      repo.ref,
      'claims/nested/components/example.yaml',
      'kind: ComponentClaim\nname: example\n',
      'claim-sha',
    );
    const wait = jest.fn<() => Promise<void>>(async () => {
      api.setWorkflowRuns(repo.ref, 'generate-claims-map.yaml', 'main', []);
    });

    const map = await loadClaimsMap(repo, { wait });
    const claim = await resolveClaim(repo, map, 'ComponentClaim-example');

    expect(claimExists(map, 'ComponentClaim', 'example')).toBe(true);
    expect(claimExists(map, 'ComponentClaim', 'missing')).toBe(false);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(api.calls).toContain(
      'readFile example-org/claims:claims/nested/components/example.yaml@main',
    );
    expect(claim.sha).toBe('claim-sha');
  });

  it('rejects an unknown claim reference', async () => {
    const api = new MemoryGitHubApi();
    const repo = repoWith(api);
    api.setDefaultBranch(repo.ref, 'main');
    const map = {
      headers: { sha: 'base' },
      claims: {
        'ComponentClaim-example': { filePath: 'components/example.yaml' },
      },
    };

    await expect(
      resolveClaim(repo, map, 'ComponentClaim-missing'),
    ).rejects.toThrow('Claim not found: ComponentClaim-missing');
    expect(api.calls).toEqual([]);
  });

  it.each(['.', '..'])('rejects mapped path %s', async (filePath) => {
    const api = new MemoryGitHubApi();
    const repo = repoWith(api);
    const map = {
      headers: { sha: 'base' },
      claims: { 'ComponentClaim-example': { filePath } },
    };

    await expect(
      resolveClaim(repo, map, 'ComponentClaim-example'),
    ).rejects.toThrow(`Invalid claim path in claims map: ${filePath}`);
    expect(api.calls).toEqual([]);
  });

  it('rejects malformed claim entries', async () => {
    const api = new MemoryGitHubApi();
    const repo = repoWith(api);
    api.setDefaultBranch(repo.ref, 'main');
    api.setFile(
      repo.ref,
      'claims-map.json',
      JSON.stringify({
        headers: { sha: 'base' },
        claims: { 'ComponentClaim-example': {} },
      }),
    );

    await expect(loadClaimsMap(repo)).rejects.toThrow(
      'invalid claim entry',
    );
  });

  it('blocks when only the stale marker exists', async () => {
    const api = new MemoryGitHubApi();
    const repo = repoWith(api);
    api.setDefaultBranch(repo.ref, 'main');
    api.setFile(repo.ref, 'claims-map.json.stale', '', 'stale');

    await expect(loadClaimsMap(repo)).rejects.toThrow('claims map is stale');
  });

  it('uses a custom repo name when provided', async () => {
    const api = new MemoryGitHubApi();
    const repo = claimsRepo(api, 'example-org', 'staging-claims');
    api.setDefaultBranch(repo.ref, 'main');

    expect(repo.ref.repo).toBe('staging-claims');
    await expect(api.getDefaultBranch(repo.ref)).resolves.toBe('main');
    expect(api.calls).toContain('getDefaultBranch example-org/staging-claims');
  });

  it('defaults to the claims repo when no repo is given', () => {
    const api = new MemoryGitHubApi();
    expect(claimsRepo(api, 'example-org').ref).toEqual({
      owner: 'example-org',
      repo: 'claims',
    });
  });
});
