import { claimsRepo, isBranchAlreadyExists } from '../../claims/claimsRepo.js';
import { withAuditTrail } from '../../mutations/auditIssue.js';
import { publishClaimAndWait } from '../../mutations/publish.js';
import { buildPlanJsonOutput } from '../plan/steps.js';

import type {
  ApplyAppOptions,
  ApplyAppResult,
  ApplyPrRef,
  ApplyRepoResult,
  ApplyStepResult,
} from './types.js';
import type { GitHubApi, RepoRef } from '../../github/api.js';
import type { Pulse } from '../../mutations/publish.js';
import type { PlanRepoEntry } from '../plan/steps.js';
import type { AppPlanResult } from '../plan/types.js';

export const DEFAULT_APPLY_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_POLL_INTERVAL_MS = 5000;

const NOOP_PULSE: Pulse = {
  output: () => {},
  diagnostic: () => {},
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRepoRef(fullName: string): RepoRef {
  const slash = fullName.indexOf('/');
  if (slash < 0) {
    throw new Error(`Invalid repository name: ${fullName}`);
  }
  return {
    owner: fullName.slice(0, slash),
    repo: fullName.slice(slash + 1),
  };
}

function buildPrBody(entry: PlanRepoEntry): string {
  const lines = ['Files:', ''];
  for (const file of entry.files) {
    if (file.outcome.kind === 'create' || file.outcome.kind === 'merge') {
      lines.push(`- \`[${file.outcome.kind}]\` \`${file.path}\``);
    }
  }
  return lines.join('\n');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function applyApp(
  api: GitHubApi,
  plan: AppPlanResult,
  options: ApplyAppOptions = {},
): Promise<ApplyAppResult> {
  const planOutput = buildPlanJsonOutput(plan);
  if (!planOutput.ready) {
    return {
      outcome: 'not_ready',
      steps: [],
      reason: 'Plan has failing checks or conflicts.',
    };
  }

  const noWait = options.noWait ?? false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_APPLY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const pulse = options.pulse ?? NOOP_PULSE;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const org = plan.context.org;
  const stateRepos = options.stateRepos ?? [
    `${org}/state-github`,
    `${org}/state-infra`,
  ];

  const steps: ApplyStepResult[] = [];
  let auditIssue: ApplyPrRef | undefined;

  // Step 1: claims (provisioned sequentially via publishClaimAndWait)
  const step1 = planOutput.steps[0];
  if (step1.satisfied) {
    steps.push({
      step: 1,
      repos: step1.repos.map((entry) => ({
        repo: entry.repo,
        branch: entry.headBranch,
        state: 'skipped',
      })),
    });
  } else {
    const step1Repos: ApplyRepoResult[] = [];
    steps.push({ step: 1, repos: step1Repos });
    const claimsRepoObj = claimsRepo(api, org, plan.context.claimsRepoName);
    const app = plan.context.inputs.app;

    try {
      await withAuditTrail(
        {
          repo: claimsRepoObj,
          operation: 'create',
          kind: 'ComponentClaim',
          name: `app-${app}`,
          change: {
            title: `Apply app ${app}`,
            goal: `Provision claims for app ${app}.`,
          },
        },
        options.audit ?? {},
        async (trail) => {
          auditIssue = trail.result().issue;

          for (const entry of step1.repos) {
            if (!entry.hasChanges) {
              step1Repos.push({
                repo: entry.repo,
                branch: entry.headBranch,
                state: 'skipped',
              });
              continue;
            }

            const file = entry.files[0];
            const claim = entry.claim;
            if (!file || !claim || file.content === undefined) {
              const reason = `Missing claim metadata or content for ${entry.repo}`;
              step1Repos.push({
                repo: entry.repo,
                branch: entry.headBranch,
                state: 'failed',
                reason,
              });
              throw new Error(reason);
            }

            let existingSha: string | undefined;
            if (file.outcome.kind === 'merge') {
              const existing = await api.readFile(
                claimsRepoObj.ref,
                file.path,
                entry.baseBranch,
              );
              existingSha = existing?.sha;
            }

            try {
              await publishClaimAndWait(
                {
                  repo: claimsRepoObj,
                  kind: claim.kind,
                  name: claim.name,
                  output: file.content,
                  path: file.path,
                  existingSha,
                  noWait,
                  waitForChecks: !noWait,
                  stateRepos,
                  audit: trail,
                },
                pulse,
              );
            } catch (error) {
              const reason = errorMessage(error);
              step1Repos.push({
                repo: entry.repo,
                branch: entry.headBranch,
                state: 'failed',
                reason,
              });
              throw error;
            }

            const pr = trail.result().pr;
            step1Repos.push({
              repo: entry.repo,
              branch: entry.headBranch,
              ...(pr ? { pr } : {}),
              state: noWait ? 'open' : 'provisioned',
            });
          }
        },
      );
    } catch (error) {
      const reason = errorMessage(error);
      return {
        outcome: 'failed',
        steps,
        ...(auditIssue ? { auditIssue } : {}),
        reason,
      };
    }

    if (noWait) {
      return {
        outcome: 'pending',
        steps,
        ...(auditIssue ? { auditIssue } : {}),
      };
    }
  }

  // Steps 2 and 3: open PRs on appPlanHeadBranch(app) and wait for human merge
  for (const stepPlan of [planOutput.steps[1], planOutput.steps[2]]) {
    if (stepPlan.satisfied) {
      steps.push({
        step: stepPlan.step,
        repos: stepPlan.repos.map((entry) => ({
          repo: entry.repo,
          branch: entry.headBranch,
          state: 'skipped',
        })),
      });
      continue;
    }

    const stepRepos: ApplyRepoResult[] = [];
    steps.push({ step: stepPlan.step, repos: stepRepos });
    const pending: Array<{
      index: number;
      ref: RepoRef;
      pr: ApplyPrRef;
      repo: string;
    }> = [];

    for (const entry of stepPlan.repos) {
      if (!entry.hasChanges) {
        stepRepos.push({
          repo: entry.repo,
          branch: entry.headBranch,
          state: 'skipped',
        });
        continue;
      }

      const ref = parseRepoRef(entry.repo);
      const existingPr = await api.findOpenPullRequest(ref, {
        head: entry.headBranch,
        base: entry.baseBranch,
      });

      if (existingPr) {
        const pr: ApplyPrRef = {
          number: existingPr.number,
          url: existingPr.htmlUrl,
        };
        const index =
          stepRepos.push({
            repo: entry.repo,
            branch: entry.headBranch,
            pr,
            state: 'open',
          }) - 1;
        pending.push({ index, ref, pr, repo: entry.repo });
        continue;
      }

      const baseSha = await api.branchHeadSha(ref, entry.baseBranch);
      try {
        await api.createBranch(ref, entry.headBranch, baseSha);
      } catch (error) {
        const reason = isBranchAlreadyExists(error)
          ? `Branch already exists: ${entry.headBranch} in ${entry.repo} with no open PR. Delete it before applying again.`
          : errorMessage(error);
        stepRepos.push({
          repo: entry.repo,
          branch: entry.headBranch,
          state: 'failed',
          reason,
        });
        return {
          outcome: 'failed',
          steps,
          ...(auditIssue ? { auditIssue } : {}),
          reason,
        };
      }

      for (const file of entry.files) {
        if (
          (file.outcome.kind !== 'create' && file.outcome.kind !== 'merge') ||
          file.content === undefined
        ) {
          continue;
        }
        let sha: string | undefined;
        if (file.outcome.kind === 'merge') {
          const existing = await api.readFile(ref, file.path, entry.baseBranch);
          sha = existing?.sha;
        }
        await api.commitFile(ref, {
          path: file.path,
          branch: entry.headBranch,
          message: `${entry.prTitle ?? 'chore: apply app'} (${file.path})`,
          content: file.content,
          ...(sha ? { sha } : {}),
        });
      }

      const created = await api.createPullRequest(ref, {
        head: entry.headBranch,
        base: entry.baseBranch,
        title: entry.prTitle ?? `feat(app): apply ${plan.context.inputs.app}`,
        body: buildPrBody(entry),
      });
      const pr: ApplyPrRef = { number: created.number, url: created.htmlUrl };
      const index =
        stepRepos.push({
          repo: entry.repo,
          branch: entry.headBranch,
          pr,
          state: 'open',
        }) - 1;
      pending.push({ index, ref, pr, repo: entry.repo });
    }

    if (noWait) {
      return {
        outcome: 'pending',
        steps,
        ...(auditIssue ? { auditIssue } : {}),
      };
    }

    // Poll getPullRequest until all pending PRs in this step are merged
    const deadline = now() + timeoutMs;
    const remaining = new Set(pending);
    while (remaining.size > 0) {
      for (const item of [...remaining]) {
        const status = await api.getPullRequest(item.ref, item.pr.number);
        if (status.merged) {
          stepRepos[item.index].state = 'merged';
          remaining.delete(item);
        } else if (status.state === 'closed') {
          const reason = `PR ${item.repo}#${item.pr.number} (${item.pr.url}) was closed without merging.`;
          stepRepos[item.index].state = 'failed';
          stepRepos[item.index].reason = reason;
          return {
            outcome: 'failed',
            steps,
            ...(auditIssue ? { auditIssue } : {}),
            reason,
          };
        }
      }

      if (remaining.size === 0) break;

      if (now() >= deadline) {
        const pendingList = [...remaining]
          .map((item) => {
            stepRepos[item.index].reason = 'timed out waiting for merge';
            return `${item.repo}#${item.pr.number} (${item.pr.url})`;
          })
          .join(', ');
        return {
          outcome: 'pending',
          steps,
          ...(auditIssue ? { auditIssue } : {}),
          reason: `Timed out waiting for PRs to merge: ${pendingList}`,
        };
      }

      await sleep(pollIntervalMs);
    }
  }

  return {
    outcome: 'done',
    steps,
    ...(auditIssue ? { auditIssue } : {}),
  };
}
