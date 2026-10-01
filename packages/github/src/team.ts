import { getOctokitForOrg } from './auth';

import log from './logger';

export async function getTeamMembers(team: string, org: string, octokit?: any) {
  log.info(`Getting members for ${org}/${team}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const res = await octokit.rest.teams.listMembersInOrg({
    org: org,
    team_slug: team,
  });
  return res['data'];
}

export async function getTeamInfo(team: string, org: string, octokit?: any) {
  log.info(`Getting info for ${org}/${team}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  try {
    const res = await octokit.rest.teams.getByName({
      org: org,
      team_slug: team,
    });
    return res['data'];
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const message = err instanceof Error ? err.message : String(err);
    const error = new Error(
      `Error getting GitHub team "${team}" in org "${org}": ${message}`,
    );

    if (status) {
      (error as any).status = status;
    }

    throw error;
  }
}

export async function getTeamRoleUser(
  org: string,
  team: string,
  username: string,
  octokit?: any,
) {
  log.info(`Getting role for ${username} in ${org}/${team}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  const res = await octokit.rest.teams.getMembershipForUserInOrg({
    org: org,
    team_slug: team,
    username: username,
  });

  return res['data'];
}

export async function create(
  org: string,
  team: string,
  privacy: 'secret' | 'closed' = 'closed',
  octokit?: any,
): Promise<any> {
  log.info(`Creating team ${org}/${team}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  return await octokit.rest.teams.create({
    org: org,
    name: team,
    privacy: privacy,
  });
}

export async function addOrUpdateMember(
  org: string,
  team: string,
  username: string,
  role: 'member' | 'maintainer' = 'member',
  octokit?: any,
): Promise<any> {
  log.info(
    `Adding or updating ${username} in ${org}/${team} with role ${role}`,
  );

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  return await octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
    org: org,
    team_slug: team,
    username: username,
    role: role,
  });
}

export async function removeMember(
  org: string,
  team: string,
  username: string,
  octokit?: any,
): Promise<any> {
  log.info(`Removing ${username} from ${org}/${team}`);

  if (!octokit) {
    octokit = await getOctokitForOrg(org);
  }

  return await octokit.teams.removeMembershipForUserInOrg({
    org: org,
    team_slug: team,
    username: username,
  });
}

export default {
  getTeamMembers,
  getTeamInfo,
  getTeamRoleUser,
  create,
  addOrUpdateMember,
  removeMember,
};
