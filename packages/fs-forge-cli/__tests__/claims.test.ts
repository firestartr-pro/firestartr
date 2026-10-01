import { describe, expect, it, jest } from '@jest/globals';

import { ClaimsClient } from '../src/claims/client';
import {
  claimExists,
  loadClaimsMap,
  resolveClaim,
} from '../src/claims/claimsMap';
import {
  assertCreatePath,
  CLAIM_PATH_CAPABILITIES,
  deterministicPath,
} from '../src/claims/deterministicPath';

import type { Octokit } from '@octokit/rest';

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

describe('claims map', () => {
  it('waits for generation and reads a claim from its mapped path', async () => {
    const hasInFlightClaimsMapWorkflow = jest
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);
    const getFile = jest.fn<(path: string, ref: string) => Promise<{
      content: string;
      path: string;
      sha: string;
    } | null>>(async (path) => {
      if (path === 'claims-map.json') {
        return {
          content: JSON.stringify({
            headers: { sha: 'base' },
            claims: {
              'ComponentClaim-example': {
                filePath: 'nested/components/example.yaml',
              },
            },
          }),
          path,
          sha: 'map-sha',
        };
      }
      return { content: 'kind: ComponentClaim\nname: example\n', path, sha: 'claim-sha' };
    });
    const client = {
      hasInFlightClaimsMapWorkflow,
      getFile,
      getDefaultBranch: jest.fn(async () => 'main'),
    } as unknown as ClaimsClient;
    const wait = jest.fn<() => Promise<void>>(async () => {});

    const map = await loadClaimsMap(client, wait);
    const claim = await resolveClaim(client, map, 'ComponentClaim-example');

    expect(claimExists(map, 'ComponentClaim', 'example')).toBe(true);
    expect(claimExists(map, 'ComponentClaim', 'missing')).toBe(false);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(getFile).toHaveBeenLastCalledWith(
      'claims/nested/components/example.yaml',
      'main',
    );
    expect(claim.sha).toBe('claim-sha');
  });

  it('rejects an unknown claim reference', async () => {
    const client = {
      getDefaultBranch: jest.fn(async () => 'main'),
    } as unknown as ClaimsClient;
    const map = {
      headers: { sha: 'base' },
      claims: {
        'ComponentClaim-example': { filePath: 'components/example.yaml' },
      },
    };

    await expect(
      resolveClaim(client, map, 'ComponentClaim-missing'),
    ).rejects.toThrow('Claim not found: ComponentClaim-missing');
    expect(client.getDefaultBranch).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])('rejects mapped path %s', async (filePath) => {
    const client = {
      getDefaultBranch: jest.fn(async () => 'main'),
    } as unknown as ClaimsClient;
    const map = {
      headers: { sha: 'base' },
      claims: { 'ComponentClaim-example': { filePath } },
    };

    await expect(
      resolveClaim(client, map, 'ComponentClaim-example'),
    ).rejects.toThrow(`Invalid claim path in claims map: ${filePath}`);
    expect(client.getDefaultBranch).not.toHaveBeenCalled();
  });

  it('rejects malformed claim entries', async () => {
    const client = {
      hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
      getFile: jest.fn(async () => ({
        content: JSON.stringify({
          headers: { sha: 'base' },
          claims: { 'ComponentClaim-example': {} },
        }),
        path: 'claims-map.json',
        sha: 'map-sha',
      })),
    } as unknown as ClaimsClient;

    await expect(loadClaimsMap(client)).rejects.toThrow(
      'invalid claim entry',
    );
  });

  it('blocks when only the stale marker exists', async () => {
    const client = {
      hasInFlightClaimsMapWorkflow: jest.fn(async () => false),
      getFile: jest.fn(async (path: string) =>
        path.endsWith('.stale')
          ? { content: '', path, sha: 'stale' }
          : null,
      ),
    } as unknown as ClaimsClient;

    await expect(loadClaimsMap(client)).rejects.toThrow('claims map is stale');
  });
});

