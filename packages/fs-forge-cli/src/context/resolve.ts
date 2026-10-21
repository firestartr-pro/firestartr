import { homedir } from 'os';

import { loadContextConfig, contextConfigPath } from './config.js';
import { matchOrganization } from './match.js';

import type { ContextConfig, OrganizationConfig } from './config.js';
import type { RepoRef } from '../github/api.js';

export type ContextSource = 'config' | 'flag' | 'env';

/** Stable codes for the ways the context cannot be resolved. */
export type ContextErrorCode =
  | 'NO_CONFIG'
  | 'NO_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'NO_AUTH';

export class ContextError extends Error {
  readonly code: ContextErrorCode;

  constructor(code: ContextErrorCode, message: string) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
  }
}

export interface OrganizationContext {
  org: string;
  source: ContextSource;
  /** The `~`-collapsed config path that matched, `null` for flag/env orgs. */
  matchedPath: string | null;
  /** The config entry for the org, when the config declares it. */
  organization?: OrganizationConfig;
  /** The config's shared `cli_version` pin, when a config loaded. */
  cliVersion?: string;
}

export interface ResolveContextOptions {
  /** The `--org` flag value, which outranks the environment and the config. */
  flag?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  configPath?: string;
}

export interface ContextRepos {
  claims: string;
  stateGithub: string;
  stateInfra: string;
  catalog: string;
}

export type ContextResolution =
  | { ok: true; context: OrganizationContext }
  | { ok: false; error: ContextError };

/**
 * The effective organization: the `--org` flag, then `FSCRT_ORG`, then the
 * config path matching the current directory. Throws a `ContextError` when
 * none resolves.
 */
export function resolveOrganization(
  options: ResolveContextOptions = {},
): OrganizationContext {
  const resolution = resolveContext(options);
  if (resolution.ok) return resolution.context;
  throw resolution.error;
}

/** The org the `--org` flag defaults to, or `undefined` when none resolves. */
export function orgFromContext(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const resolution = resolveContext({ env });
  return resolution.ok ? resolution.context.org : undefined;
}

export function resolveContext(
  options: ResolveContextOptions = {},
): ContextResolution {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const configPath = options.configPath ?? contextConfigPath(env);
  const config = loadContextConfig(configPath);

  if (options.flag) {
    return { ok: true, context: fromName(options.flag, 'flag', config) };
  }
  const fromEnv = env.FSCRT_ORG;
  if (fromEnv) {
    return { ok: true, context: fromName(fromEnv, 'env', config) };
  }
  if (!config) {
    return {
      ok: false,
      error: new ContextError(
        'NO_CONFIG',
        `no usable fs-forge config at ${configPath}: expected top-level organizations[] entries with name and paths`,
      ),
    };
  }

  const match = matchOrganization(config.organizations, cwd, home);
  if (match.kind === 'no-match') {
    const registered = config.organizations
      .map((entry) => entry.name)
      .join(', ');
    return {
      ok: false,
      error: new ContextError(
        'NO_MATCH',
        `${cwd} matches none of the configured paths (registered organizations: ${registered})`,
      ),
    };
  }
  if (match.kind === 'ambiguous') {
    const owners = match.organizations.map((entry) => entry.name).join(', ');
    return {
      ok: false,
      error: new ContextError(
        'AMBIGUOUS_MATCH',
        `${match.matchedPath} is claimed by ${owners}; remove it from all but one organization`,
      ),
    };
  }
  return {
    ok: true,
    context: {
      org: match.organization.name,
      source: 'config',
      matchedPath: match.matchedPath,
      organization: match.organization,
      cliVersion: config.cli_version,
    },
  };
}

/** Repository defaults for an already resolved org, including its config entry. */
export function reposForOrganization(org: string): ContextRepos {
  return contextRepos(resolveOrganization({ flag: org }));
}

export function contextRepos({
  org,
  organization,
}: Pick<OrganizationContext, 'org' | 'organization'>): ContextRepos {
  const qualify = (repo: string): string =>
    repo.includes('/') ? repo : `${org}/${repo}`;
  return {
    claims: qualify(organization?.claims_repo ?? 'claims'),
    stateGithub: qualify(organization?.state_github_repo ?? 'state-github'),
    stateInfra: qualify(organization?.state_infra_repo ?? 'state-infra'),
    catalog: qualify(organization?.catalog_repo ?? 'catalog'),
  };
}

export function parseStateRepos(
  stateReposFlag: string | undefined,
  org: string,
): string[] {
  if (!stateReposFlag) {
    const repos = reposForOrganization(org);
    return [repos.stateGithub, repos.stateInfra];
  }
  return stateReposFlag.split(',').map((repo) => repo.trim());
}

export function resolveClaimsRepository(
  org: string,
  repoName?: string,
): RepoRef {
  if (repoName !== undefined) return { owner: org, repo: repoName };
  const slug = reposForOrganization(org).claims;
  const parts = slug.split('/');
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new Error(`Invalid claims repository: ${slug}; expected owner/repo`);
  }
  const [owner, repo] = parts;
  return { owner, repo };
}

function fromName(
  org: string,
  source: ContextSource,
  config: ContextConfig | undefined,
): OrganizationContext {
  const organization = config?.organizations.find(
    (entry) => entry.name.toLowerCase() === org.toLowerCase(),
  );
  const context: OrganizationContext = { org, source, matchedPath: null };
  if (organization) context.organization = organization;
  if (config?.cli_version) context.cliVersion = config.cli_version;
  return context;
}
