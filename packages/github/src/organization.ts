import { getOctokitForOrg } from './auth';

import log from './logger';

const defaultPerPage = 100;

export async function getRepositoryList(
  org: string,
  perPageEntries: number = defaultPerPage,
  octokit?: any,
) {
  log.info(
    `Getting repository list for ${org} with ${perPageEntries} entries per page`,
  );

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const options: any = octokit.repos.listForOrg.endpoint.merge({
    org: org,
    per_page: perPageEntries,
    type: 'all',
  });

  return await doPaginatedRequest(options);
}

export async function getTeamList(
  org: string,
  perPageEntries: number = defaultPerPage,
  octokit?: any,
) {
  log.info(
    `Getting team list for ${org} with ${perPageEntries} entries per page`,
  );

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const options: any = octokit.rest.teams.list.endpoint.merge({
    org: org,
    per_page: perPageEntries,
  });

  return await doPaginatedRequest(options);
}

export async function getUserList(
  org: string,
  perPageEntries: number = defaultPerPage,
  octokit?: any,
) {
  log.info(
    `Getting user list for ${org} with ${perPageEntries} entries per page`,
  );

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const options: any = await octokit.rest.orgs.listMembers.endpoint.merge({
    org: org,
    per_page: perPageEntries,
  });

  return await doPaginatedRequest(options);
}

export async function validateMember(
  username: string,
  org: string,
  octokit?: any,
): Promise<any> {
  log.debug(`Validating ${username} is a member of ${org}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const result = await octokit.orgs.checkMembershipForUser({
    org: org,
    username: username,
  });

  return result;
}

export async function getUserRoleInOrg(
  username: string,
  org: string,
  octokit?: any,
) {
  log.info(`Getting user ${username} role in ${org}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const membership = await octokit.orgs.getMembershipForUser({
    org: org,
    username: username,
  });

  return membership.data.role;
}

export async function getOrgInfo(org: string, octokit?: any) {
  log.info(`Getting info for org ${org}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const orgInfo: any = await octokit.orgs.get({ org });

  return orgInfo.data;
}

export async function getWebhookList(org: string, octokit?: any): Promise<any> {
  log.info(`Getting teams for org ${org}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const { data: webhooks } = await octokit.orgs.listWebhooks({
    org: org,
    per_page: 100,
  });

  return webhooks;
}

export async function getOrgTeamsDirectAccess(org: string, octokit?: any) {
  log.info(`Getting teams for org ${org}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const response = await octokit.graphql.paginate(
    `query paginate($cursor: String,  $org: String!) {
      organization(login: $org) {
        teams(first: 100, after: $cursor) {
          nodes {
            id
            name
            slug
            repositories {
              edges {
                permission
                node {
                  name
                }
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }`,
    { org },
  );

  return transformGraphQLResponse(response);
}

export function transformGraphQLResponse(response: any) {
  const teams = response?.organization?.teams?.nodes;
  if (!teams) return {};

  const result: any = {
    repositories: {},
    teams: {},
  };

  teams.forEach((team: any) => {
    const teamName = team.name;
    const teamId = team.id;

    result.teams[teamName] = { id: teamId, slug: team.slug };

    const repositories = team.repositories.edges;

    repositories.forEach((repoEdge: any) => {
      const repoName = repoEdge.node.name;
      const permission = repoEdge.permission;

      if (!result.repositories[repoName]) {
        result.repositories[repoName] = {};
      }

      result.repositories[repoName][teamName] = {
        permission,
        slug: team.slug,
      };
    });
  });

  return result;
}

export async function getOrgPlanName(org: string, octokit?: any) {
  log.info(`Getting plan for org ${org}`);

  const orgInfo: any = await getOrgInfo(org, octokit);

  return orgInfo.plan.name;
}

async function doPaginatedRequest(options: any) {
  const octokitPaginated = await getOctokitForOrg('default', true);

  return await octokitPaginated.paginate(options, {
    'Cache-Control': 'no-cache',
  });
}

export async function getOrgVariable(
  org: string,
  variableName: string,
  octokit?: any,
) {
  log.info(`Getting org variable ${variableName} for org ${org}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const response = await octokit.rest.actions.getOrgVariable({
    org,
    name: variableName,
  });

  return response.data;
}

export default {
  getRepositoryList,
  getTeamList,
  getUserList,
  validateMember,
  getUserRoleInOrg,
  getOrgInfo,
  getOrgTeamsDirectAccess,
  getOrgPlanName,
  getWebhookList,
  getOrgVariable,
};
