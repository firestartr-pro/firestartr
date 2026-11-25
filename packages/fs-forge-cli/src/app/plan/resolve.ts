import YAML from 'yaml';

import { claimExists } from '../../claims/claimsMap.js';
import {
  claimsRepo,
  loadClaimsMap,
  resolveClaim,
} from '../../claims/claimsRepo.js';
import { isNotFoundError } from '../../github/api.js';
import { getFeatureReferences } from '../../utils/features.js';
import { isRecord } from '../../utils/isRecord.js';
import { parseRepoSlug, readDotFirestartr } from '../dotFirestartr.js';

import type {
  ExistingNamedFile,
  ExistingStateAppClaim,
  ResolvedPlanContext,
} from './types.js';
import type { GitHubApi, RepoRef } from '../../github/api.js';
import type { AppInputs } from '../../schema/appInputs.js';
import type { FeatureSource } from '../../utils/featureSource.js';
import type {
  DefaultTrackFilters,
  ServiceClaimDefaults,
} from '../render/index.js';

const BUILD_DISPATCH_FEATURE = 'build_and_dispatch_docker_images';
const RELEASE_PLEASE_FEATURE = 'release_please';
const STATE_REPO_APPS_FEATURE = 'state_repo_apps';

const FALLBACK_TRACK_FILTERS: DefaultTrackFilters = {
  snapshot: 'dev',
  preReleases: 'pre',
  releases: 'pro',
};

export interface ResolvePlanOptions {
  api: GitHubApi;
  featureSource: FeatureSource;
  inputs: AppInputs;
  /** Org override (from `--org` flag or context resolution). */
  org?: string;
  claimsRepoName?: string;
}

function parseMajorVersion(version: string, featureName: string): number {
  const match = /^v?(\d+)/.exec(version.trim());
  if (!match) {
    throw new Error(
      `Cannot parse major version for feature "${featureName}" from "${version}"`,
    );
  }
  return Number(match[1]);
}

function extractDefaultFilters(
  schema: Record<string, unknown>,
): DefaultTrackFilters {
  const props = isRecord(schema.properties) ? schema.properties : undefined;
  const readDefault = (key: string, fallback: string): string => {
    const rawProp = props?.[key];
    if (isRecord(rawProp) && typeof rawProp.default === 'string') {
      return rawProp.default;
    }
    return fallback;
  };
  return {
    snapshot: readDefault(
      'trigger_filter_by_env_snapshot',
      FALLBACK_TRACK_FILTERS.snapshot,
    ),
    preReleases: readDefault(
      'trigger_filter_by_env_pre_releases',
      FALLBACK_TRACK_FILTERS.preReleases,
    ),
    releases: readDefault(
      'trigger_filter_by_env_releases',
      FALLBACK_TRACK_FILTERS.releases,
    ),
  };
}

function parseServiceClaimDefaults(
  content: string,
  fallbackOrg: string,
): ServiceClaimDefaults {
  const parsed: unknown = YAML.parse(content);
  if (!isRecord(parsed)) {
    return { githubOrg: fallbackOrg };
  }
  const providers = isRecord(parsed.providers) ? parsed.providers : undefined;
  const github =
    providers && isRecord(providers.github) ? providers.github : undefined;
  const githubOrg =
    github && typeof github.org === 'string' && github.org.length > 0
      ? github.org
      : fallbackOrg;

  return {
    ...(typeof parsed.owner === 'string' ? { owner: parsed.owner } : {}),
    ...(typeof parsed.system === 'string' ? { system: parsed.system } : {}),
    githubOrg,
  };
}

function isStateRepoComponentClaim(content: string): boolean {
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || parsed.kind !== 'ComponentClaim') return false;
  try {
    const features = getFeatureReferences(parsed);
    return features.some((f) => f.name === STATE_REPO_APPS_FEATURE);
  } catch {
    return false;
  }
}

