import common from 'catalog_common';
import { createAppAuth } from '@octokit/auth-app';
import { request } from '@octokit/request';

// Profile-aware version: accepts auth config
export async function getInstallationIDWithConfig(org: string, config: any) {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    request,
  });

  const fetchInstallationId = async (targetOrg: string) => {
    const response = await request(`GET /orgs/${targetOrg}/installation`, {
      org: targetOrg,
      request: { hook: auth.hook },
    });
    return response.data.id;
  };

  if ((await checkIfInstalledForOrgWithConfig(org, config)) !== true) {
    if (config.org && config.org !== org) {
      return await fetchInstallationId(config.org);
    }
    throw new Error(
      `GitHub App is not installed for org "${org}" and no fallback org is configured`,
    );
  }

  return await fetchInstallationId(org);
}

async function checkIfInstalledForOrgWithConfig(
  org: string,
  config: any,
): Promise<boolean> {
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    request,
  });

  const { data: installations } = await request('GET /app/installations', {
    request: {
      hook: auth.hook,
    },
  });

  const installation = installations.find(
    (installation: any) => installation.account.login === org,
  );

  return installation !== undefined;
}

// Legacy version, ambient env
export async function getInstallationID(org = 'default') {
  const auth = createAppAuth({
    appId: common.environment.getFromEnvironment(
      common.types.envVars.githubAppId,
    ),
    privateKey: common.environment.getFromEnvironment(
      common.types.envVars.githubAppPemFile,
    ),
    request,
  });

  if ((await checkIfInstalledForOrg(org)) !== true) {
    // there is no installation for the org requested
    // we use the default org
    org = common.environment.getFromEnvironmentWithDefault(
      common.types.envVars.org,
    );
  }

  const response = await request(`GET /orgs/${org}/installation`, {
    org,

    request: {
      hook: auth.hook,
    },
  });

  return response.data.id;
}

export async function checkIfInstalledForOrg(org = 'default') {
  const auth = createAppAuth({
    appId: common.environment.getFromEnvironment(
      common.types.envVars.githubAppId,
    ),
    privateKey: common.environment.getFromEnvironment(
      common.types.envVars.githubAppPemFile,
    ),
    request,
  });

  const { data: installations } = await request('GET /app/installations', {
    request: {
      hook: auth.hook,
    },
  });

  const installation = installations.find(
    (installation: any) => installation.account.login === org,
  );

  return installation !== undefined;
}
