import {
  FirestartrGithubRepositorySpecPagesBuildType,
  FirestartrGithubRepositorySpecPagesSourcePath,
} from '../../../imports/firestartr.dev';

export interface IRepositoryPage {
  cname?: string;
  public?: boolean;
  https_enforced?: boolean;
  source?: {
    branch: string;
    path: FirestartrGithubRepositorySpecPagesSourcePath;
  };
  buildType?: FirestartrGithubRepositorySpecPagesBuildType;
}
