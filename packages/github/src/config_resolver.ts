// Github auth config resolver for snapshot/ambient profile integration
import { getProfile } from './profile';
import common from 'catalog_common';

export interface GithubAuthConfig {
  appId: string;
  privateKey: string;
  installationOrgId?: number;
  org?: string;
  patPrefapp?: string;
}
export function resolveGithubConfigFromProfile(
  profileName: string,
): GithubAuthConfig {
  const profile = getProfile(profileName);
  if (!profile) {
    throw new Error(`No github auth profile found for name: ${profileName}`);
  }
  if (profile.type === 'ambient') {
    // Always use current env via catalog_common helpers
    return {
      appId: common.environment.getFromEnvironment(
        common.types.envVars.githubAppId,
      ),
      privateKey: common.environment.getFromEnvironment(
        common.types.envVars.githubAppPemFile,
      ),
      installationOrgId: undefined, // set as needed in higher layer
      org: common.environment.getFromEnvironmentWithDefault(
        common.types.envVars.org,
      ),
      patPrefapp: process.env[common.types.envVars.githubAppPatPrefapp] || '',
    };
  } else if (profile.type === 'snapshot') {
    const cfg = profile.config!;
    return {
      appId: cfg.GITHUB_APP_ID,
      privateKey: cfg.GITHUB_APP_PEM_FILE,
      installationOrgId: undefined, // set as needed in higher layer
      org: cfg.ORG,
      patPrefapp: cfg.PREFAPP_BOT_PAT,
    };
  }
  throw new Error(`Profile type not recognized for ${profileName}`);
}
