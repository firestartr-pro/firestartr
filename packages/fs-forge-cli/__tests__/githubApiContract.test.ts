import { describe, expect, it, jest } from '@jest/globals';

import { createOctokitApi } from '../src/github/octokitApi';
import { MemoryGitHubApi } from './fixtures/memoryGitHubApi';

import type { GitHubApi, RepoRef } from '../src/github/api';
import type { Octokit } from '@octokit/rest';

const REF: RepoRef = { owner: 'example', repo: 'claims' };
const OTHER_REF: RepoRef = { owner: 'example', repo: 'other' };

function notFound(): Error {
  return Object.assign(new Error('Not Found'), { status: 404 });
}

function base64(content: string): string {
  return Buffer.from(content).toString('base64');
}

const FILES: Record<string, string> = {
  'claims-map.json': '{"headers":{"sha":"x"},"claims":{}}',
  'claims/components/api.yaml': 'kind: ComponentClaim\nname: api\n',
};

const PULLS = [
  {
    number: 7,
    html_url: 'https://github.com/example/state-github/pull/7',
    state: 'open',
    head: { ref: 'automated-componentclaim-api' },
    base: { ref: 'main', sha: 'base-sha' },
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    number: 8,
    html_url: 'https://github.com/example/state-github/pull/8',
    state: 'open',
    head: { ref: 'manual-change' },
    base: { ref: 'main', sha: 'base-sha' },
    updated_at: '2026-01-02T00:00:00Z',
  },
];

const CHECK_RUNS = [
  {
    name: 'plan',
    conclusion: 'success',
    status: 'completed',
    output: { title: null, summary: 'ok', text: null },
    html_url: 'https://github.com/example/claims/checks/1',
  },
];

const octokitRequests: string[] = [];

function octokitScenario(): GitHubApi {
  octokitRequests.length = 0;
  const octokit = {
    rest: {
      repos: {
        getContent: jest.fn(
          async ({ path }: { path: string }) => {
            octokitRequests.push(`repos.getContent ${path}`);
            const content = FILES[path];
            if (content === undefined) throw notFound();
            return {
              data: {
                type: 'file',
                path,
                sha: 'file-sha',
                content: base64(content),
              },
            };
          },
        ),
        get: jest.fn(async ({ repo }: { repo: string }) => {
          if (repo === 'missing-repo') throw notFound();
          return { data: { default_branch: 'main' } };
        }),
        downloadTarballArchive: jest.fn(async () => ({
          data: Uint8Array.from([1, 2, 3]).buffer,
        })),
      },
      git: {
        getTree: jest.fn(async () => ({
          data: {
            tree: [
              { type: 'tree', path: 'claims' },
              { type: 'blob', path: 'claims/components/a.yaml' },
              { type: 'blob', path: 'claims/claims_defaults.yaml' },
            ],
          },
        })),
        getRef: jest.fn(async () => ({ data: { object: { sha: 'base-sha' } } })),
        createRef: jest.fn(async () => ({ data: {} })),
      },
      actions: {
        createWorkflowDispatch: jest.fn(async () => ({ data: {} })),
        listWorkflowRuns: jest.fn(
          async ({
            event,
            per_page,
          }: {
            event?: string;
            per_page?: number;
          }) => {
            octokitRequests.push(
              `listWorkflowRuns event=${String(event)} per_page=${String(per_page)}`,
            );
            const runs = [
              {
                id: 42,
                html_url: 'https://github.com/example/claims/actions/runs/42',
                status: 'completed',
                conclusion: 'success',
                display_title: 'corr-1',
                event: 'workflow_dispatch',
              },
              {
                id: 43,
                html_url: 'https://github.com/example/claims/actions/runs/43',
                status: 'queued',
                conclusion: null,
                display_title: 'generate',
                event: 'push',
              },
            ];
            return {
              data: {
                workflow_runs: event
                  ? runs.filter((run) => run.event === event)
                  : runs,
              },
            };
          },
        ),
      },
      pulls: {
        list: jest.fn(
          async ({ head, page }: { head?: string; page?: number }) => {
            octokitRequests.push(`pulls.list head=${head} page=${page}`);
            const prefix = head?.split(':')[1];
            const filtered = prefix
              ? PULLS.filter((pull) => pull.head.ref.startsWith(prefix))
              : PULLS;
            return { data: filtered };
          },
        ),
        listFiles: jest.fn(async ({ page }: { page?: number }) => {
          if (page === 1) {
            return { data: [...Array(100)].map(() => ({
              filename: 'cr.yaml',
              status: 'added',
            })) };
          }
          return { data: [{ filename: 'last.yaml', status: 'removed' }] };
        }),
        get: jest.fn(async ({ pull_number }: { pull_number: number }) => ({
          data: {
            number: pull_number,
            html_url: `https://github.com/example/state-github/pull/${pull_number}`,
            state: 'closed',
            merged: true,
          },
        })),
      },
      checks: {
        listForRef: jest.fn(async ({ ref }: { ref: string }) => {
          octokitRequests.push(`checks.listForRef ${ref}`);
          return { data: { check_runs: CHECK_RUNS } };
        }),
      },
      search: {
        code: jest.fn(async () => ({
          data: {
            total_count: 2,
            items: [
              {
                path: 'cr.yaml',
                name: 'cr.yaml',
                repository: { full_name: 'example/claims' },
              },
              {
                path: 'other.yaml',
                name: 'other.yaml',
                repository: { full_name: 'example/other' },
              },
            ],
          },
        })),
      },
      teams: {
        getByName: jest.fn(async ({ team_slug }: { team_slug: string }) => {
          if (team_slug === 'missing') throw notFound();
          return { data: {} };
        }),
      },
      orgs: {
        checkMembershipForUser: jest.fn(
          async ({ username }: { username: string }) => {
            if (username === 'outsider') throw notFound();
            return { status: 204 };
          },
        ),
      },
    },
  } as unknown as Octokit;
  return createOctokitApi(octokit);
}

