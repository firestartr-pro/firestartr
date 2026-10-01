import common from 'catalog_common';
import github from 'github';
import { createGhApi } from '../../../src/api/gh-api';
import { E2EState } from '../../../src/api/state';

function createState(org = 'demo-org'): E2EState {
  return new E2EState({
    org,
    namespace: 'default',
    prefix: '',
    kubeConfigProvider: () => ({}) as never,
  });
}

function mockOctokit(
  options: {
    paginateData?: unknown[];
    request?: jest.Mock;
    rest?: {
      repos?: {
        listForOrg?: unknown;
      };
      teams?: {
        list?: unknown;
      };
      rateLimit?: {
        get?: unknown;
      };
      actions?: {
        listOrgVariables?: unknown;
        getOrgVariable?: unknown;
        createOrgVariable?: unknown;
        deleteOrgVariable?: unknown;
      };
    };
  } = {},
): {
  getOctokitForOrg: jest.SpyInstance;
  paginate: jest.Mock;
  request: jest.Mock;
  rest: {
    repos: {
      listForOrg: unknown;
    };
    teams: {
      list: unknown;
    };
    rateLimit: {
      get: unknown;
    };
    actions: {
      listOrgVariables: unknown;
      getOrgVariable: unknown;
      createOrgVariable: unknown;
      deleteOrgVariable: unknown;
    };
  };
} {
  const paginate = jest.fn().mockResolvedValue(options.paginateData ?? []);
  const request = options.request ?? jest.fn();
  const rest = {
    repos: {
      listForOrg: options.rest?.repos?.listForOrg ?? Symbol('listForOrg'),
    },
    teams: {
      list: options.rest?.teams?.list ?? Symbol('teams.list'),
    },
    rateLimit: {
      get: options.rest?.rateLimit?.get ?? Symbol('rateLimit.get'),
    },
    actions: {
      listOrgVariables:
        options.rest?.actions?.listOrgVariables ??
        Symbol('actions.listOrgVariables'),
      getOrgVariable:
        options.rest?.actions?.getOrgVariable ??
        Symbol('actions.getOrgVariable'),
      createOrgVariable:
        options.rest?.actions?.createOrgVariable ??
        Symbol('actions.createOrgVariable'),
      deleteOrgVariable:
        options.rest?.actions?.deleteOrgVariable ??
        Symbol('actions.deleteOrgVariable'),
    },
  };

  const getOctokitForOrg = jest
    .spyOn(github, 'getOctokitForOrg')
    .mockResolvedValue({
      paginate,
      request,
      rest,
    } as never);

  return { getOctokitForOrg, paginate, request, rest };
}

