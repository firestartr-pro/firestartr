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
  service_names?: string[];
}

export type DiscoveredAppConfig =
  | {
      present: true;
      state_repo?: string;
      services: DiscoveredAppService[];
    }
  | {
      present: false;
    };

export interface DotFirestartrFacts {
  present: boolean;
  platforms: DiscoveredPlatform[];
  registries: DiscoveredRegistry[];
  appConfig: DiscoveredAppConfig;
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

function parsePlatform(
  filePath: string,
  content: string,
): DiscoveredPlatform | null {
  const parsed: unknown = YAML.parse(content);
  if (!isRecord(parsed)) return null;
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
): DiscoveredRegistry | null {
  const parsed: unknown = YAML.parse(content);
  if (!isRecord(parsed)) return null;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : stemName(filePath),
    default: parsed.default === true,
    image_types: asStringArray(parsed.image_types),
    auth_strategy:
      typeof parsed.auth_strategy === 'string' ? parsed.auth_strategy : '',
    base_paths: parseBasePaths(parsed.base_paths),
  };
}

function parseAppService(entry: unknown): DiscoveredAppService | null {
  if (typeof entry === 'string') {
    return { name: entry };
  }
  if (!isRecord(entry)) return null;
  const name =
    (typeof entry.name === 'string' && entry.name) ||
    (typeof entry.repo === 'string' && entry.repo) ||
    (typeof entry.component === 'string' && entry.component) ||
    '';
  if (!name) return null;
  const serviceNames = asStringArray(entry.service_names);
  return serviceNames.length > 0
    ? { name, service_names: serviceNames }
    : { name };
}

function parseAppConfig(content: string): DiscoveredAppConfig {
  const parsed: unknown = YAML.parse(content);
  if (!isRecord(parsed)) {
    return { present: true, services: [] };
  }
  const services = Array.isArray(parsed.services)
    ? parsed.services
        .map(parseAppService)
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

  const platforms = platformFiles
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => parsePlatform(f.path, f.content))
    .filter((p): p is DiscoveredPlatform => p !== null);

  const registries = registryFiles
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .map((f) => parseRegistry(f.path, f.content))
    .filter((r): r is DiscoveredRegistry => r !== null);

  const appFile = appFileYaml ?? appFileYml;
  const appConfig: DiscoveredAppConfig = appFile
    ? parseAppConfig(appFile.content)
    : { present: false };

  return {
    present: true,
    platforms,
    registries,
    appConfig,
  };
}
