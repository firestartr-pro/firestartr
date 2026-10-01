// Allowed path names for our PATH_VARIABLES list, if accessed within
// our getPath() and setPath() functions
export type AllowedPathNames =
  | 'initializers'
  | 'globals'
  | 'crs'
  | 'claims'
  | 'claimsDefaults'
  | 'domains'
  | 'systems'
  | '.github';

// List of currently set path variables for each entity type
const __PATH_VARIABLES: any = {};
const __EXCLUDED_PATHS: string[] = [];

let repositoryUrl: string | undefined;
let defaultBranch = 'main';

export function setRepositoryUrl(url: string | undefined) {
  repositoryUrl = url;
}

export function getRepositoryUrl(): string | undefined {
  return repositoryUrl;
}

export function setDefaultBranch(branch: string) {
  defaultBranch = branch;
}

export function getDefaultBranch(): string {
  return defaultBranch;
}

export function setExcludedPaths(excludedPaths: string[]) {
  __EXCLUDED_PATHS.length = 0;
  for (const path of excludedPaths) {
    __EXCLUDED_PATHS.push(path);
  }
}

export function getAdditionalPaths() {
  return __EXCLUDED_PATHS;
}

export function getPath(pathName: AllowedPathNames) {
  const path: string = __PATH_VARIABLES[pathName];
  if (!path) throw new Error(`${pathName} path not set`);
  return path;
}

export function setPath(pathName: AllowedPathNames, pathValue: string) {
  __PATH_VARIABLES[pathName] = pathValue;
}

let renamesEnabled = false;

export function getRenamesEnabled() {
  return renamesEnabled;
}
export function setRenamesEnabled(enabled: boolean) {
  renamesEnabled = enabled;
}

export enum AllowedProviders {
  all = 'all',
  github = 'github',
  az = 'az',
  terraform = 'terraform',
  catalog = 'catalog',
  argocd = 'argocd',
  externalSecrets = 'externalSecrets',
}

let configuredProvider: AllowedProviders | null = null;

export function configureProvider(provider: AllowedProviders) {
  if (configuredProvider)
    throw new ConfigError(
      'Provider already configured',
      `Provider ${configuredProvider} already configured`,
    );

  configuredProvider = provider;
}

export function reconfigureProvider(provider: AllowedProviders) {
  configuredProvider = provider;
}

class ConfigError extends Error {
  constructor(errorType: string, message: string) {
    super(`${errorType}: ${message}`);
  }
}

export function getSelectedKindClaimCrMap(
  provider: string = getConfiguredProvider().toString(),
) {
  return PROVIDER_CLAIM_CR_MAP[provider.toString()];
}

export function getConfiguredProvider() {
  if (!configuredProvider)
    throw new ConfigError(
      'Provider config error',
      'No provider configured, please call configureProvider()',
    );

  return configuredProvider;
}

const PROVIDER_CLAIM_CR_MAP: { [key: string]: any } = {
  [AllowedProviders.github.toString()]: {
    GroupClaim: 'FirestartrGithubGroup',

    UserClaim: 'FirestartrGithubMembership',

    ComponentClaim: 'FirestartrGithubRepository',
  },

  [AllowedProviders.catalog.toString()]: {
    GroupClaim: 'Group',

    UserClaim: 'User',

    ComponentClaim: 'Component',
  },
};
