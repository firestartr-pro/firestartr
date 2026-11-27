import { basename } from 'path';
import YAML from 'yaml';

import { isNotFoundError } from '../github/api.js';
import { isRecord } from '../utils/isRecord.js';

import type { GitHubApi } from '../github/api.js';

export interface DiscoveredPlatform {
  name: string;
  type: string;
  tenants: string[];
  envs: string[];
}

export interface DiscoveredRegistry {
  name: string;
  default: boolean;
  image_types: string[];
  auth_strategy: string;
  base_paths: Record<string, string> | string[];
}

export interface DiscoveredAppService {
  name: string;
  repo: string;
  service_names: string[];
  platforms?: string[];
}

export interface YamlParseError {
  path: string;
  error: string;
}

export type DiscoveredAppConfig =
  | {
      present: true;
      malformed?: false;
      state_repo?: string;
      services: DiscoveredAppService[];
    }
  | {
      present: true;
      malformed: true;
      error: string;
      services: [];
    }
  | {
      present: false;
    };

export interface DotFirestartrFacts {
  present: boolean;
  platforms: DiscoveredPlatform[];
  registries: DiscoveredRegistry[];
  appConfig: DiscoveredAppConfig;
  errors: YamlParseError[];
}

export function parseRepoSlug(
  repo: string,
  defaultOrg: string,
): { owner: string; name: string } {
  const slash = repo.lastIndexOf('/');
  if (slash > 0 && slash < repo.length - 1) {
    return {
      owner: repo.slice(0, slash),
      name: repo.slice(slash + 1),
    };
  }
  return { owner: defaultOrg, name: repo };
}

function isYamlPath(path: string): boolean {
  return path.endsWith('.yaml') || path.endsWith('.yml');
}

function stemName(filePath: string): string {
  return basename(filePath).replace(/\.ya?ml$/, '');
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function formatParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}

function parseYamlRecord(
  filePath: string,
  content: string,
  errors: YamlParseError[],
): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (error) {
    errors.push({ path: filePath, error: formatParseError(error) });
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function parsePlatform(
  filePath: string,
  content: string,
  errors: YamlParseError[],
): DiscoveredPlatform | null {
  const parsed = parseYamlRecord(filePath, content, errors);
  if (!parsed) return null;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : stemName(filePath),
    type: typeof parsed.type === 'string' ? parsed.type : '',
    tenants: asStringArray(parsed.tenants),
    envs: asStringArray(parsed.envs),
  };
}

function parseBasePaths(value: unknown): Record<string, string> | string[] {
  if (Array.isArray(value)) {
    return asStringArray(value);
  }
  if (isRecord(value)) {
    const record: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') record[key] = entry;
    }
    return record;
  }
  return {};
}

function parseRegistry(
  filePath: string,
  content: string,
  errors: YamlParseError[],
): DiscoveredRegistry | null {
  const parsed = parseYamlRecord(filePath, content, errors);
  if (!parsed) return null;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : stemName(filePath),
    default: parsed.default === true,
    image_types: asStringArray(parsed.image_types),
    auth_strategy:
      typeof parsed.auth_strategy === 'string' ? parsed.auth_strategy : '',
    base_paths: parseBasePaths(parsed.base_paths),
  };
}

function parseAppService(
  entry: unknown,
  defaultOrg: string,
): DiscoveredAppService | null {
  if (!isRecord(entry) || typeof entry.repo !== 'string' || !entry.repo) {
    return null;
  }
  const { name } = parseRepoSlug(entry.repo, defaultOrg);
  if (!name) return null;
  const serviceNames = asStringArray(entry.service_names);
  const platforms = asStringArray(entry.platforms);
  return {
    name,
    repo: entry.repo,
    service_names: serviceNames,
    ...(platforms.length > 0 ? { platforms } : {}),
  };
}

function parseAppConfig(
  filePath: string,
  content: string,
  defaultOrg: string,
  errors: YamlParseError[],
): DiscoveredAppConfig {
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (error) {
    const formatted = formatParseError(error);
    errors.push({ path: filePath, error: formatted });
    return { present: true, malformed: true, error: formatted, services: [] };
  }
  if (!isRecord(parsed)) {
    return { present: true, services: [] };
  }
  const services = Array.isArray(parsed.services)
    ? parsed.services
        .map((entry) => parseAppService(entry, defaultOrg))
        .filter((item): item is DiscoveredAppService => item !== null)
    : [];
  const config: DiscoveredAppConfig = { present: true, services };
  if (typeof parsed.state_repo === 'string') {
    config.state_repo = parsed.state_repo;
  }
  return config;
}

export async function readDotFirestartr(
  api: GitHubApi,
  org: string,
  app: string,
): Promise<DotFirestartrFacts> {
  const ref = { owner: org, repo: '.firestartr' };
  const exists = await api.repoExists(ref);
  if (!exists) {
    return {
      present: false,
      platforms: [],
      registries: [],
      appConfig: { present: false },
      errors: [],
    };
  }

  let branch: string;
  let paths: string[];
  try {
    branch = await api.getDefaultBranch(ref);
    paths = await api.listBlobPaths(ref, branch);
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        present: false,
        platforms: [],
        registries: [],
        appConfig: { present: false },
        errors: [],
      };
    }
    throw error;
  }

  const platformPaths = paths
    .filter((p) => p.startsWith('platforms/') && isYamlPath(p))
    .sort();
  const registryPaths = paths
    .filter((p) => p.startsWith('docker_registries/') && isYamlPath(p))
    .sort();

  const [platformFiles, registryFiles, appFileYaml, appFileYml] =
    await Promise.all([
      Promise.all(platformPaths.map((p) => api.readFile(ref, p, branch))),
      Promise.all(registryPaths.map((p) => api.readFile(ref, p, branch))),
      api.readFile(ref, `apps/${app}.yaml`, branch),
      api.readFile(ref, `apps/${app}.yml`, branch),
    ]);

  const errors: YamlParseError[] = [];

  const platforms = platformFiles
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => parsePlatform(f.path, f.content, errors))
    .filter((p): p is DiscoveredPlatform => p !== null);

  const registries = registryFiles
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => parseRegistry(f.path, f.content, errors))
    .filter((r): r is DiscoveredRegistry => r !== null);

  const appFile = appFileYaml ?? appFileYml;
  const appConfig: DiscoveredAppConfig = appFile
    ? parseAppConfig(appFile.path, appFile.content, org, errors)
    : { present: false };

  return {
    present: true,
    platforms,
    registries,
    appConfig,
    errors,
  };
}
