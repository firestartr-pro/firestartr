import { Octokit } from '@octokit/rest';
import type { OctokitOptions } from '@octokit/core';
import type { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types';
import type { PaginateInterface } from '@octokit/plugin-paginate-rest/dist-types/types';
import type { paginateGraphQLInterface } from '@octokit/plugin-paginate-graphql/dist-types/index.js';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { paginateGraphQL } from '@octokit/plugin-paginate-graphql';
import common from 'catalog_common';
import { createAppAuth } from '@octokit/auth-app';
import {
  getInstallationID,
  getInstallationIDWithConfig,
} from './auth_installation';
import log from './logger';

const REPOS_WITH_PAT = ['prefapp/features'];

// Accepts github auth config as input (profile-bound version uses config_resolver)
export const generateGithubAppToken = async (config: any) => {
  try {
    const { appId, privateKey, installationOrgId }: any = config;

    const auth = createAppAuth({
      appId: appId,
      privateKey: privateKey,
      installationId: installationOrgId,
    });

    const authOptions = await auth({
      type: 'installation',
    });

    return authOptions.token;
  } catch (error) {
    console.error('Error generating github app token', error);
    throw error;
  }
};

// Accepts config object for profile-aware usage
type GithubAuthConfig = import('./config_resolver').GithubAuthConfig;

export async function getGithubAppTokenWithConfig(
  config: GithubAuthConfig,
  genGithubAppToken: any = generateGithubAppToken,
): Promise<string> {
  if (!config.appId || !config.privateKey || !config.installationOrgId) {
    throw new Error(
      'getGithubAppTokenWithConfig: required config not supplied',
    );
  }
  const token = await genGithubAppToken({
    appId: config.appId,
    privateKey: config.privateKey,
    installationOrgId: config.installationOrgId,
  });
  return token;
}

// Legacy ambient-compat signature (remains for migration)
export async function getGithubAppToken(
  org: string,
  genGithubAppToken: any = generateGithubAppToken,
): Promise<string> {
  if (org === '') {
    throw new Error('getGithubAppToken: "org" has to be passed');
  }

  const token = await genGithubAppToken({
    appId: common.environment.getFromEnvironment(
      common.types.envVars.githubAppId,
    ),

    privateKey: common.environment.getFromEnvironment(
      common.types.envVars.githubAppPemFile,
    ),

    installationOrgId: await getInstallationID(org),
  });

  return token;
}

type ExtendedOctokit = Octokit &
  Api & {
    paginate: PaginateInterface;
  } & paginateGraphQLInterface;

export { ExtendedOctokit };

// Profile-aware version: accepts config and org
export async function getOctokitForOrgWithConfig(
  org: string,
  config: GithubAuthConfig,
  paginated = false,
  genGithubAppToken: any = generateGithubAppToken,
): Promise<ExtendedOctokit> {
  if (!config.appId || !config.privateKey) {
    throw new Error('getOctokitForOrgWithConfig: required config not supplied');
  }
  const createRepoSwitchAuth = (options: OctokitOptions) => {
    // Auth strategy factory that switches between PAT and GitHub App tokens based on the repository
    const generateTokenFromGithubApp = async () => {
      log.info(`Using GitHub App token for org ${org}`);
      let auth: string | null = null;
      const installationOrgId =
        config.installationOrgId ||
        (await getInstallationIDWithConfig(org, config));
      auth = await genGithubAppToken({
        appId: config.appId,
        privateKey: config.privateKey,
        installationOrgId,
      });
      return auth;
    };
    return {
      async hook(request, requestOptions) {
        let isRepoWithPat =
          REPOS_WITH_PAT.find((repo: string) => {
            return requestOptions.url.includes(`repos/${repo}`);
          }) !== undefined;
        if (!isRepoWithPat && 'repo' in requestOptions) {
          const checkOrg = requestOptions['owner'] || '';
          isRepoWithPat =
            REPOS_WITH_PAT.indexOf(`${checkOrg}/${requestOptions['repo']}`) !==
            -1;
        }
        log.debug(`Requested ${JSON.stringify(requestOptions)}`);
        requestOptions.headers = requestOptions.headers || {};
        if (isRepoWithPat) {
          log.info('Using GitHub PAT token');
          requestOptions.headers.authorization = `token ${config.patPrefapp}`;
        } else {
          requestOptions.headers.authorization = `token ${await generateTokenFromGithubApp()}`;
        }
        return request(requestOptions);
      },
    };
  };
  const options: OctokitOptions = { authStrategy: createRepoSwitchAuth };
  if (paginated) {
    options.plugins = [paginateRest, paginateGraphQL];
  }
  const OctokitWithGraphQL = Octokit.plugin(paginateGraphQL);
  return new OctokitWithGraphQL(options) as ExtendedOctokit;
}

// Legacy ambient-compatible version
export async function getOctokitForOrg(
  org: string,
  paginated = false,
  genGithubAppToken: any = generateGithubAppToken,
): Promise<ExtendedOctokit> {
  if (org === '') {
    throw 'getOctokitForOrg: "org" has to be passed';
  }

  const createRepoSwitchAuth = (options: OctokitOptions) => {
    // Auth strategy factory that switches between PAT and GitHub App tokens based on the repository
    const generateTokenFromGithubApp = async () => {
      log.info(`Using GitHub App token for org ${org}`);

      let auth: string | null = null;

      auth = await genGithubAppToken({
        appId: common.environment.getFromEnvironment(
          common.types.envVars.githubAppId,
        ),

        privateKey: common.environment.getFromEnvironment(
          common.types.envVars.githubAppPemFile,
        ),

        installationOrgId: await getInstallationID(org),
      });

      return auth;
    };

    return {
      async hook(request, requestOptions) {
        let isRepoWithPat =
          REPOS_WITH_PAT.find((repo: string) => {
            return requestOptions.url.includes(`repos/${repo}`);
          }) !== undefined;

        if (!isRepoWithPat && 'repo' in requestOptions) {
          const checkOrg = requestOptions['owner'] || '';

          // prefapp/features
          isRepoWithPat =
            REPOS_WITH_PAT.indexOf(`${checkOrg}/${requestOptions['repo']}`) !==
            -1;
        }

        log.debug(`Requested ${JSON.stringify(requestOptions)}`);

        requestOptions.headers = requestOptions.headers || {};

        if (isRepoWithPat) {
          log.info('Using GitHub PAT token');

          requestOptions.headers.authorization = `token ${process.env[common.types.envVars.githubAppPatPrefapp]}`;
        } else {
          requestOptions.headers.authorization = `token ${await generateTokenFromGithubApp()}`;
        }

        return request(requestOptions);
      },
    };
  };

  const options: OctokitOptions = { authStrategy: createRepoSwitchAuth };

  if (paginated) {
    options.plugins = [paginateRest, paginateGraphQL];
  }

  const OctokitWithGraphQL = Octokit.plugin(paginateGraphQL);

  return new OctokitWithGraphQL(options) as ExtendedOctokit;
}

export async function getOctokitFromPat(
  envVar: string,
): Promise<ExtendedOctokit> {
  const options = {
    auth: process.env[envVar],
    plugins: [paginateRest, paginateGraphQL],
  };

  const OctokitWithGraphQL = Octokit.plugin(paginateGraphQL);

  return new OctokitWithGraphQL(options) as ExtendedOctokit;
}

export default { getOctokitForOrg };
