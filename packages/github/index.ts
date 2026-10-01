import org from './src/organization';
import repo from './src/repository';
import team from './src/team';
import user from './src/user';
import pulls from './src/pull_request';
import auth from './src/auth';
import issues from './src/issues';
import branches from './src/branches';
import workflow from './src/workflow';
import { CheckRun, createCheckRun } from './src/check_run';
import { upsertMultiPartStickyComments } from './src/sticky_comment';
import {
  getOctokitForOrg,
  generateGithubAppToken,
  getGithubAppToken,
  getOctokitFromPat,
} from './src/auth';

import { encryptRepoSecret, getRepoPublicKey } from './src/encrypt';

import type { RepoSecretsSection } from './src/encrypt';
import type {
  WorkflowCompletionResult,
  WorkflowDispatchInputs,
  WorkflowRunConclusion,
  WorkflowRunStatus,
  WorkflowRunStatusFilter,
  WorkflowRunSummary,
} from './src/workflow';

import { withProfile } from './src/with_profile';
import { createProfile } from './src/profile';

export default {
  org,
  repo,
  team,
  user,
  getOctokitForOrg,
  getOctokitFromPat,
  generateGithubAppToken,
  getGithubAppToken,
  auth,
  pulls,
  issues,
  branches,
  workflow,
  feedback: {
    createCheckRun,
    CheckRun,
    upsertMultiPartStickyComments,
  },
  encryption: {
    encryptRepoSecret,
    getRepoPublicKey,
  },
  withProfile,
  createProfile,
};

export { RepoSecretsSection, createProfile };
export type {
  WorkflowCompletionResult,
  WorkflowDispatchInputs,
  WorkflowRunConclusion,
  WorkflowRunStatus,
  WorkflowRunStatusFilter,
  WorkflowRunSummary,
};
