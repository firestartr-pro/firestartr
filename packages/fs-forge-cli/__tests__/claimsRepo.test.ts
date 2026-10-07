import { describe, expect, it, jest } from '@jest/globals';

import {
  claimsRepo,
  dispatchUnprovision,
  loadClaimsMap,
  publishClaim,
} from '../src/claims/claimsRepo';
import { createOctokitApi } from '../src/github/octokitApi';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { Octokit } from '@octokit/rest';

class ExistingBranchApi extends MemoryGitHubApi {
  override async createBranch(): Promise<void> {
    throw Object.assign(new Error('Reference already exists'), {
      status: 422,
    });
  }
}

function repo(api: MemoryGitHubApi) {
  const claims = claimsRepo(api, 'example-org');
  api.setDefaultBranch(claims.ref, 'main');
  api.setBranchHeadSha(claims.ref, 'main', 'base-sha');
  return claims;
}

describe('publishClaim', () => {
  it('creates a branch, commits the claim and dispatches provisioning', async () => {
    const api = new MemoryGitHubApi();
    const claims = repo(api);

    const dispatch = await publishClaim(claims, {
      kind: 'ComponentClaim',
      name: 'example',
      path: 'claims/components/example.yaml',
      yaml: 'kind: ComponentClaim\nname: example\n',
      existingSha: 'file-sha',
    });

    expect(dispatch).toEqual({
      url: 'https://github.com/example-org/claims/actions/workflows/provision-claim.yaml',
      correlationId: expect.any(String),
      workflowId: 'provision-claim.yaml',
      branch: 'fs-forge/ComponentClaim-example',
    });
    expect(api.calls).toContain(
      'createBranch example-org/claims@fs-forge/ComponentClaim-example:base-sha',
    );
    expect(api.committed[0]).toEqual({
      ref: claims.ref,
      path: 'claims/components/example.yaml',
      branch: 'fs-forge/ComponentClaim-example',
      message: 'ComponentClaim-example: update claim',
      content: 'kind: ComponentClaim\nname: example\n',
      sha: 'file-sha',
    });
    expect(api.dispatched[0]).toEqual({
      ref: claims.ref,
      workflowId: 'provision-claim.yaml',
      gitRef: 'fs-forge/ComponentClaim-example',
      inputs: {
        claimType: 'ComponentClaim',
        claimName: 'example',
        correlationId: dispatch.correlationId,
        skipHydration: false,
      },
    });
  });

  it.each(['SystemClaim', 'DomainClaim'])(
    'passes skipHydration=true for catalog-only kind %s',
    async (kind) => {
      const api = new MemoryGitHubApi();
      const claims = repo(api);

      await publishClaim(claims, {
        kind,
        name: 'example',
        path: `claims/${kind === 'SystemClaim' ? 'systems' : 'domains'}/example.yaml`,
        yaml: `kind: ${kind}\nname: example\n`,
      });

      expect(api.dispatched[0].inputs).toEqual({
        claimType: kind,
        claimName: 'example',
        correlationId: expect.any(String),
        skipHydration: true,
      });
    },
  );

  it('reports an existing publish branch clearly', async () => {
    const api = new ExistingBranchApi();
    const claims = repo(api);

    await expect(
      publishClaim(claims, {
        kind: 'ComponentClaim',
        name: 'example',
        path: 'claims/components/example.yaml',
        yaml: 'kind: ComponentClaim\nname: example\n',
      }),
    ).rejects.toThrow(
      'Branch already exists: fs-forge/ComponentClaim-example. Delete it before publishing again.',
    );
  });
});

describe('dispatchUnprovision', () => {
  it('dispatches unprovision-claim with default options', async () => {
    const api = new MemoryGitHubApi();
    const claims = repo(api);

    const dispatch = await dispatchUnprovision(claims, {
      kind: 'ComponentClaim',
      name: 'my-svc',
    });

    expect(dispatch.branch).toBe('main');
    expect(api.dispatched[0]).toEqual({
      ref: claims.ref,
      workflowId: 'unprovision-claim.yaml',
      gitRef: 'main',
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
    const api = new MemoryGitHubApi();
    const claims = claimsRepo(api, 'example-org');
    api.setDefaultBranch(claims.ref, 'develop');

    const dispatch = await dispatchUnprovision(claims, {
      kind: 'TFWorkspaceClaim',
      name: 'my-tf',
      includeVariants: false,
      waitForClaimChecks: true,
    });

    expect(dispatch.branch).toBe('develop');
    expect(api.dispatched[0].gitRef).toBe('develop');
    expect(api.dispatched[0].inputs).toEqual({
      claimType: 'TFWorkspaceClaim',
      claimName: 'my-tf',
      correlationId: expect.any(String),
      includeVariants: false,
      waitForClaimChecks: true,
    });
  });
});

describe('loadClaimsMap', () => {
  it('sees an in-progress push-triggered generation run as in flight', async () => {
    const runs = [
      {
        id: 1,
        html_url: 'https://github.com/example-org/claims/actions/runs/1',
        status: 'in_progress',
        conclusion: null,
        display_title: 'generate',
        event: 'push',
      },
    ];
    const listWorkflowRuns = jest.fn(
      async ({ event }: { event?: string }) => ({
        data: {
          workflow_runs: event
            ? runs.filter((run) => run.event === event)
            : runs,
        },
      }),
    );
    const octokit = {
      rest: {
        repos: {
          get: jest.fn(async () => ({ data: { default_branch: 'main' } })),
          getContent: jest.fn(async () => ({
            data: {
              type: 'file',
              path: 'claims-map.json',
              sha: 'map-file-sha',
              content: Buffer.from(
                JSON.stringify({ headers: { sha: 'map-sha' }, claims: {} }),
              ).toString('base64'),
            },
          })),
        },
        actions: { listWorkflowRuns },
      },
    } as unknown as Octokit;
    const claims = claimsRepo(createOctokitApi(octokit), 'example-org');
    const wait = jest.fn(async () => {
      runs.length = 0;
    });

    await expect(loadClaimsMap(claims, { wait })).resolves.toEqual({
      headers: { sha: 'map-sha' },
      claims: {},
    });
    expect(wait).toHaveBeenCalledTimes(1);
    const request = listWorkflowRuns.mock.calls[0][0] as {
      event?: string;
      per_page?: number;
    };
    expect(request.event).toBeUndefined();
    expect(request.per_page).toBe(20);
  });

  it('treats a missing claims-map workflow as no run in flight', async () => {
    const api = new MemoryGitHubApi();
    const claims = repo(api);
    api.setFile(
      claims.ref,
      'claims-map.json',
      JSON.stringify({ headers: { sha: 'map-sha' }, claims: {} }),
      'map-file-sha',
    );
    api.listWorkflowRuns = async () => {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    };
    const wait = jest.fn(async () => {});

    await expect(loadClaimsMap(claims, { wait })).resolves.toEqual({
      headers: { sha: 'map-sha' },
      claims: {},
    });
    expect(wait).not.toHaveBeenCalled();
  });
});
