/**
 * GithubRepositoryFeatureClaim is a claim to install a feature, it is not
 * to be used by the user. However, it has been added to provide a way to
 * validate the data that is being passed to the renderer.
 */

import { FirestartrGithubRepositoryFeatureSpecRepositoryTarget } from '../../../imports/firestartr.dev';
import { IClaim } from '../base';

export interface IGithubRepositoryFeatureClaim extends IClaim {
  name: string; // Name of the CR
  org: string; // Name of the organization
  firestartr: IGithubRepositoryFeatureFirestartrClaim;
  claimRepoName: string;
  context: any;
  feature: {
    name: string; // Name of the feature installed
    version?: string; // Version of the feature installed
    ref?: string; // Reference to the feature artifact in a github repository
    repo?: string; // a specific repo where the feature is located
    sha?: string; // Resolved git commit SHA of the feature artifact
    tags?: string[]; // Git tags associated with the feature artifact
    url?: string; // URL of the feature artifact in its source repository
  };
  repositoryTarget: FirestartrGithubRepositoryFeatureSpecRepositoryTarget;
  files: Array<IGithubRepositoryFeatureFileClaim>;
}

interface IGithubRepositoryFeatureFirestartrClaim {
  tfStateKey: string;
}

interface IGithubRepositoryFeatureFileClaim {
  path: string; // Path of the file to be created in the repository
  userManaged: boolean; // Whether the file is managed by the user
  content: string; // Base64 encoded content of the file
  targetBranch: string;
}
