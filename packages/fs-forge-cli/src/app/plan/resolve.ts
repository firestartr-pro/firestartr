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
  ArgocdFileConflict,
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
  /** Override GitHub org plan detection (`--org-plan`). */
  orgPlan?: 'free' | 'paid';
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
  repoSlug: string,
  claimPath: string,
): ServiceClaimDefaults {
  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse Service ComponentClaim in ${repoSlug} (${claimPath}): ${detail}`,
    );
  }
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

async function resolveRepoBranch(
  api: GitHubApi,
  ref: RepoRef,
): Promise<{ defaultBranch: string; exists: boolean; archived: boolean }> {
  const state = await api.getRepo(ref);
  if (!state) return { defaultBranch: 'main', exists: false, archived: false };
  return {
    defaultBranch: state.defaultBranch,
    exists: true,
    archived: state.archived,
  };
}

async function readExistingDotFirestartrApp(
  api: GitHubApi,
  org: string,
  app: string,
): Promise<{
  defaultBranch: string;
  exists: boolean;
  archived: boolean;
  path?: string;
  content?: string;
  duplicatePaths?: string[];
}> {
  const ref: RepoRef = { owner: org, repo: '.firestartr' };
  const { defaultBranch, exists, archived } = await resolveRepoBranch(api, ref);
  if (!exists) return { defaultBranch, exists: false, archived };

  const paths = [`apps/${app}.yaml`, `apps/${app}.yml`];
  const files = await Promise.all(
    paths.map((path) => api.readFile(ref, path, defaultBranch)),
  );
  const present = files.filter((f): f is NonNullable<typeof f> => f !== null);
  if (present.length > 1) {
    return {
      defaultBranch,
      exists: true,
      archived,
      duplicatePaths: present.map((f) => f.path),
    };
  }
  if (present.length === 0) return { defaultBranch, exists: true, archived };
  return {
    defaultBranch,
    exists: true,
    archived,
    path: present[0].path,
    content: present[0].content,
  };
}

async function readExistingArgocdFiles(
  api: GitHubApi,
  org: string,
  app: string,
): Promise<{
  defaultBranch: string;
  exists: boolean;
  archived: boolean;
  applicationSet?: ExistingNamedFile;
  appProject?: ExistingNamedFile;
  parseErrors: ArgocdFileConflict[];
  duplicateApplicationSets: string[];
  duplicateAppProjects: string[];
}> {
  const ref: RepoRef = { owner: org, repo: 'state-argocd' };
  const empty = {
    defaultBranch: 'main',
    exists: false,
    archived: false,
    parseErrors: [] as ArgocdFileConflict[],
    duplicateApplicationSets: [] as string[],
    duplicateAppProjects: [] as string[],
  };
  const { defaultBranch, exists, archived } = await resolveRepoBranch(api, ref);
  if (!exists) return empty;

  let paths: string[];
  try {
    paths = await api.listBlobPaths(ref, defaultBranch);
  } catch (error) {
    if (isNotFoundError(error)) {
      return { ...empty, defaultBranch, exists: true, archived };
    }
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
  const applicationSets: ExistingNamedFile[] = [];
  const appProjects: ExistingNamedFile[] = [];
  const parseErrors: ArgocdFileConflict[] = [];

  for (const filePath of yamlPaths) {
    const file = await api.readFile(ref, filePath, defaultBranch);
    if (!file) continue;
    const docs = YAML.parseAllDocuments(file.content);
    if (docs.length > 1) {
      parseErrors.push({
        path: filePath,
        reason:
          'Multi-document YAML is not supported (expected a single document)',
      });
      continue;
    }
    if (docs.length === 0) continue;
    const doc = docs[0];
    if (doc.errors.length > 0) {
      parseErrors.push({
        path: filePath,
        reason: `Malformed YAML: ${doc.errors[0].message}`,
      });
      continue;
    }
    const parsed: unknown = doc.toJS();
    if (!isRecord(parsed)) {
      parseErrors.push({
        path: filePath,
        reason: 'Expected a YAML mapping',
      });
      continue;
    }
    const meta = isRecord(parsed.metadata) ? parsed.metadata : undefined;
    if (meta?.name !== expectedName) continue;
    if (parsed.kind === 'ApplicationSet') {
      applicationSets.push({ path: filePath, content: file.content });
    } else if (parsed.kind === 'AppProject') {
      appProjects.push({ path: filePath, content: file.content });
    }
  }

  return {
    defaultBranch,
    exists: true,
    archived,
    applicationSet:
      applicationSets.length === 1 ? applicationSets[0] : undefined,
    appProject: appProjects.length === 1 ? appProjects[0] : undefined,
    parseErrors,
    duplicateApplicationSets:
      applicationSets.length > 1 ? applicationSets.map((f) => f.path) : [],
    duplicateAppProjects:
      appProjects.length > 1 ? appProjects.map((f) => f.path) : [],
  };
}

async function readExistingStateAppFiles(
  api: GitHubApi,
  org: string,
  inputs: AppInputs,
): Promise<{
  defaultBranch: string;
  exists: boolean;
  archived: boolean;
  files: Record<string, string>;
}> {
  const ref: RepoRef = { owner: org, repo: `app-${inputs.app}` };
  const { defaultBranch, exists, archived } = await resolveRepoBranch(api, ref);
  if (!exists) {
    return { defaultBranch, exists: false, archived: false, files: {} };
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
  return { defaultBranch, exists: true, archived, files };
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
    claimsDefaultBranch,
    claimsMap,
    featureIndex,
    dotFirestartr,
    orgPlan,
    serviceRepoBranch,
    existingDotFirestartrAppResult,
    existingArgocd,
    existingStateAppResult,
  ] = await Promise.all([
    api.getDefaultBranch({ owner: org, repo: claimsRepoName }),
    loadClaimsMap(cRepo).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid claims-map.json in ${org}/${claimsRepoName} (claims-map.json): ${detail}`,
      );
    }),
    featureSource.readFeatureIndex(),
    readDotFirestartr(api, org, inputs.app),
    options.orgPlan ? Promise.resolve(options.orgPlan) : api.getOrgPlan(org),
    resolveRepoBranch(api, serviceRepoRef),
    readExistingDotFirestartrApp(api, org, inputs.app),
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
    `${org}/${claimsRepoName}`,
    serviceClaim.filePath,
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
    serviceRepoBranch.exists
      ? api.readFile(
          serviceRepoRef,
          '.github/make_dispatches.yaml',
          serviceRepoBranch.defaultBranch,
        )
      : Promise.resolve(undefined),
    serviceRepoBranch.exists
      ? api.readFile(
          serviceRepoRef,
          '.github/build_images.yaml',
          serviceRepoBranch.defaultBranch,
        )
      : Promise.resolve(undefined),
  ]);

  return {
    org,
    claimsRepoName,
    inputs,
    orgPlan,
    claimsMap,
    serviceRepoOwner,
    serviceRepoName,
    defaultBranches: {
      claims: claimsDefaultBranch,
      dotFirestartr: existingDotFirestartrAppResult.defaultBranch,
      stateApp: existingStateAppResult.defaultBranch,
      stateArgocd: existingArgocd.defaultBranch,
      service: serviceRepoBranch.defaultBranch,
    },
    repoState: {
      dotFirestartr: {
        exists: existingDotFirestartrAppResult.exists,
        archived: existingDotFirestartrAppResult.archived,
      },
      stateArgocd: {
        exists: existingArgocd.exists,
        archived: existingArgocd.archived,
      },
      stateApp: {
        exists: existingStateAppResult.exists,
        archived: existingStateAppResult.archived,
      },
      service: {
        exists: serviceRepoBranch.exists,
        archived: serviceRepoBranch.archived,
      },
    },
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
    existingDotFirestartrApp: existingDotFirestartrAppResult.content,
    existingDotFirestartrAppPath: existingDotFirestartrAppResult.path,
    existingDotFirestartrAppDuplicates:
      existingDotFirestartrAppResult.duplicatePaths,
    existingArgocdApplicationSet: existingArgocd.applicationSet,
    existingArgocdAppProject: existingArgocd.appProject,
    argocdParseErrors: existingArgocd.parseErrors,
    duplicateArgocdApplicationSets: existingArgocd.duplicateApplicationSets,
    duplicateArgocdAppProjects: existingArgocd.duplicateAppProjects,
    existingStateAppFiles: existingStateAppResult.files,
    existingMakeDispatches: makeDispatchesFile?.content,
    existingBuildImages: buildImagesFile?.content,
  };
}
