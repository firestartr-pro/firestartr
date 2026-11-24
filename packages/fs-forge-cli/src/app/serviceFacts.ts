import YAML from 'yaml';

import {
  claimsRepo,
  loadClaimsMap,
  resolveClaim,
} from '../claims/claimsRepo.js';
import { getFeatureReferences } from '../utils/features.js';
import { isRecord } from '../utils/isRecord.js';

import type { GitHubApi } from '../github/api.js';
import type { AppTrack } from '../schema/appInputs.js';
import type { FeatureReference } from '../utils/features.js';
import type { FeatureSource } from '../utils/featureSource.js';

export interface OtherServiceClaimSummary {
  name: string;
  present: boolean;
  owner?: string;
  system?: string;
}

export type DiscoveredReleaseType =
  | {
      value: string;
      source: 'release-please-config';
    }
  | {
      value: string;
      source: 'proposed';
      language: string | null;
    };

export interface ServiceFacts {
  name: string;
  owner?: string;
  system?: string;
  otherServices: OtherServiceClaimSummary[];
  ownerSystemDisagreement: boolean;
  releaseType: DiscoveredReleaseType;
  tracks: Record<string, AppTrack>;
}

const LANGUAGE_TO_RELEASE_TYPE: Record<string, string> = {
  typescript: 'node',
  javascript: 'node',
  python: 'python',
  go: 'go',
  rust: 'rust',
  java: 'java',
  ruby: 'ruby',
  php: 'php',
  'c#': 'simple',
  elixir: 'elixir',
  hcl: 'terraform-module',
  terraform: 'terraform-module',
};

const FALLBACK_TRACK_FILTERS = {
  snapshot: 'dev',
  preReleases: 'pre',
  releases: 'pro',
};

function parseClaimOwnerSystem(content: string): {
  owner?: string;
  system?: string;
  features: FeatureReference[];
} {
  const parsed: unknown = YAML.parse(content);
  if (!isRecord(parsed)) return { features: [] };
  let features: FeatureReference[] = [];
  try {
    features = getFeatureReferences(parsed);
  } catch {
    features = [];
  }
  return {
    ...(typeof parsed.owner === 'string' ? { owner: parsed.owner } : {}),
    ...(typeof parsed.system === 'string' ? { system: parsed.system } : {}),
    features,
  };
}

function findFeatureArgs(
  features: FeatureReference[],
  featureName: string,
): Record<string, unknown> | undefined {
  const entry = features.find((item) => item.name === featureName);
  return entry && isRecord(entry.args) ? entry.args : undefined;
}

