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
    body: 'Closes #3',
  },
  {
    number: 8,
    html_url: 'https://github.com/example/state-github/pull/8',
    state: 'open',
    head: { ref: 'manual-change' },
    base: { ref: 'main', sha: 'base-sha' },
    updated_at: '2026-01-02T00:00:00Z',
    body: '',
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
        downloadTarballArchive: jest.fn(async ({ ref }: { ref: string }) => {
          octokitRequests.push(`repos.downloadTarballArchive ${ref}`);
          return { data: Uint8Array.from([1, 2, 3]).buffer };
        }),
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
      issues: {
        create: jest.fn(
          async ({ title, body }: { title: string; body: string }) => {
            octokitRequests.push(`issues.create ${title} | ${body}`);
            return {
              data: {
                number: 31,
                html_url: 'https://github.com/example/claims/issues/31',
              },
            };
          },
        ),
        createComment: jest.fn(
          async ({
            issue_number,
            body,
          }: {
            issue_number: number;
            body: string;
          }) => {
            octokitRequests.push(
              `issues.createComment ${issue_number} | ${body}`,
            );
            return { data: {} };
          },
        ),
        update: jest.fn(
          async ({
            issue_number,
            state,
          }: {
            issue_number: number;
            state: string;
          }) => {
            octokitRequests.push(`issues.update ${issue_number} ${state}`);
            return { data: {} };
          },
        ),
      },
      pulls: {
        create: jest.fn(
          async ({
            head,
            base,
            title,
            body,
          }: {
            head: string;
            base: string;
            title: string;
            body: string;
          }) => {
            octokitRequests.push(
              `pulls.create ${head} ${base} ${title} | ${body}`,
            );
            return {
              data: {
                number: 32,
                html_url: 'https://github.com/example/claims/pull/32',
              },
            };
          },
        ),
        update: jest.fn(
          async ({ pull_number, body }: { pull_number: number; body: string }) => {
            octokitRequests.push(`pulls.update ${pull_number} | ${body}`);
            return { data: {} };
          },
        ),
        list: jest.fn(
          async ({ head, page }: { head?: string; page?: number }) => {
            octokitRequests.push(`pulls.list head=${head} page=${page}`);
            // GitHub matches `head` exactly as `owner:branch`.
            const branch = head?.split(':')[1];
            const filtered = branch
              ? PULLS.filter((pull) => pull.head.ref === branch)
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
            head: { sha: 'head-sha' },
            merge_commit_sha: 'head-sha',
          },
        })),
      },
      checks: {
        listForRef: jest.fn(async ({ ref }: { ref: string }) => {
          octokitRequests.push(`checks.listForRef ${ref}`);
          return { data: { check_runs: CHECK_RUNS } };
        }),
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
    body: pull.body,
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
      body: 'Closes #3',
    });
  });

  it('creates an issue, comments on it and closes it', async () => {
    const api = makeApi();

    const issue = await api.createIssue(REF, {
      title: 'Create component api',
      body: '## Goal\nCreate it.',
    });
    expect(issue.number).toBeGreaterThan(0);
    expect(issue.htmlUrl).toBe(
      `https://github.com/example/claims/issues/${issue.number}`,
    );

    await expect(
      api.commentOnIssue(REF, issue.number, 'Workflow run: https://run'),
    ).resolves.toBeUndefined();
    await expect(api.closeIssue(REF, issue.number)).resolves.toBeUndefined();
  });

  it('creates a pull request and updates its body', async () => {
    const api = makeApi();

    const pull = await api.createPullRequest(REF, {
      head: 'fs-forge/ComponentClaim-api',
      base: 'main',
      title: 'ci: provision claim ComponentClaim/api',
      body: 'Closes #3',
    });
    expect(pull.number).toBeGreaterThan(0);
    expect(pull.htmlUrl).toBe(
      `https://github.com/example/claims/pull/${pull.number}`,
    );

    await expect(
      api.updatePullRequest(REF, pull.number, { body: 'Closes #4' }),
    ).resolves.toBeUndefined();
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

  it('downloads a repository archive as a buffer at the requested ref', async () => {
    const api = makeApi();

    await expect(api.downloadTarball(REF, 'trunk')).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
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
  it('downloads archives at the requested ref and defaults to HEAD', async () => {
    const api = octokitScenario();

    await api.downloadTarball(REF, 'trunk');
    await api.downloadTarball(REF);

    expect(octokitRequests).toEqual([
      'repos.downloadTarballArchive trunk',
      'repos.downloadTarballArchive HEAD',
    ]);
  });

  it('reads check runs through the pull request head SHA', async () => {
    const api = octokitScenario();
    await api.listCheckRunsForPullRequest(REF, 7);
    expect(octokitRequests).toEqual(['checks.listForRef head-sha']);
  });

  it('lists every open pull request and filters the head prefix locally', async () => {
    const api = octokitScenario();
    await api.listOpenPullRequests(REF, 'automated');
    expect(octokitRequests).toContain('pulls.list head=undefined page=1');
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

  it('sends issue and pull request writes through their REST endpoints', async () => {
    const api = octokitScenario();

    await api.createIssue(REF, { title: 'Create component api', body: 'body' });
    await api.commentOnIssue(REF, 31, 'Workflow run: https://run');
    await api.closeIssue(REF, 31);
    await api.createPullRequest(REF, {
      head: 'fs-forge/ComponentClaim-api',
      base: 'main',
      title: 'ci: provision claim ComponentClaim/api',
      body: 'Closes #3',
    });
    await api.updatePullRequest(REF, 32, { body: 'Closes #4' });

    expect(octokitRequests).toEqual(
      expect.arrayContaining([
        'issues.create Create component api | body',
        'issues.createComment 31 | Workflow run: https://run',
        'issues.update 31 closed',
        'pulls.create fs-forge/ComponentClaim-api main ci: provision claim ComponentClaim/api | Closes #3',
        'pulls.update 32 | Closes #4',
      ]),
    );
  });
});
