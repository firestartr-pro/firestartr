import { BranchStrategy } from 'catalog_common';
import { FirestartrGithubRepositorySpecRepoVisibility } from '../../../imports/firestartr.dev';
import { IClaimInstalledFeature } from '../base';
import { IComponentClaim } from '../base/component';
import { IRepositoryPage } from './pages';

export interface IGithubRepositoryClaim extends IComponentClaim {
  providers: {
    github: {
      description: string;
      name: string;
      org: string;
      orgPermissions: string;
      technology: IComponentClaimTechnology;
      actions: IComponentClaimActions;
      visibility: FirestartrGithubRepositorySpecRepoVisibility;
      allowSquashMerge: boolean;
      allowMergeCommit: boolean;
      allowRebaseMerge: boolean;
      allowAutoMerge: boolean;
      deleteBranchOnMerge: boolean;
      autoInit: boolean;
      archiveOnDestroy: boolean;
      allowUpdateBranch: boolean;
      hasIssues: boolean;
      hasWiki: boolean;
      hasDiscussions?: boolean;
      features: IClaimInstalledFeature[];
      pages: IRepositoryPage;
      branchStrategy: IComponentClaimBranchStrategy;
      additionalBranches: { name: string; orphan: boolean }[];
      topics?: string[];
      labels?: IComponentClaimLabel[];
    };
  };
}

interface IComponentClaimBranchStrategy {
  name: BranchStrategy;
  defaultBranch: string;
}

interface IComponentClaimTechnology {
  stack: string;
  version: string;
}

interface IComponentClaimActions {
  oidc: { useDefault: boolean; includeClaimKeys: string[] };
}

interface IComponentClaimLabel {
  name: string;
  color: string;
  description?: string;
}

export type IComponentClaimOwnerType = 'user' | 'group';
