import { readFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import YAML from 'yaml';

/** One `organizations[]` entry of the fs-forge config file. */
export interface OrganizationConfig {
  name: string;
  paths: string[];
  claims_repo?: string;
  state_github_repo?: string;
  state_infra_repo?: string;
  catalog_repo?: string;
}

/** The fs-forge config file: `organizations[]` plus a shared `cli_version` pin. */
export interface ContextConfig {
  organizations: OrganizationConfig[];
  cli_version?: string;
}

const REPO_FIELDS = [
  'claims_repo',
  'state_github_repo',
  'state_infra_repo',
  'catalog_repo',
] as const;

/**
 * `$FS_FORGE_CONFIG`, else `$XDG_CONFIG_HOME/fs-forge/config.yaml`, else
 * `~/.config/fs-forge/config.yaml`.
 */
export function contextConfigPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.FS_FORGE_CONFIG) return env.FS_FORGE_CONFIG;
  const configHome =
    env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config');
  return join(configHome, 'fs-forge', 'config.yaml');
}

/**
 * Undefined when the file is missing, unreadable, malformed, or does not match
 * the schema (the old single `organization: {name}` shape included).
 */
export function loadContextConfig(
  path: string = contextConfigPath(),
): ContextConfig | undefined {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  return parseContextConfig(content);
}

function parseContextConfig(content: string): ContextConfig | undefined {
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const organizations = parsed.organizations;
  if (!Array.isArray(organizations) || organizations.length === 0) {
    return undefined;
  }
  const entries: OrganizationConfig[] = [];
  const names = new Set<string>();
  for (const value of organizations) {
    const entry = parseOrganization(value);
    if (!entry || names.has(entry.name)) return undefined;
    names.add(entry.name);
    entries.push(entry);
  }
  const cliVersion = parsed.cli_version;
  if (cliVersion === undefined) return { organizations: entries };
  if (typeof cliVersion !== 'string' || !cliVersion) return undefined;
  return { organizations: entries, cli_version: cliVersion };
}

function parseOrganization(value: unknown): OrganizationConfig | undefined {
  if (!isRecord(value)) return undefined;
  const name = value.name;
  if (typeof name !== 'string' || !name) return undefined;
  const paths = value.paths;
  if (!Array.isArray(paths) || paths.length === 0) return undefined;
  if (
    !paths.every(
      (path) =>
        typeof path === 'string' &&
        (isAbsolute(path) ||
          path === '~' ||
          path.startsWith('~/') ||
          path.startsWith('~\\')),
    )
  ) {
    return undefined;
  }
  const organization: OrganizationConfig = { name, paths: paths as string[] };
  for (const field of REPO_FIELDS) {
    const repo = value[field];
    if (repo === undefined) continue;
    if (typeof repo !== 'string' || !repo) return undefined;
    organization[field] = repo;
  }
  return organization;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