function parseEnvList(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

function matchesEnv(filter: Set<string>, env: string): boolean {
  return filter.has('*') || filter.has(env);
}

async function readLatestFeatureSchema(
  featureSource: FeatureSource | undefined,
  featureName: string,
): Promise<Record<string, unknown> | undefined> {
  if (!featureSource) return undefined;
  try {
    const index = await featureSource.readFeatureIndex();
    const feature = index.features.find((entry) => entry.name === featureName);
    if (!feature) return undefined;
    return await featureSource.readFeatureSchema(featureName, feature.version);
  } catch {
    return undefined;
  }
}

function extractSchemaProperties(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  if (isRecord(schema.properties)) {
    const argsProp = schema.properties.args;
    if (isRecord(argsProp) && isRecord(argsProp.properties)) {
      return argsProp.properties;
    }
    return schema.properties;
  }
  return undefined;
}

function extractReleaseTypeEnum(
  schema: Record<string, unknown> | undefined,
): Set<string> | undefined {
  const props = extractSchemaProperties(schema);
  if (!props || !isRecord(props.release_type)) return undefined;
  const values = props.release_type.enum;
  if (!Array.isArray(values)) return undefined;
  const strings = values.filter((v): v is string => typeof v === 'string');
  return strings.length > 0 ? new Set(strings) : undefined;
}

function extractFeatureDefault(
  props: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const entry = props?.[key];
  if (!isRecord(entry)) return undefined;
  return typeof entry.default === 'string' ? entry.default : undefined;
}

function readReleasePleaseConfigType(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (
    typeof parsed['release-type'] === 'string' &&
    parsed['release-type'].length > 0
  ) {
    return parsed['release-type'];
  }
  if (isRecord(parsed.packages) && isRecord(parsed.packages['.'])) {
    const rootType = parsed.packages['.']['release-type'];
    if (typeof rootType === 'string' && rootType.length > 0) {
      return rootType;
    }
  }
  return undefined;
}

async function resolveReleaseType(
  api: GitHubApi,
  org: string,
  service: string,
  featureSource?: FeatureSource,
): Promise<DiscoveredReleaseType> {
  const serviceRef = { owner: org, repo: service };
  const configFile = await api.readFile(
    serviceRef,
    'release-please-config.json',
  );
  if (configFile) {
    const configured = readReleasePleaseConfigType(configFile.content);
    if (configured) {
      return { value: configured, source: 'release-please-config' };
    }
  }

  const language = await api.getPrimaryLanguage(serviceRef);
  const mapped =
    language !== null
      ? (LANGUAGE_TO_RELEASE_TYPE[language.toLowerCase()] ?? 'simple')
      : 'simple';

  const schema = await readLatestFeatureSchema(featureSource, 'release_please');
  const allowed = extractReleaseTypeEnum(schema);
  const constrained = allowed && !allowed.has(mapped) ? 'simple' : mapped;

  return {
    value: constrained,
    source: 'proposed',
    language,
  };
}

async function resolveTracks(
  features: FeatureReference[],
  candidateEnvs: string[],
  featureSource?: FeatureSource,
): Promise<Record<string, AppTrack>> {
  const args = findFeatureArgs(features, 'build_and_dispatch_docker_images');

  let snapshotRaw =
    typeof args?.trigger_filter_by_env_snapshot === 'string'
      ? args.trigger_filter_by_env_snapshot
      : undefined;
  let preReleasesRaw =
    typeof args?.trigger_filter_by_env_pre_releases === 'string'
      ? args.trigger_filter_by_env_pre_releases
      : undefined;
  let releasesRaw =
    typeof args?.trigger_filter_by_env_releases === 'string'
      ? args.trigger_filter_by_env_releases
      : undefined;

  if (
    snapshotRaw === undefined ||
    preReleasesRaw === undefined ||
    releasesRaw === undefined
  ) {
    const schema = await readLatestFeatureSchema(
      featureSource,
      'build_and_dispatch_docker_images',
    );
    const props = extractSchemaProperties(schema);
    snapshotRaw ??=
      extractFeatureDefault(props, 'trigger_filter_by_env_snapshot') ??
      FALLBACK_TRACK_FILTERS.snapshot;
    preReleasesRaw ??=
      extractFeatureDefault(props, 'trigger_filter_by_env_pre_releases') ??
      FALLBACK_TRACK_FILTERS.preReleases;
    releasesRaw ??=
      extractFeatureDefault(props, 'trigger_filter_by_env_releases') ??
      FALLBACK_TRACK_FILTERS.releases;
  }

  const releasesEnvs = parseEnvList(releasesRaw);
  const preReleasesEnvs = parseEnvList(preReleasesRaw);
  // Note: snapshot filter is the fallback track; releases > pre-releases > snapshots.
  void parseEnvList(snapshotRaw);

  const tracks: Record<string, AppTrack> = {};
  for (const env of candidateEnvs) {
    if (matchesEnv(releasesEnvs, env)) {
      tracks[env] = 'releases';
    } else if (matchesEnv(preReleasesEnvs, env)) {
      tracks[env] = 'pre-releases';
    } else {
      tracks[env] = 'snapshots';
    }
  }
  return tracks;
}

export async function readServiceFacts(
  api: GitHubApi,
  options: {
    org: string;
    claimsRepoName: string;
    service: string;
    serviceRepoOwner?: string;
    appServices: string[];
    candidateEnvs: string[];
    featureSource?: FeatureSource;
  },
): Promise<ServiceFacts> {
  const {
    org,
    claimsRepoName,
    service,
    serviceRepoOwner,
    appServices,
    candidateEnvs,
    featureSource,
  } = options;

  const repo = claimsRepo(api, org, claimsRepoName);
  const map = await loadClaimsMap(repo);

  const primaryRef = `component-${service}`;
  if (!map.claims[primaryRef]) {
    throw new Error(`Service claim not found: ${primaryRef}`);
  }
  const primaryFile = await resolveClaim(repo, map, primaryRef);
  const primary = parseClaimOwnerSystem(primaryFile.content);

  const otherNames = appServices.filter((name) => name !== service);
  const otherServices: OtherServiceClaimSummary[] = await Promise.all(
    otherNames.map(async (name) => {
      const ref = `component-${name}`;
      if (!map.claims[ref]) {
        return { name, present: false };
      }
      const file = await resolveClaim(repo, map, ref);
      const parsed = parseClaimOwnerSystem(file.content);
      return {
        name,
        present: true,
        ...(parsed.owner !== undefined ? { owner: parsed.owner } : {}),
        ...(parsed.system !== undefined ? { system: parsed.system } : {}),
      };
    }),
  );

  const ownerSystemDisagreement = otherServices.some(
    (other) =>
      other.present &&
      (other.owner !== primary.owner || other.system !== primary.system),
  );

  const [releaseType, tracks] = await Promise.all([
    resolveReleaseType(api, serviceRepoOwner ?? org, service, featureSource),
    resolveTracks(primary.features, candidateEnvs, featureSource),
  ]);

  return {
    name: service,
    ...(primary.owner !== undefined ? { owner: primary.owner } : {}),
    ...(primary.system !== undefined ? { system: primary.system } : {}),
    otherServices,
    ownerSystemDisagreement,
    releaseType,
    tracks,
  };
}