describe('createGhApi org webhook helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists org webhooks and filters invalid entries', async () => {
    const { getOctokitForOrg, paginate } = mockOctokit({
      paginateData: [
        {
          id: 101,
          name: 'web',
          active: true,
          events: ['push', 'issues'],
          config: { url: 'https://example.com/hooks/a' },
        },
        {
          id: 102,
          active: false,
          events: ['push'],
          config: {},
        },
      ],
    });

    const api = createGhApi(createState());

    await expect(api.listOrgWebhooks()).resolves.toEqual([
      {
        id: 101,
        deliveryUrl: 'https://example.com/hooks/a',
        active: true,
        events: ['push', 'issues'],
        name: 'web',
      },
    ]);

    expect(getOctokitForOrg).toHaveBeenCalledWith('demo-org', true);

    expect(paginate).toHaveBeenCalledTimes(1);
    expect(paginate).toHaveBeenCalledWith('GET /orgs/{org}/hooks', {
      org: 'demo-org',
      per_page: 100,
    });
  });

  it('lists repositories with a paginated octokit client', async () => {
    const { getOctokitForOrg, paginate, rest } = mockOctokit({
      paginateData: [{ name: 'repo-a' }, { name: 'repo-b' }],
    });

    const api = createGhApi(createState());

    await expect(api.listRepos()).resolves.toEqual(['repo-a', 'repo-b']);

    expect(getOctokitForOrg).toHaveBeenCalledWith('demo-org', true);
    expect(paginate).toHaveBeenCalledWith(rest.repos.listForOrg, {
      org: 'demo-org',
      type: 'all',
      per_page: 100,
    });
  });

  it('reads repository metadata used by e2e assertions', async () => {
    const getRepoInfo = jest
      .spyOn(github.repo, 'getRepoInfo')
      .mockResolvedValue({
        description: 'repo description',
        topics: ['topic-a', 42, 'topic-b'],
      } as never);

    const api = createGhApi(createState());

    await expect(api.getRepoInfo('repo-a')).resolves.toEqual({
      description: 'repo description',
      topics: ['topic-a', 'topic-b'],
    });
    expect(getRepoInfo).toHaveBeenCalledWith('demo-org', 'repo-a');
  });

  it('reads repository secret metadata used by e2e assertions', async () => {
    const getRepoSecret = jest
      .spyOn(github.repo, 'getRepoSecret')
      .mockResolvedValue({
        name: 'ACTIONS_TOKEN',
        updated_at: '2026-07-17T09:00:00Z',
      } as never);

    const api = createGhApi(createState());

    await expect(api.getRepoSecret('repo-a', 'ACTIONS_TOKEN')).resolves.toEqual(
      {
        name: 'ACTIONS_TOKEN',
        updatedAt: '2026-07-17T09:00:00Z',
      },
    );
    expect(getRepoSecret).toHaveBeenCalledWith(
      'demo-org',
      'repo-a',
      'ACTIONS_TOKEN',
    );
  });

  it('reads organization settings used by e2e assertions', async () => {
    const getOrgInfo = jest.spyOn(github.org, 'getOrgInfo').mockResolvedValue({
      description: 'org description',
      company: 'Prefapp',
      has_organization_projects: true,
    } as never);

    const api = createGhApi(createState());

    await expect(api.getOrgSettings()).resolves.toEqual({
      description: 'org description',
      company: 'Prefapp',
      hasOrganizationProjects: true,
    });
    expect(getOrgInfo).toHaveBeenCalledWith('demo-org');
  });

  it('coerces invalid organization settings fields to null', async () => {
    jest.spyOn(github.org, 'getOrgInfo').mockResolvedValue({
      description: 123,
      company: false,
      has_organization_projects: 'true',
    } as never);

    const api = createGhApi(createState());

    await expect(api.getOrgSettings()).resolves.toEqual({
      description: null,
      company: null,
      hasOrganizationProjects: null,
    });
  });

  it('lists groups with a paginated octokit client', async () => {
    const { getOctokitForOrg, paginate, rest } = mockOctokit({
      paginateData: [{ slug: 'team-a' }, { name: 'Team B' }],
    });

    const api = createGhApi(createState());

    await expect(api.listGroups()).resolves.toEqual(['team-a', 'Team B']);

    expect(getOctokitForOrg).toHaveBeenCalledWith('demo-org', true);
    expect(paginate).toHaveBeenCalledWith(rest.teams.list, {
      org: 'demo-org',
      per_page: 100,
    });
  });

  it('reads the core GitHub API rate limit', async () => {
    const getRateLimit = jest.fn().mockResolvedValue({
      data: {
        resources: {
          core: {
            limit: 5000,
            remaining: 1234,
            reset: 1710000000,
          },
        },
      },
    });
    const { getOctokitForOrg } = mockOctokit({
      rest: {
        rateLimit: {
          get: getRateLimit,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.getRateLimit()).resolves.toEqual({
      core: {
        limit: 5000,
        remaining: 1234,
        reset: 1710000000,
      },
    });

    expect(getOctokitForOrg).toHaveBeenCalledWith('demo-org', true);
    expect(getRateLimit).toHaveBeenCalledTimes(1);
  });

  it('finds org webhooks by URL', async () => {
    mockOctokit({
      paginateData: [
        {
          id: 101,
          active: true,
          events: ['push'],
          config: { url: 'https://example.com/hooks/a' },
        },
        {
          id: 102,
          active: false,
          events: ['pull_request'],
          config: { url: 'https://example.com/hooks/b' },
        },
      ],
    });

    const api = createGhApi(createState());

    await expect(
      api.findOrgWebhookByUrl('https://example.com/hooks/b'),
    ).resolves.toEqual({
      id: 102,
      deliveryUrl: 'https://example.com/hooks/b',
      active: false,
      events: ['pull_request'],
      name: undefined,
    });
  });

  it('reports org webhook existence by URL', async () => {
    mockOctokit({
      paginateData: [
        {
          id: 201,
          active: true,
          events: ['push'],
          config: { url: 'https://example.com/hooks/a' },
        },
      ],
    });

    const api = createGhApi(createState());

    await expect(
      api.orgWebhookExists('https://example.com/hooks/missing'),
    ).resolves.toBe(false);
  });

  it('deletes all matched org webhooks by hook id', async () => {
    const request = jest.fn().mockResolvedValue({ data: {} });
    const { paginate } = mockOctokit({
      paginateData: [
        {
          id: 301,
          active: true,
          events: ['push'],
          config: { url: 'https://example.com/hooks/a' },
        },
        {
          id: 302,
          active: true,
          events: ['issues'],
          config: { url: 'https://example.com/hooks/a' },
        },
      ],
      request,
    });

    const api = createGhApi(createState());

    await expect(
      api.destroyOrgWebhookByUrl('https://example.com/hooks/a'),
    ).resolves.toBeUndefined();

    expect(paginate).toHaveBeenCalledWith('GET /orgs/{org}/hooks', {
      org: 'demo-org',
      per_page: 100,
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      'DELETE /orgs/{org}/hooks/{hook_id}',
      {
        org: 'demo-org',
        hook_id: 301,
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'DELETE /orgs/{org}/hooks/{hook_id}',
      {
        org: 'demo-org',
        hook_id: 302,
      },
    );
  });

  it('ignores missing org webhook delete targets', async () => {
    const request = jest.fn();
    const { paginate } = mockOctokit({ request });

    const api = createGhApi(createState());

    await expect(
      api.destroyOrgWebhookByUrl('https://example.com/hooks/missing'),
    ).resolves.toBeUndefined();

    expect(paginate).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it('suppresses not-found errors when deleting a matched org webhook', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce({ status: 404, message: 'not found' })
      .mockResolvedValueOnce({ data: {} });

    mockOctokit({
      paginateData: [
        {
          id: 401,
          active: true,
          events: ['push'],
          config: { url: 'https://example.com/hooks/a' },
        },
        {
          id: 402,
          active: true,
          events: ['issues'],
          config: { url: 'https://example.com/hooks/a' },
        },
      ],
      request,
    });

    const api = createGhApi(createState());

    await expect(
      api.destroyOrgWebhookByUrl('https://example.com/hooks/a'),
    ).resolves.toBeUndefined();
  });
});

describe('createGhApi org variable helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists org variables and filters invalid entries', async () => {
    const listOrgVariables = jest.fn().mockResolvedValue({
      data: {
        variables: [
          { name: 'VAR_A', visibility: 'all' },
          { name: 'VAR_B', visibility: 'selected' },
          { visibility: 'all' },
          { name: 'VAR_C', visibility: 'unknown' },
        ],
      },
    });
    const { getOctokitForOrg } = mockOctokit({
      rest: {
        actions: {
          listOrgVariables,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.listOrgVariables()).resolves.toEqual([
      { name: 'VAR_A', visibility: 'all' },
      { name: 'VAR_B', visibility: 'selected' },
    ]);

    expect(getOctokitForOrg).toHaveBeenCalledWith('demo-org', true);
    expect(listOrgVariables).toHaveBeenCalledWith({
      org: 'demo-org',
      per_page: 100,
      page: 1,
    });
  });

  it('finds an org variable by name', async () => {
    const getOrgVariable = jest.fn().mockResolvedValue({
      data: { name: 'VAR_A', visibility: 'all' },
    });
    mockOctokit({
      rest: {
        actions: {
          getOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.findOrgVariableByName('VAR_A')).resolves.toEqual({
      name: 'VAR_A',
      visibility: 'all',
    });
  });

  it('returns null when an org variable is not found', async () => {
    const getOrgVariable = jest
      .fn()
      .mockRejectedValue({ status: 404, message: 'not found' });
    mockOctokit({
      rest: {
        actions: {
          getOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.findOrgVariableByName('MISSING')).resolves.toBeNull();
  });

  it('reports org variable existence by name', async () => {
    const getOrgVariable = jest
      .fn()
      .mockRejectedValueOnce({ status: 404, message: 'not found' })
      .mockResolvedValueOnce({
        data: { name: 'VAR_A', visibility: 'all' },
      });
    mockOctokit({
      rest: {
        actions: {
          getOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.orgVariableExists('MISSING')).resolves.toBe(false);
    await expect(api.orgVariableExists('VAR_A')).resolves.toBe(true);
  });

  it('creates an org variable with all visibility', async () => {
    const createOrgVariable = jest.fn().mockResolvedValue({ data: {} });
    mockOctokit({
      rest: {
        actions: {
          createOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(
      api.createOrgVariable('VAR_A', 'value-a', 'all'),
    ).resolves.toBeUndefined();

    expect(createOrgVariable).toHaveBeenCalledWith({
      org: 'demo-org',
      name: 'VAR_A',
      value: 'value-a',
      visibility: 'all',
    });
  });

  it('creates an org variable with selected visibility and repository ids', async () => {
    const createOrgVariable = jest.fn().mockResolvedValue({ data: {} });
    mockOctokit({
      rest: {
        actions: {
          createOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(
      api.createOrgVariable('VAR_A', 'value-a', 'selected', [123, 456]),
    ).resolves.toBeUndefined();

    expect(createOrgVariable).toHaveBeenCalledWith({
      org: 'demo-org',
      name: 'VAR_A',
      value: 'value-a',
      visibility: 'selected',
      selected_repository_ids: [123, 456],
    });
  });

  it('deletes an org variable by name', async () => {
    const deleteOrgVariable = jest.fn().mockResolvedValue({ data: {} });
    mockOctokit({
      rest: {
        actions: {
          deleteOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.deleteOrgVariable('VAR_A')).resolves.toBeUndefined();

    expect(deleteOrgVariable).toHaveBeenCalledWith({
      org: 'demo-org',
      name: 'VAR_A',
    });
  });

  it('ignores not-found when deleting an org variable', async () => {
    const deleteOrgVariable = jest
      .fn()
      .mockRejectedValue({ status: 404, message: 'not found' });
    mockOctokit({
      rest: {
        actions: {
          deleteOrgVariable,
        },
      },
    });

    const api = createGhApi(createState());

    await expect(api.deleteOrgVariable('MISSING')).resolves.toBeUndefined();
  });

  it('lists selected repositories for an org variable', async () => {
    const { paginate } = mockOctokit({
      paginateData: [
        { full_name: 'demo-org/repo-a' },
        { full_name: 'demo-org/repo-b' },
        { full_name: 123 },
      ],
    });

    const api = createGhApi(createState());

    await expect(
      api.getOrgVariableSelectedRepositories('VAR_A'),
    ).resolves.toEqual(['demo-org/repo-a', 'demo-org/repo-b']);

    expect(paginate).toHaveBeenCalledWith(
      'GET /orgs/{org}/actions/variables/{name}/repositories',
      {
        org: 'demo-org',
        name: 'VAR_A',
        per_page: 100,
      },
    );
  });
});

describe('createGhApi repo file helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads file content from a repository', async () => {
    const getContent = jest
      .spyOn(github.repo, 'getContent')
      .mockResolvedValue('# CODEOWNERS content' as never);

    const api = createGhApi(createState());

    await expect(
      api.getRepoFile('repo-a', '.github/CODEOWNERS'),
    ).resolves.toEqual('# CODEOWNERS content');
    expect(getContent).toHaveBeenCalledWith(
      '.github/CODEOWNERS',
      'repo-a',
      'demo-org',
    );
  });

  it('retries getRepoFile on not-found until available', async () => {
    const getContent = jest
      .spyOn(github.repo, 'getContent')
      .mockRejectedValueOnce({ status: 404, message: 'not found' })
      .mockResolvedValueOnce('file content' as never);

    jest
      .spyOn(common.generic, 'sleep')
      .mockImplementation(async () => undefined);

    const api = createGhApi(createState());

    await expect(
      api.getRepoFile('repo-a', '.github/CODEOWNERS', {
        attempts: 3,
        delayMs: 100,
      }),
    ).resolves.toEqual('file content');
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it('returns null from tryGetRepoFile when the file is absent', async () => {
    jest
      .spyOn(github.repo, 'getContent')
      .mockRejectedValueOnce({ status: 404, message: 'not found' });

    const api = createGhApi(createState());

    await expect(
      api.tryGetRepoFile('repo-a', '.github/CODEOWNERS'),
    ).resolves.toBeNull();
  });
});
