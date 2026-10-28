import type { Octokit } from '@octokit/rest';

import { isNotFoundError } from './api.js';

import type { GitHubApi } from './api.js';

/** Production adapter: implements the port over Octokit's REST client. */
export function createOctokitApi(octokit: Octokit): GitHubApi {
  return {
    async readFile(ref, path, gitRef) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner: ref.owner,
          repo: ref.repo,
          path,
          ref: gitRef,
        });
        if (
          Array.isArray(data) ||
          data.type !== 'file' ||
          !('content' in data)
        ) {
          throw new Error(`${path} is not a file`);
        }
        return {
          path: data.path,
          sha: data.sha,
          content: Buffer.from(data.content, 'base64').toString('utf8'),
        };
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    },

    async listBlobPaths(ref, gitRef) {
      const { data } = await octokit.rest.git.getTree({
        owner: ref.owner,
        repo: ref.repo,
        tree_sha: gitRef,
        recursive: '1',
      });
      return (data.tree ?? [])
        .filter((entry) => entry.type === 'blob')
        .map((entry) => entry.path ?? '');
    },

    async downloadTarball(ref, gitRef) {
      const { data } = await octokit.rest.repos.downloadTarballArchive({
        owner: ref.owner,
        repo: ref.repo,
        ref: gitRef ?? 'HEAD',
      });
      return Buffer.from(data as ArrayBuffer);
    },

    async getDefaultBranch(ref) {
      const { data } = await octokit.rest.repos.get({
        owner: ref.owner,
        repo: ref.repo,
      });
      return data.default_branch;
    },

    async branchHeadSha(ref, branch) {
      const { data } = await octokit.rest.git.getRef({
        owner: ref.owner,
        repo: ref.repo,
        ref: `heads/${branch}`,
      });
      return data.object.sha;
    },

    async createBranch(ref, branch, sha) {
      await octokit.rest.git.createRef({
        owner: ref.owner,
        repo: ref.repo,
        ref: `refs/heads/${branch}`,
        sha,
      });
    },

    async commitFile(ref, input) {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: ref.owner,
        repo: ref.repo,
        path: input.path,
        branch: input.branch,
        message: input.message,
        content: Buffer.from(input.content).toString('base64'),
        ...(input.sha ? { sha: input.sha } : {}),
      });
    },

    async dispatchWorkflow(ref, input) {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: ref.owner,
        repo: ref.repo,
        workflow_id: input.workflowId,
        ref: input.gitRef,
        inputs: input.inputs,
      });
    },

    async listWorkflowRuns(ref, input) {
      const { data } = await octokit.rest.actions.listWorkflowRuns({
        owner: ref.owner,
        repo: ref.repo,
        workflow_id: input.workflowId,
        branch: input.branch,
        event: input.event,
        per_page: input.perPage ?? 20,
      });
      return data.workflow_runs.map((run) => ({
        id: run.id,
        htmlUrl: run.html_url,
        status: run.status ?? 'unknown',
        conclusion: run.conclusion,
        displayTitle: run.display_title ?? '',
      }));
    },

    async listOpenPullRequests(ref, headPrefix) {
      const pulls: Awaited<ReturnType<GitHubApi['listOpenPullRequests']>> = [];
      let page = 1;
      while (true) {
        const { data } = await octokit.rest.pulls.list({
          owner: ref.owner,
          repo: ref.repo,
          state: 'open',
          per_page: 100,
          page,
        });
        // GitHub's `head` filter matches `owner:branch` exactly, not a prefix.
        const matching = headPrefix
          ? data.filter((pr) => pr.head.ref.startsWith(headPrefix))
          : data;
        pulls.push(
          ...matching.map((pr) => ({
            number: pr.number,
            htmlUrl: pr.html_url,
            state: pr.state,
            headRef: pr.head.ref,
            baseSha: pr.base.sha,
            updatedAt: pr.updated_at,
            body: pr.body ?? '',
          })),
        );
        if (data.length < 100) break;
        page++;
      }
      return pulls;
    },

    async listPullRequestFiles(ref, pr) {
      const files: Array<{ filename: string; status: string }> = [];
      let page = 1;
      while (true) {
        const { data } = await octokit.rest.pulls.listFiles({
          owner: ref.owner,
          repo: ref.repo,
          pull_number: pr,
          per_page: 100,
          page,
        });
        files.push(
          ...data.map((file) => ({
            filename: file.filename,
            status: file.status,
          })),
        );
        if (data.length < 100) break;
        page++;
      }
      return files;
    },

    async getPullRequest(ref, pr) {
      const { data } = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: pr,
      });
      return {
        number: data.number,
        htmlUrl: data.html_url,
        state: data.merged ? 'merged' : data.state,
        merged: data.merged,
      };
    },

    async listCheckRunsForPullRequest(ref, pr) {
      const { data: pull } = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: pr,
      });
      // The operator posts reconciliation checks on merge_commit_sha, which
      // may differ from the PR head after merging.
      const reconciliationSha = pull.merge_commit_sha ?? pull.head.sha;
      const shas = new Set([pull.head.sha, reconciliationSha]);
      const checks: Awaited<
        ReturnType<GitHubApi['listCheckRunsForPullRequest']>
      > = [];
      let awaitingReconciliationChecks = false;
      for (const sha of shas) {
        let page = 1;
        while (true) {
          const { data } = await octokit.rest.checks.listForRef({
            owner: ref.owner,
            repo: ref.repo,
            ref: sha,
            per_page: 100,
            page,
          });
          if (
            page === 1 &&
            data.check_runs.length === 0 &&
            sha === reconciliationSha
          )
            awaitingReconciliationChecks = true;
          checks.push(
            ...data.check_runs.map((run) => ({
              name: run.name,
              conclusion: run.conclusion,
              status: run.status,
              output: {
                title: run.output?.title ?? null,
                summary: run.output?.summary ?? '',
                text: run.output?.text ?? null,
              },
              htmlUrl: run.html_url,
            })),
          );
          if (data.check_runs.length < 100) break;
          page++;
        }
      }
      if (checks.length > 0 && awaitingReconciliationChecks) {
        checks.push({
          name: `Waiting for check runs on ${reconciliationSha}`,
          conclusion: null,
          status: 'queued',
          output: {
            title: null,
            summary: 'No checks registered yet',
            text: null,
          },
          htmlUrl: null,
        });
      }
      return checks;
    },

    async createPullRequest(ref, input) {
      const { data } = await octokit.rest.pulls.create({
        owner: ref.owner,
        repo: ref.repo,
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
      });
      return { number: data.number, htmlUrl: data.html_url };
    },

    async updatePullRequest(ref, pr, input) {
      await octokit.rest.pulls.update({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: pr,
        body: input.body,
      });
    },

    async createIssue(ref, input) {
      const { data } = await octokit.rest.issues.create({
        owner: ref.owner,
        repo: ref.repo,
        title: input.title,
        body: input.body,
      });
      return { number: data.number, htmlUrl: data.html_url };
    },

    async commentOnIssue(ref, issue, body) {
      await octokit.rest.issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: issue,
        body,
      });
    },

    async closeIssue(ref, issue) {
      await octokit.rest.issues.update({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: issue,
        state: 'closed',
      });
    },

    async repoExists(ref) {
      try {
        await octokit.rest.repos.get({ owner: ref.owner, repo: ref.repo });
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
      }
    },

    async teamExists(org, teamSlug) {
      try {
        await octokit.rest.teams.getByName({ org, team_slug: teamSlug });
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
      }
    },

    async userIsOrgMember(org, username) {
      try {
        const { status } = await octokit.rest.orgs.checkMembershipForUser({
          org,
          username,
        });
        return (status as number) === 204;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        throw error;
      }
    },
  };
}
