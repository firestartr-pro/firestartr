import { getOctokitForOrg } from './auth';

import log from './logger';

export async function getUserInfo(name: string, octokit?: any): Promise<any> {
  log.info(`Getting user ${name} info`);

  if (!octokit) {
    octokit = await getOctokitForOrg(name);
  }

  return await octokit.users.getByUsername({ username: name });
}

export default {
  getUserInfo,
};