async function readFileFromDefaultBranch(
  api: GitHubApi,
  ref: RepoRef,
  path: string,
): Promise<string | undefined> {
  let defaultBranch: string;
  try {
    defaultBranch = await api.getDefaultBranch(ref);
  } catch (error) {
    if (isNotFoundError(error)) return undefined;
    throw error;
  }
  const file = await api.readFile(ref, path, defaultBranch);
  return file?.content;
}

async function readExistingArgocdFiles(
  api: GitHubApi,
  org: string,
  app: string,
): Promise<{
  applicationSet?: ExistingNamedFile;
  appProject?: ExistingNamedFile;
}> {
  const ref: RepoRef = { owner: org, repo: 'state-argocd' };
  let defaultBranch: string;
  try {
    defaultBranch = await api.getDefaultBranch(ref);
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }

  let paths: string[];
  try {
    paths = await api.listBlobPaths(ref, defaultBranch);
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }

  const prefix = `apps/${app}/`;
  const yamlPaths = paths
    .filter(
      (p) =>
        p.startsWith(prefix) && (p.endsWith('.yaml') || p.endsWith('.yml')),
    )
    .sort();

  const expectedName = `app-${app}`;
  let applicationSet: ExistingNamedFile | undefined;
  let appProject: ExistingNamedFile | undefined;

  for (const filePath of yamlPaths) {
    const file = await api.readFile(ref, filePath, defaultBranch);
    if (!file) continue;
    let parsed: unknown;
    try {
      parsed = YAML.parse(file.content);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const meta = isRecord(parsed.metadata) ? parsed.metadata : undefined;
    if (meta?.name !== expectedName) continue;
    if (parsed.kind === 'ApplicationSet' && !applicationSet) {
      applicationSet = { path: filePath, content: file.content };
    } else if (parsed.kind === 'AppProject' && !appProject) {
      appProject = { path: filePath, content: file.content };
    }
  }

  return { applicationSet, appProject };
}

async function readExistingStateAppFiles(
  api: GitHubApi,
  org: string,
  inputs: AppInputs,
): Promise<Record<string, string>> {
  const ref: RepoRef = { owner: org, repo: `app-${inputs.app}` };
  let defaultBranch: string;
  try {
    defaultBranch = await api.getDefaultBranch(ref);
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }

  const files: Record<string, string> = {};
  const pathsToRead: string[] = [];
  for (const target of inputs.targets) {
    const base = `kubernetes/${target.platform}/${target.tenant}/${target.env}`;
    pathsToRead.push(`${base}.yaml`, `${base}/values.yaml`);
  }

  const results = await Promise.all(
    pathsToRead.map((p) => api.readFile(ref, p, defaultBranch)),
  );
  for (let i = 0; i < pathsToRead.length; i++) {
    const file = results[i];
    if (file) {
      files[pathsToRead[i]] = file.content;
    }
  }
  return files;
}

export async function resolvePlanContext(
  options: ResolvePlanOptions,
): Promise<ResolvedPlanContext> {
  const { api, featureSource, inputs } = options;
  const org = options.org ?? inputs.org;
  if (!org) {
    throw new Error(
      'Organization is required: pass --org or set "org" in the inputs file.',
    );
  }
  const claimsRepoName = options.claimsRepoName ?? 'claims';
  const cRepo = claimsRepo(api, org, claimsRepoName);

  const { owner: serviceRepoOwner, name: serviceRepoName } = parseRepoSlug(
    inputs.service.repo,
    org,
  );
  const serviceRepoRef: RepoRef = {
    owner: serviceRepoOwner,
    repo: serviceRepoName,
  };

  // Fetch independent remote data in parallel.
  const [
    claimsMap,
    featureIndex,
    dotFirestartr,
    orgPlan,
    serviceDefaultBranch,
    existingDotFirestartrApp,
    existingArgocd,
    existingStateAppFiles,
  ] = await Promise.all([
    loadClaimsMap(cRepo),
    featureSource.readFeatureIndex(),
    readDotFirestartr(api, org, inputs.app),
    api.getOrgPlan(org),
    api.getDefaultBranch(serviceRepoRef),
    readFileFromDefaultBranch(
      api,
      { owner: org, repo: '.firestartr' },
      `apps/${inputs.app}.yaml`,
    ),
    readExistingArgocdFiles(api, org, inputs.app),
    readExistingStateAppFiles(api, org, inputs),
  ]);

  // Resolve Service ComponentClaim (prerequisite).
  const serviceClaimRef = `ComponentClaim-${serviceRepoName}`;
  if (!claimExists(claimsMap, 'ComponentClaim', serviceRepoName)) {
    throw new Error(
      `Service ComponentClaim "${serviceRepoName}" not found in ${org}/${claimsRepoName}.`,
    );
  }
  const serviceClaim = await resolveClaim(cRepo, claimsMap, serviceClaimRef);
  const serviceClaimDefaults = parseServiceClaimDefaults(
    serviceClaim.content,
    org,
  );

  // Resolve existing app-<app> ComponentClaim if present.
  const appClaimName = `app-${inputs.app}`;
  let existingStateAppClaim: ExistingStateAppClaim | undefined;
  if (claimExists(claimsMap, 'ComponentClaim', appClaimName)) {
    const resolved = await resolveClaim(
      cRepo,
      claimsMap,
      `ComponentClaim-${appClaimName}`,
    );
    existingStateAppClaim = {
      path: resolved.filePath,
      content: resolved.content,
      isStateRepoClaim: isStateRepoComponentClaim(resolved.content),
    };
  }

  // Resolve latest feature versions and schemas.
  const findFeature = (name: string) => {
    const found = featureIndex.features.find((f) => f.name === name);
    if (!found) {
      throw new Error(`Feature "${name}" not found in feature index.`);
    }
    return found;
  };
  const buildFeature = findFeature(BUILD_DISPATCH_FEATURE);
  const releaseFeature = findFeature(RELEASE_PLEASE_FEATURE);
  const stateAppFeature = findFeature(STATE_REPO_APPS_FEATURE);

  const [
    buildSchema,
    releaseSchema,
    stateAppSchema,
    makeDispatchesFile,
    buildImagesFile,
  ] = await Promise.all([
    featureSource.readFeatureSchema(
      BUILD_DISPATCH_FEATURE,
      buildFeature.version,
    ),
    featureSource.readFeatureSchema(
      RELEASE_PLEASE_FEATURE,
      releaseFeature.version,
    ),
    featureSource.readFeatureSchema(
      STATE_REPO_APPS_FEATURE,
      stateAppFeature.version,
    ),
    api.readFile(
      serviceRepoRef,
      '.github/make_dispatches.yaml',
      serviceDefaultBranch,
    ),
    api.readFile(
      serviceRepoRef,
      '.github/build_images.yaml',
      serviceDefaultBranch,
    ),
  ]);

  return {
    org,
    claimsRepoName,
    inputs,
    orgPlan,
    claimsMap,
    serviceRepoOwner,
    serviceRepoName,
    serviceDefaultBranch,
    serviceClaimPath: serviceClaim.filePath,
    serviceClaimContent: serviceClaim.content,
    serviceClaimDefaults,
    existingStateAppClaim,
    featureMajors: {
      build_and_dispatch_docker_images: parseMajorVersion(
        buildFeature.version,
        BUILD_DISPATCH_FEATURE,
      ),
      release_please: parseMajorVersion(
        releaseFeature.version,
        RELEASE_PLEASE_FEATURE,
      ),
      state_repo_apps: parseMajorVersion(
        stateAppFeature.version,
        STATE_REPO_APPS_FEATURE,
      ),
    },
    featureSchemas: {
      build_and_dispatch_docker_images: buildSchema,
      release_please: releaseSchema,
      state_repo_apps: stateAppSchema,
    },
    defaultFilters: extractDefaultFilters(buildSchema),
    dotFirestartr,
    existingDotFirestartrApp,
    existingArgocdApplicationSet: existingArgocd.applicationSet,
    existingArgocdAppProject: existingArgocd.appProject,
    existingStateAppFiles,
    existingMakeDispatches: makeDispatchesFile?.content,
    existingBuildImages: buildImagesFile?.content,
  };
}