function memoryScenario(): GitHubApi {
  const api = new MemoryGitHubApi();
  api.setDefaultBranch(REF, 'main');
  api.setBranchHeadSha(REF, 'main', 'base-sha');
  for (const [path, content] of Object.entries(FILES)) {
    api.setFile(REF, path, content, 'file-sha');
  }
  api.setBlobPaths(REF, [
    'claims/components/a.yaml',
    'claims/claims_defaults.yaml',
  ]);
  api.setWorkflowRuns(REF, 'provision-claim.yaml', 'main', [
    {
      id: 42,
      htmlUrl: 'https://github.com/example/claims/actions/runs/42',
      status: 'completed',
      conclusion: 'success',
      displayTitle: 'corr-1',
      event: 'workflow_dispatch',
    },
    {
      id: 43,
      htmlUrl: 'https://github.com/example/claims/actions/runs/43',
      status: 'queued',
      conclusion: null,
      displayTitle: 'generate',
      event: 'push',
    },
  ]);
  api.setPullRequests(REF, PULLS.map((pull) => ({
    number: pull.number,
    htmlUrl: pull.html_url,
    state: pull.state,
    headRef: pull.head.ref,
    baseSha: pull.base.sha,
    updatedAt: pull.updated_at,
  })));
  api.setPullRequestFiles(
    REF,
    7,
    [
      ...[...Array(100)].map(() => ({ filename: 'cr.yaml', status: 'added' })),
      { filename: 'last.yaml', status: 'removed' },
    ],
  );
  api.setCheckRuns(
    REF,
    7,
    CHECK_RUNS.map((run) => ({
      name: run.name,
      conclusion: run.conclusion,
      status: run.status,
      output: run.output,
      htmlUrl: run.html_url,
    })),
  );
  api.setSearchResults(REF, [{ path: 'cr.yaml', name: 'cr.yaml' }]);
  api.tarball = Buffer.from([1, 2, 3]);
  api.addRepo(REF);
  api.addTeam('example', 'platform');
  api.addMember('example', 'octocat');
  return api;
}

const ADAPTERS: Array<[string, () => GitHubApi]> = [
  ['createOctokitApi', octokitScenario],
  ['MemoryGitHubApi', memoryScenario],
];