describe('ClaimsClient', () => {
  it.each([
    [undefined, 'HEAD'],
    ['feature', 'feature'],
  ])('downloads one claims archive request for ref %s', async (ref, expected) => {
    const downloadTarballArchive = jest.fn(async () => ({
      data: Uint8Array.from([1, 2, 3]).buffer,
    }));
    const octokit = {
      rest: { repos: { downloadTarballArchive } },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    await expect(client.downloadTarball(ref)).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(downloadTarballArchive).toHaveBeenCalledTimes(1);
    expect(downloadTarballArchive).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'claims',
      ref: expected,
    });
  });

  it('reports an existing publish branch clearly', async () => {
    const createRef = jest.fn(async () => {
      throw Object.assign(new Error('Reference already exists'), { status: 422 });
    });
    const octokit = {
      rest: {
        repos: {
          get: jest.fn(async () => ({ data: { default_branch: 'main' } })),
        },
        git: {
          getRef: jest.fn(async () => ({
            data: { object: { sha: 'base-sha' } },
          })),
          createRef,
        },
      },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    await expect(
      client.publishClaim(
        'ComponentClaim',
        'example',
        'claims/components/example.yaml',
        'kind: ComponentClaim\nname: example\n',
      ),
    ).rejects.toThrow(
      'Branch already exists: fs-forge/ComponentClaim-example. Delete it before publishing again.',
    );
  });

  it('creates a branch, commits the claim, and dispatches provisioning', async () => {
    const get = jest.fn(async () => ({ data: { default_branch: 'main' } }));
    const getRef = jest.fn(async () => ({ data: { object: { sha: 'base-sha' } } }));
    const createRef = jest.fn(async () => ({ data: {} }));
    const createOrUpdateFileContents = jest.fn(async () => ({ data: {} }));
    const createWorkflowDispatch = jest.fn(async () => ({ data: {} }));
    const octokit = {
      rest: {
        repos: { get, createOrUpdateFileContents },
        git: { getRef, createRef },
        actions: { createWorkflowDispatch },
      },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    await client.publishClaim(
      'ComponentClaim',
      'example',
      'claims/components/example.yaml',
      'kind: ComponentClaim\nname: example\n',
      'file-sha',
    );

    expect(createRef).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'claims',
      ref: 'refs/heads/fs-forge/ComponentClaim-example',
      sha: 'base-sha',
    });
    expect(createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'claims/components/example.yaml',
        branch: 'fs-forge/ComponentClaim-example',
        sha: 'file-sha',
      }),
    );
    expect(createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: 'provision-claim.yaml',
        ref: 'fs-forge/ComponentClaim-example',
        inputs: {
          claimType: 'ComponentClaim',
          claimName: 'example',
          correlationId: expect.any(String),
          skipHydration: false,
        },
      }),
    );
  });

  it.each(['SystemClaim', 'DomainClaim'])(
    'passes skipHydration=true for catalog-only kind %s',
    async (kind) => {
      const get = jest.fn(async () => ({ data: { default_branch: 'main' } }));
      const getRef = jest.fn(async () => ({ data: { object: { sha: 'base-sha' } } }));
      const createRef = jest.fn(async () => ({ data: {} }));
      const createOrUpdateFileContents = jest.fn(async () => ({ data: {} }));
      const createWorkflowDispatch = jest.fn(async () => ({ data: {} }));
      const octokit = {
        rest: {
          repos: { get, createOrUpdateFileContents },
          git: { getRef, createRef },
          actions: { createWorkflowDispatch },
        },
      } as unknown as Octokit;
      const client = new ClaimsClient('example-org', octokit);

      await client.publishClaim(
        kind,
        'example',
        `claims/${kind === 'SystemClaim' ? 'systems' : 'domains'}/example.yaml`,
        `kind: ${kind}\nname: example\n`,
      );

      expect(createWorkflowDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: {
            claimType: kind,
            claimName: 'example',
            correlationId: expect.any(String),
            skipHydration: true,
          },
        }),
      );
    },
  );

  it('defaults to the claims repo when no repo is given', () => {
    const octokit = {} as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    expect(client.repo).toBe('claims');
  });

  it('uses a custom repo name when provided', async () => {
    const get = jest.fn(async () => ({ data: { default_branch: 'main' } }));
    const octokit = {
      rest: { repos: { get } },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit, 'staging-claims');

    expect(client.repo).toBe('staging-claims');
    await client.getDefaultBranch();
    expect(get).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'staging-claims',
    });
  });

  it('fetches a raw file by path and base64-decodes it', async () => {
    const getContent = jest.fn(async () => ({
      data: {
        type: 'file',
        path: 'claims/claims_defaults.yaml',
        sha: 'file-sha',
        content: Buffer.from('ComponentClaim:\n  a: 1\n').toString('base64'),
      },
    }));
    const octokit = {
      rest: { repos: { getContent } },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    const content = await client.getRawFile(
      'claims/claims_defaults.yaml',
      'main',
    );

    expect(content).toBe('ComponentClaim:\n  a: 1\n');
    expect(getContent).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'claims',
      path: 'claims/claims_defaults.yaml',
      ref: 'main',
    });
  });

  it('returns null when the raw file does not exist', async () => {
    const getContent = jest.fn(async () => {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    const octokit = {
      rest: { repos: { getContent } },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    expect(
      await client.getRawFile('claims/claims_defaults.yaml', 'main'),
    ).toBeNull();
  });

  it('dispatches unprovision-claim with default options', async () => {
    const createWorkflowDispatch = jest.fn(async () => ({ data: {} }));
    const octokit = {
      rest: {
        repos: { get: jest.fn(async () => ({ data: { default_branch: 'main' } })) },
        actions: { createWorkflowDispatch },
      },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    await client.dispatchUnprovision('ComponentClaim', 'my-svc');

    expect(createWorkflowDispatch).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'claims',
      workflow_id: 'unprovision-claim.yaml',
      ref: 'main',
      inputs: {
        claimType: 'ComponentClaim',
        claimName: 'my-svc',
        correlationId: expect.any(String),
        includeVariants: true,
        waitForClaimChecks: false,
      },
    });
  });

  it('dispatches unprovision-claim with explicit options', async () => {
    const createWorkflowDispatch = jest.fn(async () => ({ data: {} }));
    const octokit = {
      rest: {
        repos: { get: jest.fn(async () => ({ data: { default_branch: 'develop' } })) },
        actions: { createWorkflowDispatch },
      },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    await client.dispatchUnprovision('TFWorkspaceClaim', 'my-tf', {
      includeVariants: false,
      waitForClaimChecks: true,
    });

    expect(createWorkflowDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'develop',
        inputs: {
          claimType: 'TFWorkspaceClaim',
          claimName: 'my-tf',
          correlationId: expect.any(String),
          includeVariants: false,
          waitForClaimChecks: true,
        },
      }),
    );
  });

  it('lists blob paths from a recursive tree listing', async () => {
    const getTree = jest.fn(async () => ({
      data: {
        tree: [
          { type: 'tree', path: 'claims' },
          { type: 'blob', path: 'claims/components/a.yaml' },
          { type: 'blob', path: 'claims/claims_defaults.yaml' },
        ],
      },
    }));
    const octokit = {
      rest: { git: { getTree } },
    } as unknown as Octokit;
    const client = new ClaimsClient('example-org', octokit);

    const files = await client.listFilesRecursive('main');

    expect(files).toEqual([
      'claims/components/a.yaml',
      'claims/claims_defaults.yaml',
    ]);
    expect(getTree).toHaveBeenCalledWith({
      owner: 'example-org',
      repo: 'claims',
      tree_sha: 'main',
      recursive: '1',
    });
  });

  describe('waitForWorkflow', () => {
    const mockGet = jest.fn(async () => ({ data: { default_branch: 'main' } }));

    function createPollClient(mock: jest.Mock) {
      const octokit = {
        rest: {
          actions: { listWorkflowRuns: mock },
          repos: { get: mockGet },
        },
      } as unknown as Octokit;
      return new ClaimsClient('example-org', octokit);
    }

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns success when workflow completes with conclusion success', async () => {
      const listWorkflowRuns = jest.fn(async () => ({
        data: {
          workflow_runs: [
            {
              id: 42,
              display_title: 'corr-1',
              status: 'completed',
              html_url: 'https://example.test/run/42',
              conclusion: 'success',
            },
          ],
        },
      }));
      const client = createPollClient(listWorkflowRuns);

      const result = await client.waitForWorkflow(
        'corr-1',
        'provision-claim.yaml',
        'ComponentClaim',
        'api',
        'fs-forge/ComponentClaim-api',
      );

      expect(result).toEqual({
        runUrl: 'https://example.test/run/42',
        runId: 42,
        conclusion: 'success',
      });
    });

    it('returns failure when conclusion is failure', async () => {
      const listWorkflowRuns = jest.fn(async () => ({
        data: {
          workflow_runs: [
            {
              id: 42,
              display_title: 'corr-1',
              status: 'completed',
              html_url: 'https://example.test/run/42',
              conclusion: 'failure',
            },
          ],
        },
      }));
      const client = createPollClient(listWorkflowRuns);

      const result = await client.waitForWorkflow(
        'corr-1',
        'provision-claim.yaml',
        'ComponentClaim',
        'api',
        'fs-forge/ComponentClaim-api',
      );

      expect(result).toEqual({
        runUrl: 'https://example.test/run/42',
        runId: 42,
        conclusion: 'failure',
      });
    });

    it('returns cancelled when conclusion is cancelled', async () => {
      const listWorkflowRuns = jest.fn(async () => ({
        data: {
          workflow_runs: [
            {
              id: 42,
              display_title: 'corr-1',
              status: 'completed',
              html_url: 'https://example.test/run/42',
              conclusion: 'cancelled',
            },
          ],
        },
      }));
      const client = createPollClient(listWorkflowRuns);

      const result = await client.waitForWorkflow(
        'corr-1',
        'provision-claim.yaml',
        'ComponentClaim',
        'api',
        'fs-forge/ComponentClaim-api',
      );

      expect(result).toEqual({
        runUrl: 'https://example.test/run/42',
        runId: 42,
        conclusion: 'cancelled',
      });
    });

    it('throws when workflow run not found after grace period', async () => {
      const listWorkflowRuns = jest.fn(async () => ({
        data: { workflow_runs: [] },
      }));
      const client = createPollClient(listWorkflowRuns);

      const promise = client.waitForWorkflow(
        'corr-1',
        'provision-claim.yaml',
        'ComponentClaim',
        'api',
        'fs-forge/ComponentClaim-api',
      );

      promise.catch(() => {});

      await jest.advanceTimersByTimeAsync(35000);

      await expect(promise).rejects.toThrow('Workflow run not found');
    });

    it('throws when workflow times out', async () => {
      const listWorkflowRuns = jest.fn(async () => ({
        data: {
          workflow_runs: [
            {
              id: 42,
              display_title: 'corr-1',
              status: 'in_progress',
              html_url: 'https://example.test/run/42',
              conclusion: null,
            },
          ],
        },
      }));
      const client = createPollClient(listWorkflowRuns);

      const promise = client.waitForWorkflow(
        'corr-1',
        'provision-claim.yaml',
        'ComponentClaim',
        'api',
        'fs-forge/ComponentClaim-api',
        'Provisioning',
        3000,
      );

      promise.catch(() => {});

      await jest.advanceTimersByTimeAsync(5000);

      await expect(promise).rejects.toThrow('Workflow timed out');
    });
  });
});
