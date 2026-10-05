import type {
  CheckRunSummary,
  GitHubApi,
  PullRequestFile,
  PullRequestSummary,
  RepoFile,
  RepoRef,
  WorkflowRunSummary,
} from '../../src/github/api.js';

interface CommitInput {
  path: string;
  branch: string;
  message: string;
  content: string;
  sha?: string;
}

interface DispatchInput {
  workflowId: string;
  gitRef: string;
  inputs: Record<string, string | boolean>;
}

/**
 * In-memory `GitHubApi` for tests: imports nothing from Octokit, so tests
 * exercise the CLI in its own data shapes.
 */
export class MemoryGitHubApi implements GitHubApi {
  readonly calls: string[] = [];
  readonly committed: Array<{ ref: RepoRef } & CommitInput> = [];
  readonly dispatched: Array<{ ref: RepoRef } & DispatchInput> = [];
  readonly defaultBranches = new Map<string, string>();
  readonly existingRepos = new Set<string>();
  readonly existingTeams = new Set<string>();
  readonly members = new Set<string>();
  tarball = Buffer.alloc(0);
  /** When true, dispatched workflows report a completed run. */
  autoCompleteDispatches = false;
  /** Conclusion reported by `autoCompleteDispatches`. */
  autoCompleteConclusion = 'success';

  private readonly files = new Map<string, { content: string; sha: string }>();
  private readonly blobPaths = new Map<string, string[]>();
  private readonly branchShas = new Map<string, string>();
  private readonly workflowRuns = new Map<string, WorkflowRunSummary[]>();
  private readonly pulls = new Map<string, PullRequestSummary[]>();
  private readonly pullFiles = new Map<string, PullRequestFile[]>();
  private readonly checkRuns = new Map<string, CheckRunSummary[]>();
  private readonly searchResults = new Map<
    string,
    Array<{ path: string; name: string }>
  >();

  key(ref: RepoRef): string {
    return `${ref.owner}/${ref.repo}`;
  }

  setFile(ref: RepoRef, path: string, content: string, sha = 'file-sha'): void {
    this.files.set(`${this.key(ref)}#${path}`, { content, sha });
  }

  setBlobPaths(ref: RepoRef, paths: string[]): void {
    this.blobPaths.set(this.key(ref), paths);
  }

  setBranchHeadSha(ref: RepoRef, branch: string, sha = 'base-sha'): void {
    this.branchShas.set(`${this.key(ref)}#${branch}`, sha);
  }

  setDefaultBranch(ref: RepoRef, branch = 'main'): void {
    this.defaultBranches.set(this.key(ref), branch);
  }

  setWorkflowRuns(
    ref: RepoRef,
    workflowId: string,
    branch: string,
    runs: WorkflowRunSummary[],
  ): void {
    this.workflowRuns.set(`${this.key(ref)}#${workflowId}#${branch}`, runs);
  }

  setPullRequests(ref: RepoRef, pulls: PullRequestSummary[]): void {
    this.pulls.set(this.key(ref), pulls);
  }

  setPullRequestFiles(ref: RepoRef, pr: number, files: PullRequestFile[]): void {
    this.pullFiles.set(`${this.key(ref)}#${pr}`, files);
  }

  setCheckRuns(ref: RepoRef, pr: number, runs: CheckRunSummary[]): void {
    this.checkRuns.set(`${this.key(ref)}#${pr}`, runs);
  }

  setSearchResults(
    ref: RepoRef,
    results: Array<{ path: string; name: string }>,
  ): void {
    this.searchResults.set(this.key(ref), results);
  }

  addRepo(ref: RepoRef): void {
    this.existingRepos.add(this.key(ref));
  }

  addTeam(org: string, teamSlug: string): void {
    this.existingTeams.add(`${org}/${teamSlug}`);
  }

  addMember(org: string, username: string): void {
    this.members.add(`${org}/${username}`);
  }

  async readFile(
    ref: RepoRef,
    path: string,
    gitRef?: string,
  ): Promise<RepoFile | null> {
    this.calls.push(`readFile ${this.key(ref)}:${path}@${gitRef ?? 'HEAD'}`);
    const file = this.files.get(`${this.key(ref)}#${path}`);
    return file ? { path, content: file.content, sha: file.sha } : null;
  }

  async listBlobPaths(ref: RepoRef, gitRef: string): Promise<string[]> {
    this.calls.push(`listBlobPaths ${this.key(ref)}@${gitRef}`);
    return this.blobPaths.get(this.key(ref)) ?? [];
  }

  async downloadTarball(ref: RepoRef, gitRef?: string): Promise<Buffer> {
    this.calls.push(`downloadTarball ${this.key(ref)}@${gitRef ?? 'HEAD'}`);
    return this.tarball;
  }

