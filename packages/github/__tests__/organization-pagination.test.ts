import { paginateGraphQL } from '@octokit/plugin-paginate-graphql';
import { getOrgTeamsDirectAccess } from '../src/organization';

jest.mock('../src/auth', () => ({ getOctokitForOrg: jest.fn() }));

const repositoryEdge = (name: string, permission = 'WRITE') => ({
  node: { name },
  permission,
});

const platform = { id: 'team-platform', name: 'Platform', slug: 'platform' };
const developers = {
  id: 'team-developers',
  name: 'Developers',
  slug: 'developers',
};

function createClient(
  teamPages = [[platform], [developers]],
  repositoryPages = {
    platform: [
      [repositoryEdge('older-repo')],
      [repositoryEdge('firestarter-workflows')],
    ],
    developers: [[repositoryEdge('firestarter-workflows', 'ADMIN')]],
  },
) {
  const graphql = jest.fn(async (query: string, variables: any) => {
    const page = variables.cursor ? Number(variables.cursor) : 0;
    if (query.includes('teams(')) {
      return {
        organization: {
          teams: {
            nodes: teamPages[page].map(team => ({
              ...team,
              // Model the incomplete nested result returned by the old query.
              ...(query.includes('repositories') && {
                repositories: { edges: repositoryPages[team.slug][0] },
              }),
            })),
            pageInfo: {
              hasNextPage: page + 1 < teamPages.length,
              endCursor: String(page + 1),
            },
          },
        },
      };
    }

    const pages = repositoryPages[variables.slug];
    return {
      organization: {
        team: {
          repositories: {
            edges: pages[page],
            pageInfo: {
              hasNextPage: page + 1 < pages.length,
              endCursor: String(page + 1),
            },
          },
        },
      },
    };
  });

  // Exercise the real paginator against deterministic, offline API pages.
  const client = paginateGraphQL({ graphql } as unknown as Parameters<
    typeof paginateGraphQL
  >[0]);
  return { client, graphql };
}

describe('getOrgTeamsDirectAccess pagination', () => {
  it('includes later repository pages and teams from later organization pages', async () => {
    const { client, graphql } = createClient();

    const result = await getOrgTeamsDirectAccess('prefapp', client);

    expect(result).toEqual({
      teams: {
        Platform: { id: platform.id, slug: 'platform' },
        Developers: { id: developers.id, slug: 'developers' },
      },
      repositories: {
        'older-repo': { Platform: { permission: 'WRITE', slug: 'platform' } },
        'firestarter-workflows': {
          Platform: { permission: 'WRITE', slug: 'platform' },
          Developers: { permission: 'ADMIN', slug: 'developers' },
        },
      },
    });
    expect(graphql).toHaveBeenCalledWith(
      expect.stringContaining('repositories(first: 100, after: $cursor)'),
      expect.objectContaining({ org: 'prefapp', slug: 'platform', cursor: '1' }),
    );
  });

  it('handles an organization without teams', async () => {
    const { client, graphql } = createClient([[]]);

    await expect(getOrgTeamsDirectAccess('prefapp', client)).resolves.toEqual({
      teams: {},
      repositories: {},
    });
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it('preserves teams without repositories', async () => {
    const { client } = createClient([[platform]], {
      platform: [[]],
      developers: [[]],
    });

    await expect(getOrgTeamsDirectAccess('prefapp', client)).resolves.toEqual({
      teams: { Platform: { id: platform.id, slug: 'platform' } },
      repositories: {},
    });
  });

  it('rejects if a later repository page fails instead of returning partial access', async () => {
    const { client, graphql } = createClient([[platform]]);
    const respond = graphql.getMockImplementation()!;
    graphql.mockImplementation(async (query, variables) => {
      if (!query.includes('teams(') && variables.cursor === '1') {
        throw new Error('Repository page unavailable');
      }
      return respond(query, variables);
    });

    await expect(getOrgTeamsDirectAccess('prefapp', client)).rejects.toThrow(
      'Repository page unavailable',
    );
  });
});
