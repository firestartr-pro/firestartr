/** The GitHub operations the CLI needs, expressed in its own data shapes.
 *
 * `octokitApi.ts` implements this port for production and
 * `__tests__/fixtures/memoryGitHubApi.ts` implements it for tests, so callers
 * never depend on Octokit's response shapes.
 */

/** True when a GitHub error reports a missing resource (HTTP 404). */
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  );
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoFile {
  path: string;
  content: string;
  sha: string;
}

export interface PullRequestSummary {
  number: number;
  htmlUrl: string;
  state: string;
  headRef: string;
  baseSha: string;
  updatedAt: string;
  /** PR description; absent when the adapter has no body to report. */
  body?: string;
}

export interface PullRequestFile {
  filename: string;
  status: string;
}

export interface CheckRunSummary {
  name: string;
  conclusion: string | null;
  status: string;
  output: { title: string | null; summary: string; text: string | null };
  htmlUrl: string | null;
}

export interface WorkflowRunSummary {
  id: number;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  displayTitle: string;
}

/** A created issue or pull request, reduced to what the CLI reports. */
export interface CreatedItem {
  number: number;
  htmlUrl: string;
}

export interface GitHubApi {
  readFile(
    ref: RepoRef,
    path: string,
    gitRef?: string,
  ): Promise<RepoFile | null>;
  listBlobPaths(ref: RepoRef, gitRef: string): Promise<string[]>;
  downloadTarball(ref: RepoRef, gitRef?: string): Promise<Buffer>;
  getDefaultBranch(ref: RepoRef): Promise<string>;

  branchHeadSha(ref: RepoRef, branch: string): Promise<string>;
  createBranch(ref: RepoRef, branch: string, sha: string): Promise<void>;
  commitFile(
    ref: RepoRef,
    input: {
      path: string;
      branch: string;
      message: string;
      content: string;
      sha?: string;
    },
  ): Promise<void>;
  dispatchWorkflow(
    ref: RepoRef,
    input: {
      workflowId: string;
      gitRef: string;
      inputs: Record<string, string | boolean>;
    },
  ): Promise<void>;
  listWorkflowRuns(
    ref: RepoRef,
    input: {
      workflowId: string;
      branch: string;
      /** Trigger event to filter by; omitted lists every event. */
      event?: string;
      perPage?: number;
    },
  ): Promise<WorkflowRunSummary[]>;

  listOpenPullRequests(
    ref: RepoRef,
    headPrefix?: string,
  ): Promise<PullRequestSummary[]>;
  listPullRequestFiles(ref: RepoRef, pr: number): Promise<PullRequestFile[]>;
  getPullRequest(
    ref: RepoRef,
    pr: number,
  ): Promise<{
    number: number;
    htmlUrl: string;
    state: string;
    merged: boolean;
  }>;
  listCheckRunsForPullRequest(
    ref: RepoRef,
    pr: number,
  ): Promise<CheckRunSummary[]>;
  createPullRequest(
    ref: RepoRef,
    input: { head: string; base: string; title: string; body: string },
  ): Promise<CreatedItem>;
  updatePullRequest(
    ref: RepoRef,
    pr: number,
    input: { body: string },
  ): Promise<void>;
  createIssue(
    ref: RepoRef,
    input: { title: string; body: string },
  ): Promise<CreatedItem>;
  commentOnIssue(ref: RepoRef, issue: number, body: string): Promise<void>;
  closeIssue(ref: RepoRef, issue: number): Promise<void>;
  reopenIssue(ref: RepoRef, issue: number): Promise<void>;

  repoExists(ref: RepoRef): Promise<boolean>;
  teamExists(org: string, teamSlug: string): Promise<boolean>;
  userIsOrgMember(org: string, username: string): Promise<boolean>;
}
