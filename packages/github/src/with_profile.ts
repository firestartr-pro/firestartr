// Facade for explicit profile-bound github auth
import { getProfile } from './profile';
import { resolveGithubConfigFromProfile } from './config_resolver';
import * as auth from './auth';
import * as org from './organization';
import * as team from './team';
import * as user from './user';
import issuesModule from './issues';
import * as workflow from './workflow';
import * as branches from './branches';
import * as encrypt from './encrypt';
import { CheckRun } from './check_run';
import { upsertMultiPartStickyComments } from './sticky_comment';
import { divideCommentIntoChunks } from './pull_request';
import logger from './logger';

function createFacade(profileName: string) {
  const getConfig = () => resolveGithubConfigFromProfile(profileName);
  const getOctokitForOrg = (orgName: string) =>
    auth.getOctokitForOrgWithConfig(orgName, getConfig());
  return {
    auth: {
      getGithubAppToken: async (orgName: string) => {
        const config = getConfig();
        const installationOrgId = await (
          await import('./auth_installation')
        ).getInstallationIDWithConfig(orgName, config);
        return auth.getGithubAppTokenWithConfig({
          ...config,
          installationOrgId,
        });
      },
      getOctokitForOrg,
    },
    org: {
      getRepositoryList: async (orgName: string, perPageEntries?: number) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getRepositoryList(orgName, perPageEntries, octokit);
      },
      getTeamList: async (orgName: string, perPageEntries?: number) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getTeamList(orgName, perPageEntries, octokit);
      },
      getUserList: async (orgName: string, perPageEntries?: number) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getUserList(orgName, perPageEntries, octokit);
      },
      validateMember: async (username: string, orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.validateMember(username, orgName, octokit);
      },
      getUserRoleInOrg: async (username: string, orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getUserRoleInOrg(username, orgName, octokit);
      },
      getOrgInfo: async (orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getOrgInfo(orgName, octokit);
      },
      getWebhookList: async (orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getWebhookList(orgName, octokit);
      },
      getOrgTeamsDirectAccess: async (orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getOrgTeamsDirectAccess(orgName, octokit);
      },
      getOrgPlanName: async (orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getOrgPlanName(orgName, octokit);
      },
      getOrgVariable: async (orgName: string, variableName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return org.getOrgVariable(orgName, variableName, octokit);
      },
    },
    repo: {
      addStatusCheck: async (
        output: any,
        isFailure: boolean,
        headSha: string,
        name: string,
        status: string,
        repoName: string,
        owner: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        const payload: any = {
          output,
          head_sha: headSha,
          name,
          owner,
          repo: repoName,
          status,
        };
        if (status === 'completed') {
          payload['conclusion'] = isFailure ? 'failure' : 'success';
        }
        await octokit.rest.checks.create(payload);
      },
      addCommitStatus: async (
        state: 'error' | 'failure' | 'pending' | 'success',
        sha: string,
        repoName: string,
        owner: string,
        targetUrl?: string,
        description?: string,
        context?: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        await octokit.rest.repos.createCommitStatus({
          owner,
          repo: repoName,
          sha,
          state,
          target_url: targetUrl || '',
          description: description || '',
          context: context || '',
        });
      },
      listReleases: async (repoName: string, owner: string) => {
        const octokit = await getOctokitForOrg(owner);
        const response = await octokit.rest.repos.listReleases({
          owner,
          repo: repoName,
          per_page: 100,
          page: 0,
        });
        return response.data;
      },
      getReleaseByTag: async (
        releaseTag: string,
        repoName: string,
        owner: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        const response = await octokit.rest.repos.getReleaseByTag({
          owner,
          repo: repoName,
          tag: releaseTag,
        });
        return response.data;
      },
      getRepoInfo: async (owner: string, name: string) => {
        const octokit = await getOctokitForOrg(owner);
        const response = await octokit.rest.repos.get({ owner, repo: name });
        return response.data;
      },
      getRepoSecret: async (
        owner: string,
        repo: string,
        secretName: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        const response = await octokit.rest.actions.getRepoSecret({
          owner,
          repo,
          secret_name: secretName,
        });
        return response.data;
      },
      repoExists: async (owner: string, name: string) => {
        try {
          const octokit = await getOctokitForOrg(owner);
          await octokit.rest.repos.get({ owner, repo: name });
          return true;
        } catch {
          return false;
        }
      },
    },
    team: {
      getTeamMembers: async (teamName: string, orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return team.getTeamMembers(teamName, orgName, octokit);
      },
      getTeamInfo: async (teamName: string, orgName: string) => {
        const octokit = await getOctokitForOrg(orgName);
        return team.getTeamInfo(teamName, orgName, octokit);
      },
      getTeamRoleUser: async (
        orgName: string,
        teamName: string,
        username: string,
      ) => {
        const octokit = await getOctokitForOrg(orgName);
        return team.getTeamRoleUser(orgName, teamName, username, octokit);
      },
      create: async (
        orgName: string,
        teamName: string,
        privacy?: 'secret' | 'closed',
      ) => {
        const octokit = await getOctokitForOrg(orgName);
        return team.create(orgName, teamName, privacy, octokit);
      },
      addOrUpdateMember: async (
        orgName: string,
        teamName: string,
        username: string,
        role?: 'member' | 'maintainer',
      ) => {
        const octokit = await getOctokitForOrg(orgName);
        return team.addOrUpdateMember(
          orgName,
          teamName,
          username,
          role,
          octokit,
        );
      },
      removeMember: async (
        orgName: string,
        teamName: string,
        username: string,
      ) => {
        const octokit = await getOctokitForOrg(orgName);
        return team.removeMember(orgName, teamName, username, octokit);
      },
    },
    user: {
      getUserInfo: async (name: string) => {
        const octokit = await getOctokitForOrg(name);
        return user.getUserInfo(name, octokit);
      },
    },
    pulls: {
      commentInPR: async (
        comment: string,
        prNumber: number,
        repoName: string,
        owner: string,
        stickyKind?: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        if (stickyKind) {
          await upsertMultiPartStickyComments(octokit as any, {
            owner,
            repo: repoName,
            pullNumber: prNumber,
            baseKind: stickyKind,
            bodies: [comment],
          });
        } else {
          await octokit.rest.issues.createComment({
            owner,
            repo: repoName,
            issue_number: prNumber,
            body: comment,
          });
        }
      },
      getPrLastCommitSHA: async (
        prNumber: number,
        repoName: string,
        owner: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        const prData = await octokit.rest.pulls.get({
          owner,
          repo: repoName,
          pull_number: prNumber,
        });
        return prData.data.head.sha;
      },
      getPrMergeCommitSHA: async (
        prNumber: number,
        repoName: string,
        owner: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        const prData = await octokit.rest.pulls.get({
          owner,
          repo: repoName,
          pull_number: prNumber,
        });
        if (prData.data.merge_commit_sha !== null) {
          return prData.data.merge_commit_sha;
        }
        throw new Error(
          `No merge_commit_sha value in prData.data: ${prData.data}`,
        );
      },
      divideCommentIntoChunks,
    },
    issues: {
      create: async (
        owner: string,
        repo: string,
        title: string,
        body: string,
        labels?: string[],
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return issuesModule.create(owner, repo, title, body, labels, octokit);
      },
      update: async (
        owner: string,
        repo: string,
        issue_number: number,
        title: string,
        body: string,
        labels?: string[],
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return issuesModule.update(
          owner,
          repo,
          issue_number,
          title,
          body,
          labels,
          octokit,
        );
      },
      close: async (owner: string, repo: string, issue_number: number) => {
        const octokit = await getOctokitForOrg(owner);
        return issuesModule.close(owner, repo, issue_number, octokit);
      },
      filterBy: async (
        owner: string,
        repo: string,
        title: string,
        labels: string,
        state?: 'open' | 'closed' | 'all',
        creator?: string,
        assignee?: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return issuesModule.filterBy(
          owner,
          repo,
          title,
          labels,
          state,
          creator,
          assignee,
          octokit,
        );
      },
      upsertByTitle: async (
        owner: string,
        repo: string,
        title: string,
        body: string,
        labels?: string[],
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return issuesModule.upsertByTitle(
          owner,
          repo,
          title,
          body,
          labels,
          octokit,
        );
      },
    },
    workflow: {
      triggerWorkflow: async (
        owner: string,
        repo: string,
        workflowId: string | number,
        ref: string,
        inputs?: workflow.WorkflowDispatchInputs,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return workflow.triggerWorkflow(
          owner,
          repo,
          workflowId,
          ref,
          inputs,
          octokit,
        );
      },
      getWorkflowRun: async (owner: string, repo: string, runId: number) => {
        const octokit = await getOctokitForOrg(owner);
        return workflow.getWorkflowRun(owner, repo, runId, octokit);
      },
      listWorkflowRuns: async (
        owner: string,
        repo: string,
        workflowId?: string | number,
        branch?: string,
        status?: workflow.WorkflowRunStatusFilter,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return workflow.listWorkflowRuns(
          owner,
          repo,
          workflowId,
          branch,
          status,
          octokit,
        );
      },
      waitForWorkflowCompletion: async (
        owner: string,
        repo: string,
        runId: number,
        timeoutMs?: number,
        pollIntervalMs?: number,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return workflow.waitForWorkflowCompletion(
          owner,
          repo,
          runId,
          timeoutMs,
          pollIntervalMs,
          octokit,
        );
      },
    },
    branches: {
      listBranches: async (repo: string, owner: string) => {
        const octokit = await getOctokitForOrg(owner);
        return branches.listBranches(repo, owner, octokit);
      },
      getBranch: async (repo: string, branch: string, owner: string) => {
        const octokit = await getOctokitForOrg(owner);
        return branches.getBranch(repo, branch, owner, octokit);
      },
      createBranch: async (
        repo: string,
        branch: string,
        sha: string,
        owner: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return branches.createBranch(repo, branch, sha, owner, octokit);
      },
      createOrphanBranch: async (
        repo: string,
        branch: string,
        owner: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return branches.createOrphanBranch(repo, branch, owner, octokit);
      },
    },
    encrypt: {
      getRepoPublicKey: async (
        owner: string,
        repo: string,
        section: encrypt.RepoSecretsSection,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return encrypt.getRepoPublicKey(owner, repo, section, octokit);
      },
      encryptRepoSecret: async (
        owner: string,
        repo: string,
        section: encrypt.RepoSecretsSection,
        plaintextValue: string,
      ) => {
        const octokit = await getOctokitForOrg(owner);
        return encrypt.encryptRepoSecret(
          owner,
          repo,
          section,
          plaintextValue,
          octokit,
        );
      },
    },
    feedback: {
      createCheckRun: async (
        owner: string,
        repoName: string,
        name: string,
        opts?: {
          headSHA?: string;
          pullNumber?: number;
          detailsUrl?: string;
          title?: string;
          summary?: string;
          includeCheckRunComment?: boolean;
          checkRunComment?: string;
          stickyCommentBaseKind?: string;
        },
      ) => {
        const octokit = await getOctokitForOrg(owner);
        let headSHA = opts?.headSHA;
        const pr = opts?.pullNumber;
        const hasValidPrNumber =
          typeof pr === 'number' && Number.isInteger(pr) && pr > 0;
        if (!headSHA && hasValidPrNumber) {
          const prData = await octokit.rest.pulls.get({
            owner,
            repo: repoName,
            pull_number: pr,
          });
          headSHA = prData.data.merge_commit_sha ?? prData.data.head.sha;
        }
        if (!headSHA) {
          throw new Error(
            'createCheckRun: either opts.headSHA or opts.pullNumber must be provided',
          );
        }
        logger.debug(
          `Creating check run ${name} in ${owner}/${repoName} at ${headSHA}`,
        );
        return new CheckRun(octokit as any, {
          owner,
          repo: repoName,
          headSHA,
          name,
          detailsUrl: opts?.detailsUrl,
          title: opts?.title,
          summary: opts?.summary,
          pullNumber: opts?.pullNumber,
          includeCheckRunComment: Boolean(opts?.includeCheckRunComment),
          checkRunComment: opts?.checkRunComment,
          stickyCommentBaseKind: opts?.stickyCommentBaseKind,
        });
      },
      CheckRun,
      upsertMultiPartStickyComments,
    },
  };
}

/**
 * Exported API
 */
export function withProfile(profileName: string) {
  // Validate profile exists at call time (not lazily)
  const profile = getProfile(profileName);
  if (!profile) {
    throw new Error(`No github auth profile found for name: ${profileName}`);
  }
  return createFacade(profileName);
}
