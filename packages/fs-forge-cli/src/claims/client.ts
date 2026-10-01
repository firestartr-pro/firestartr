import { randomUUID } from 'crypto';
import { Octokit } from '@octokit/rest';

export const CATALOG_ONLY_KINDS = new Set(['SystemClaim', 'DomainClaim']);

export interface RepoFile {
  content: string;
  path: string;
  sha: string;
}

export interface WorkflowDispatchResult {
  url: string;
  correlationId: string;
  workflowId: string;
  branch: string;
}

export interface WorkflowRunResult {
  runUrl: string;
  runId: number;
  conclusion: string;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 404
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClaimsClient {
  readonly owner: string;
  readonly repo: string;
  private readonly octokit: Octokit;

  constructor(owner: string, octokit?: Octokit, repo = 'claims') {
    this.owner = owner;
    this.repo = repo;
    if (octokit) {
      this.octokit = octokit;
      return;
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is required');
    this.octokit = new Octokit({ auth: token });
  }

  async downloadTarball(ref?: string): Promise<Buffer> {
    const { data } = await this.octokit.rest.repos.downloadTarballArchive({
      owner: this.owner,
      repo: this.repo,
      ref: ref ?? 'HEAD',
    });
    return Buffer.from(data as ArrayBuffer);
  }

  async getDefaultBranch(): Promise<string> {
    const { data } = await this.octokit.rest.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    return data.default_branch;
  }

  async getFile(path: string, ref: string): Promise<RepoFile | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref,
      });
      if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
        throw new Error(`${path} is not a file`);
      }
      return {
        content: Buffer.from(data.content, 'base64').toString('utf8'),
        path: data.path,
        sha: data.sha,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getRawFile(path: string, ref: string): Promise<string | null> {
    const file = await this.getFile(path, ref);
    return file?.content ?? null;
  }

  async listFilesRecursive(ref: string): Promise<string[]> {
    const { data } = await this.octokit.rest.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: ref,
      recursive: '1',
    });
    return (data.tree ?? [])
      .filter((entry) => entry.type === 'blob')
      .map((entry) => entry.path ?? '');
  }

  async hasInFlightClaimsMapWorkflow(): Promise<boolean> {
    const branch = await this.getDefaultBranch();
    try {
      const { data } = await this.octokit.rest.actions.listWorkflowRuns({
        owner: this.owner,
        repo: this.repo,
        workflow_id: 'generate-claims-map.yaml',
        branch,
        per_page: 20,
      });
      return data.workflow_runs.some(
        (run) => run.status === 'queued' || run.status === 'in_progress',
      );
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async publishClaim(
    kind: string,
    name: string,
    path: string,
    yaml: string,
    existingSha?: string,
  ): Promise<WorkflowDispatchResult> {
    const correlationId = randomUUID();
    const defaultBranch = await this.getDefaultBranch();
    const { data: baseRef } = await this.octokit.rest.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${defaultBranch}`,
    });
    const branch = `fs-forge/${kind}-${name}`;

    try {
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branch}`,
        sha: baseRef.object.sha,
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 422 &&
        'message' in error &&
        typeof error.message === 'string' &&
        /reference already exists/i.test(error.message)
      ) {
        throw new Error(
          `Branch already exists: ${branch}. Delete it before publishing again.`,
        );
      }
      throw error;
    }
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      branch,
      message: `${kind}-${name}: update claim`,
      content: Buffer.from(yaml).toString('base64'),
      ...(existingSha ? { sha: existingSha } : {}),
    });
    await this.octokit.rest.actions.createWorkflowDispatch({
      owner: this.owner,
      repo: this.repo,
      workflow_id: 'provision-claim.yaml',
      ref: branch,
      inputs: {
        claimType: kind,
        claimName: name,
        correlationId,
        skipHydration: CATALOG_ONLY_KINDS.has(kind),
      },
    });

    const workflowUrl = `https://github.com/${this.owner}/${this.repo}/actions/workflows/provision-claim.yaml`;
    return {
      url: workflowUrl,
      correlationId,
      workflowId: 'provision-claim.yaml',
      branch,
    };
  }

  async dispatchUnprovision(
    kind: string,
    name: string,
    options: {
      includeVariants?: boolean;
      waitForClaimChecks?: boolean;
    } = {},
  ): Promise<WorkflowDispatchResult> {
    const correlationId = randomUUID();
    const defaultBranch = await this.getDefaultBranch();
    await this.octokit.rest.actions.createWorkflowDispatch({
      owner: this.owner,
      repo: this.repo,
      workflow_id: 'unprovision-claim.yaml',
      ref: defaultBranch,
      inputs: {
        claimType: kind,
        claimName: name,
        correlationId,
        includeVariants: options.includeVariants ?? true,
        waitForClaimChecks: options.waitForClaimChecks ?? false,
      },
    });

    const workflowUrl = `https://github.com/${this.owner}/${this.repo}/actions/workflows/unprovision-claim.yaml`;
    return {
      url: workflowUrl,
      correlationId,
      workflowId: 'unprovision-claim.yaml',
      branch: defaultBranch,
    };
  }

  async checkRepoExists(repo: string): Promise<boolean> {
    try {
      await this.octokit.rest.repos.get({
        owner: this.owner,
        repo,
      });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async checkTeamExists(teamSlug: string): Promise<boolean> {
    try {
      await this.octokit.rest.teams.getByName({
        org: this.owner,
        team_slug: teamSlug,
      });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async checkUserIsMember(username: string): Promise<boolean> {
    try {
      const { status } = await this.octokit.rest.orgs.checkMembershipForUser({
        org: this.owner,
        username,
      });
      return (status as number) === 204;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async getDefaultBranchForRepo(owner: string, repo: string): Promise<string> {
    const { data } = await this.octokit.rest.repos.get({
      owner,
      repo,
    });
    return data.default_branch;
  }

  async listFilesRecursiveForRepo(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<string[]> {
    const { data } = await this.octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: '1',
    });
    return (data.tree ?? [])
      .filter((entry) => entry.type === 'blob')
      .map((entry) => entry.path ?? '');
  }

  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });
      if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
        return null;
      }
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listPullRequests(
    owner: string,
    repo: string,
    options: {
      state: 'open' | 'closed' | 'all';
      headPrefix?: string;
      perPage?: number;
      page?: number;
    },
  ): Promise<
    Array<{
      number: number;
      html_url: string;
      state: string;
      head: { ref: string };
      base: { ref: string; sha: string };
      updated_at: string;
    }>
  > {
    const { data } = await this.octokit.rest.pulls.list({
      owner,
      repo,
      state: options.state,
      head: options.headPrefix ? `${owner}:${options.headPrefix}` : undefined,
      per_page: options.perPage ?? 30,
      page: options.page ?? 1,
    });
    return data as Array<{
      number: number;
      html_url: string;
      state: string;
      head: { ref: string };
      base: { ref: string; sha: string };
      updated_at: string;
    }>;
  }

  async listFilesInPr(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<Array<{ filename: string; status: string }>> {
    const files: Array<{ filename: string; status: string }> = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      });

      files.push(
        ...data.map((f) => ({
          filename: f.filename,
          status: f.status,
        })),
      );

      if (data.length < 100) break;
      page++;
    }

    return files;
  }

  async getPrByNumber(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<{
    number: number;
    html_url: string;
    state: string;
    merged: boolean;
  }> {
    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    return {
      number: data.number,
      html_url: data.html_url,
      state: data.merged ? 'merged' : data.state,
      merged: data.merged,
    };
  }

  async searchCode(
    owner: string,
    repo: string,
    query: string,
  ): Promise<Array<{ path: string; name: string }>> {
    const results: Array<{ path: string; name: string }> = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.rest.search.code({
        q: `${query} repo:${owner}/${repo}`,
        per_page: 100,
        page,
      });

      for (const item of data.items) {
        if (item.repository.full_name === `${owner}/${repo}`) {
          results.push({
            path: item.path,
            name: item.name,
          });
        }
      }

      if (data.items.length < 100 || results.length >= data.total_count) break;
      page++;
    }

    return results;
  }

  async listCheckRuns(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<
    Array<{
      name: string;
      conclusion: string | null;
      status: string;
      output: { title: string | null; summary: string; text: string | null };
      html_url: string;
    }>
  > {
    const ref = `refs/pull/${pullNumber}/head`;

    const { data: checkRuns } = await this.octokit.rest.checks.listForRef({
      owner,
      repo,
      ref,
    });

    return checkRuns.check_runs.map((cr) => ({
      name: cr.name,
      conclusion: cr.conclusion,
      status: cr.status,
      output: {
        title: cr.output?.title ?? null,
        summary: cr.output?.summary ?? '',
        text: cr.output?.text ?? null,
      },
      html_url: cr.html_url,
    }));
  }

  async waitForWorkflow(
    correlationId: string,
    workflowId: string,
    claimType: string,
    claimName: string,
    branch: string,
    label = 'Provisioning',
    timeoutMs = 1_200_000,
  ): Promise<WorkflowRunResult> {
    const deadline = Date.now() + timeoutMs;
    const notFoundDeadline = Date.now() + 30_000;
    const pollIntervalMs = 5_000;
    const isTTY = process.stderr.isTTY;

    let currentStatus = '';
    let lastRunUrl: string | undefined;

    try {
      while (Date.now() < deadline) {
        const { data } = await this.octokit.rest.actions.listWorkflowRuns({
          owner: this.owner,
          repo: this.repo,
          workflow_id: workflowId,
          branch,
          event: 'workflow_dispatch',
          per_page: 30,
        });

        const run = data.workflow_runs.find(
          (r) => r.display_title === correlationId,
        );

        if (!run) {
          if (Date.now() > notFoundDeadline) {
            if (!isTTY) {
              process.stdout.write(
                `${JSON.stringify({
                  status: 'error',
                  reason: 'run_not_found',
                  url: `https://github.com/${this.owner}/${this.repo}/actions/workflows/${workflowId}`,
                  claimType,
                  claimName,
                })}\n`,
              );
            } else {
              process.stderr.write(
                `Workflow run not found. Check ${this.owner}/${this.repo}/actions\n`,
              );
            }
            throw new Error(
              `Workflow run not found. Check ${this.owner}/${this.repo}/actions`,
            );
          }
          await sleep(pollIntervalMs);
          continue;
        }

        lastRunUrl = run.html_url;

        if (run.status !== currentStatus) {
          currentStatus = run.status;
          if (isTTY) {
            process.stderr.write(`\r\x1b[K${label}... ${currentStatus}`);
          }
        }

        if (run.status === 'completed') {
          const conclusion = run.conclusion ?? 'unknown';
          if (isTTY) {
            const mark = conclusion === 'success' ? '✓' : '✗';
            process.stderr.write(`\r\x1b[K${label}... ${conclusion} ${mark}\n`);
          } else {
            process.stdout.write(
              `${JSON.stringify({
                status: conclusion === 'success' ? 'ok' : 'error',
                runUrl: lastRunUrl,
                runId: run.id,
                claimType,
                claimName,
                conclusion,
              })}\n`,
            );
          }
          return { runUrl: lastRunUrl, runId: run.id, conclusion };
        }

        await sleep(pollIntervalMs);
      }

      if (!isTTY) {
        const timeoutJson: Record<string, unknown> = {
          status: 'timeout',
          claimType,
          claimName,
        };
        if (lastRunUrl) {
          timeoutJson.runUrl = lastRunUrl;
        }
        process.stdout.write(`${JSON.stringify(timeoutJson)}\n`);
      } else {
        process.stderr.write(`Workflow timed out after ${timeoutMs / 1000}s\n`);
      }
      throw new Error(`Workflow timed out after ${timeoutMs / 1000}s`);
    } catch (error) {
      if (isTTY) {
        process.stderr.write('\n');
      }
      throw error;
    }
  }
}