describe.each(ADAPTERS)('GitHubApi contract (%s)', (_name, makeApi) => {
  it('reads a file and maps a missing path to null', async () => {
    const api = makeApi();

    await expect(api.readFile(REF, 'claims-map.json')).resolves.toEqual({
      path: 'claims-map.json',
      content: FILES['claims-map.json'],
      sha: 'file-sha',
    });
    await expect(api.readFile(REF, 'nope.yaml')).resolves.toBeNull();
  });

  it('keeps only blobs in a recursive tree listing', async () => {
    const api = makeApi();
    await expect(api.listBlobPaths(REF, 'main')).resolves.toEqual([
      'claims/components/a.yaml',
      'claims/claims_defaults.yaml',
    ]);
  });

  it('filters open pull requests by head prefix', async () => {
    const api = makeApi();

    const all = await api.listOpenPullRequests(REF);
    expect(all.map((pull) => pull.number)).toEqual([7, 8]);

    const automated = await api.listOpenPullRequests(REF, 'automated');
    expect(automated.map((pull) => pull.number)).toEqual([7]);
    expect(automated[0]).toEqual({
      number: 7,
      htmlUrl: 'https://github.com/example/state-github/pull/7',
      state: 'open',
      headRef: 'automated-componentclaim-api',
      baseSha: 'base-sha',
      updatedAt: '2026-01-01T00:00:00Z',
    });
  });

  it('returns every pull request file across pages', async () => {
    const api = makeApi();

    const files = await api.listPullRequestFiles(REF, 7);

    expect(files).toHaveLength(101);
    expect(files[100]).toEqual({ filename: 'last.yaml', status: 'removed' });
  });

  it('returns check runs for a pull request', async () => {
    const api = makeApi();

    await expect(api.listCheckRunsForPullRequest(REF, 7)).resolves.toEqual([
      {
        name: 'plan',
        conclusion: 'success',
        status: 'completed',
        output: { title: null, summary: 'ok', text: null },
        htmlUrl: 'https://github.com/example/claims/checks/1',
      },
    ]);
  });

  it('reads a pull request by number', async () => {
    const api = makeApi();

    await expect(api.getPullRequest(REF, 7)).resolves.toEqual(
      expect.objectContaining({
        number: 7,
        htmlUrl: 'https://github.com/example/state-github/pull/7',
      }),
    );
  });

  it('filters search results to the target repository', async () => {
    const api = makeApi();

    await expect(api.searchFiles(REF, '"claim-ref"')).resolves.toEqual([
      { path: 'cr.yaml', name: 'cr.yaml' },
    ]);
  });

  it('lists workflow runs unfiltered and filtered by event', async () => {
    const api = makeApi();
    const request = {
      workflowId: 'provision-claim.yaml',
      branch: 'main',
    };

    await expect(api.listWorkflowRuns(REF, request)).resolves.toEqual([
      {
        id: 42,
        htmlUrl: 'https://github.com/example/claims/actions/runs/42',
        status: 'completed',
        conclusion: 'success',
        displayTitle: 'corr-1',
      },
      {
        id: 43,
        htmlUrl: 'https://github.com/example/claims/actions/runs/43',
        status: 'queued',
        conclusion: null,
        displayTitle: 'generate',
      },
    ]);
    await expect(
      api.listWorkflowRuns(REF, { ...request, event: 'workflow_dispatch' }),
    ).resolves.toEqual([
      {
        id: 42,
        htmlUrl: 'https://github.com/example/claims/actions/runs/42',
        status: 'completed',
        conclusion: 'success',
        displayTitle: 'corr-1',
      },
    ]);
  });

  it('maps missing resources to false for the provider checks', async () => {
    const api = makeApi();

    await expect(api.repoExists(REF)).resolves.toBe(true);
    await expect(api.repoExists({ owner: 'example', repo: 'missing-repo' })).resolves.toBe(false);
    await expect(api.teamExists('example', 'platform')).resolves.toBe(true);
    await expect(api.teamExists('example', 'missing')).resolves.toBe(false);
    await expect(api.userIsOrgMember('example', 'octocat')).resolves.toBe(true);
    await expect(api.userIsOrgMember('example', 'outsider')).resolves.toBe(false);
  });

  it('downloads the repository tarball', async () => {
    const api = makeApi();
    await expect(api.downloadTarball(REF)).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
  });
});

describe('octokit adapter request shapes', () => {
  it('reads check runs through refs/pull/<n>/head', async () => {
    const api = octokitScenario();
    await api.listCheckRunsForPullRequest(REF, 7);
    expect(octokitRequests).toContain('checks.listForRef refs/pull/7/head');
  });

  it('filters pull requests with the owner-qualified head', async () => {
    const api = octokitScenario();
    await api.listOpenPullRequests(REF, 'automated');
    expect(octokitRequests).toContain(
      'pulls.list head=example:automated page=1',
    );
  });

  it('reads a file through repos.getContent', async () => {
    const api = octokitScenario();
    await api.readFile(REF, 'claims-map.json');
    expect(octokitRequests).toContain('repos.getContent claims-map.json');
  });

  it('forwards the caller workflow event filter and page size', async () => {
    const api = octokitScenario();
    await api.listWorkflowRuns(REF, {
      workflowId: 'provision-claim.yaml',
      branch: 'main',
    });
    await api.listWorkflowRuns(REF, {
      workflowId: 'provision-claim.yaml',
      branch: 'main',
      event: 'workflow_dispatch',
      perPage: 30,
    });
    expect(octokitRequests).toContain(
      'listWorkflowRuns event=undefined per_page=20',
    );
    expect(octokitRequests).toContain(
      'listWorkflowRuns event=workflow_dispatch per_page=30',
    );
  });

  it('maps a missing repo to false', async () => {
    const api = octokitScenario();
    await expect(api.repoExists(OTHER_REF)).resolves.toBe(true);
  });

  it('propagates a missing workflow instead of masking it', async () => {
    const octokit = {
      rest: {
        actions: {
          listWorkflowRuns: jest.fn(async () => {
            throw Object.assign(new Error('Not Found'), { status: 404 });
          }),
        },
      },
    } as unknown as Octokit;
    const api = createOctokitApi(octokit);

    await expect(
      api.listWorkflowRuns(REF, {
        workflowId: 'missing.yaml',
        branch: 'main',
      }),
    ).rejects.toThrow('Not Found');
  });

  it('maps a merged pull request to its merged state', async () => {
    const api = octokitScenario();
    await expect(api.getPullRequest(REF, 7)).resolves.toEqual({
      number: 7,
      htmlUrl: 'https://github.com/example/state-github/pull/7',
      state: 'merged',
      merged: true,
    });
  });
});