  async getDefaultBranch(ref: RepoRef): Promise<string> {
    this.calls.push(`getDefaultBranch ${this.key(ref)}`);
    return this.defaultBranches.get(this.key(ref)) ?? 'main';
  }

  async branchHeadSha(ref: RepoRef, branch: string): Promise<string> {
    this.calls.push(`branchHeadSha ${this.key(ref)}@${branch}`);
    return this.branchShas.get(`${this.key(ref)}#${branch}`) ?? 'base-sha';
  }

  async createBranch(ref: RepoRef, branch: string, sha: string): Promise<void> {
    this.calls.push(`createBranch ${this.key(ref)}@${branch}:${sha}`);
    this.branchShas.set(`${this.key(ref)}#${branch}`, sha);
  }

  async commitFile(ref: RepoRef, input: CommitInput): Promise<void> {
    this.calls.push(`commitFile ${this.key(ref)}:${input.path}@${input.branch}`);
    this.committed.push({ ref, ...input });
    this.setFile(ref, input.path, input.content, input.sha ?? 'file-sha');
  }

  async dispatchWorkflow(ref: RepoRef, input: DispatchInput): Promise<void> {
    this.calls.push(`dispatchWorkflow ${this.key(ref)}:${input.workflowId}`);
    this.dispatched.push({ ref, ...input });
  }

  async listWorkflowRuns(
    ref: RepoRef,
    input: { workflowId: string; branch: string },
  ): Promise<WorkflowRunSummary[]> {
    this.calls.push(
      `listWorkflowRuns ${this.key(ref)}:${input.workflowId}@${input.branch}`,
    );
    const configured = this.workflowRuns.get(
      `${this.key(ref)}#${input.workflowId}#${input.branch}`,
    );
    if (configured) return configured;
    if (!this.autoCompleteDispatches) return [];

    const dispatch = this.dispatched.find(
      (candidate) =>
        this.key(candidate.ref) === this.key(ref) &&
        candidate.workflowId === input.workflowId &&
        candidate.gitRef === input.branch,
    );
    if (!dispatch) return [];
    return [
      {
        id: 1,
        htmlUrl: `https://github.com/${this.key(ref)}/actions/runs/1`,
        status: 'completed',
        conclusion: this.autoCompleteConclusion,
        displayTitle: String(dispatch.inputs.correlationId),
      },
    ];
  }

  async listOpenPullRequests(
    ref: RepoRef,
    headPrefix?: string,
  ): Promise<PullRequestSummary[]> {
    this.calls.push(`listOpenPullRequests ${this.key(ref)}:${headPrefix ?? ''}`);
    const pulls = this.pulls.get(this.key(ref)) ?? [];
    return headPrefix
      ? pulls.filter((pull) => pull.headRef.startsWith(headPrefix))
      : pulls;
  }

  async listPullRequestFiles(
    ref: RepoRef,
    pr: number,
  ): Promise<PullRequestFile[]> {
    this.calls.push(`listPullRequestFiles ${this.key(ref)}#${pr}`);
    return this.pullFiles.get(`${this.key(ref)}#${pr}`) ?? [];
  }

  async getPullRequest(
    ref: RepoRef,
    pr: number,
  ): Promise<{
    number: number;
    htmlUrl: string;
    state: string;
    merged: boolean;
  }> {
    this.calls.push(`getPullRequest ${this.key(ref)}#${pr}`);
    const pull = (this.pulls.get(this.key(ref)) ?? []).find(
      (candidate) => candidate.number === pr,
    );
    return {
      number: pr,
      htmlUrl: pull?.htmlUrl ?? '',
      state: pull?.state ?? 'open',
      merged: false,
    };
  }

  async listCheckRunsForPullRequest(
    ref: RepoRef,
    pr: number,
  ): Promise<CheckRunSummary[]> {
    this.calls.push(`listCheckRunsForPullRequest ${this.key(ref)}#${pr}`);
    return this.checkRuns.get(`${this.key(ref)}#${pr}`) ?? [];
  }

  async searchFiles(
    ref: RepoRef,
    query: string,
  ): Promise<Array<{ path: string; name: string }>> {
    this.calls.push(`searchFiles ${this.key(ref)}:${query}`);
    return this.searchResults.get(this.key(ref)) ?? [];
  }

  async repoExists(ref: RepoRef): Promise<boolean> {
    this.calls.push(`repoExists ${this.key(ref)}`);
    return this.existingRepos.has(this.key(ref));
  }

  async teamExists(org: string, teamSlug: string): Promise<boolean> {
    this.calls.push(`teamExists ${org}/${teamSlug}`);
    return this.existingTeams.has(`${org}/${teamSlug}`);
  }

  async userIsOrgMember(org: string, username: string): Promise<boolean> {
    this.calls.push(`userIsOrgMember ${org}/${username}`);
    return this.members.has(`${org}/${username}`);
  }
}
