import type { OrgPlan } from '../../github/api.js';
import type { AppInputs } from '../../schema/appInputs.js';
import type { ClaimsMap } from '../../claims/claimsMap.js';
import type { DotFirestartrFacts } from '../dotFirestartr.js';
import type {
  DefaultTrackFilters,
  RenderedFile,
  ServiceClaimDefaults,
} from '../render/index.js';

export type PlanCheckStatus = 'pass' | 'fail' | 'info';

export interface PlanCheck {
  id: string;
  status: PlanCheckStatus;
  message: string;
  checklist?: string[];
}

export interface ExistingNamedFile {
  path: string;
  content: string;
}

export interface ArgocdFileConflict {
  path: string;
  reason: string;
}

export interface ExistingStateAppClaim {
  path: string;
  content: string;
  /** True when the existing claim is a ComponentClaim with the `state_repo_apps` feature. */
  isStateRepoClaim: boolean;
}

export interface PlanDefaultBranches {
  claims: string;
  dotFirestartr: string;
  stateApp: string;
  stateArgocd: string;
  service: string;
}

export interface PlanTargetRepo {
  exists: boolean;
  /** True when the repository is read-only because GitHub archived it. */
  archived: boolean;
}

export interface ResolvedPlanContext {
  org: string;
  claimsRepoName: string;
  inputs: AppInputs;
  orgPlan: OrgPlan;
  claimsMap: ClaimsMap;
  serviceRepoOwner: string;
  serviceRepoName: string;
  defaultBranches: PlanDefaultBranches;
  repoState: {
    dotFirestartr: PlanTargetRepo;
    stateArgocd: PlanTargetRepo;
    service: PlanTargetRepo;
  };
  serviceClaimPath: string;
  serviceClaimContent: string;
  serviceClaimDefaults: ServiceClaimDefaults;
  existingStateAppClaim?: ExistingStateAppClaim;
  featureMajors: {
    build_and_dispatch_docker_images: number;
    release_please: number;
    state_repo_apps: number;
  };
  featureSchemas: {
    build_and_dispatch_docker_images: Record<string, unknown>;
    release_please: Record<string, unknown>;
    state_repo_apps: Record<string, unknown>;
  };
  defaultFilters: DefaultTrackFilters;
  dotFirestartr: DotFirestartrFacts;
  existingDotFirestartrApp?: string;
  existingArgocdApplicationSet?: ExistingNamedFile;
  existingArgocdAppProject?: ExistingNamedFile;
  argocdParseErrors?: ArgocdFileConflict[];
  duplicateArgocdApplicationSets?: string[];
  duplicateArgocdAppProjects?: string[];
  /** Map of relative path -> content for existing target files in `app-<app>`. */
  existingStateAppFiles: Record<string, string>;
  existingMakeDispatches?: string;
  existingBuildImages?: string;
}

export interface PlanRepoFiles {
  claims: RenderedFile[];
  dotFirestartr: RenderedFile[];
  stateApp: RenderedFile[];
  stateArgocd: RenderedFile[];
  service: RenderedFile[];
}

export interface PlanSchemaDirs {
  claimSchemasDir: string;
  dotFirestartrSchemasDir: string;
  actionsSchemasDir: string;
  vendorDir: string;
}

export interface AppPlanResult {
  context: ResolvedPlanContext;
  files: PlanRepoFiles;
  checks: PlanCheck[];
}
