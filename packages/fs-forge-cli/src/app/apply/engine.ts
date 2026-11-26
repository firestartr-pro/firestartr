import { claimsRepo, isBranchAlreadyExists } from '../../claims/claimsRepo.js';
import { WetPrTimeoutError } from '../../claims/wetPrChecks.js';
import { withAuditTrail } from '../../mutations/auditIssue.js';
import { publishClaimAndWait } from '../../mutations/publish.js';
import { DispatchTimeoutError } from '../../utils/waitForDispatch.js';
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

function step2MergeFirstHint(params: {
  org: string;
  app: string;
  repos: ApplyRepoResult[];
}): string | undefined {
  const dotFirestartr = params.repos.find(
    (repo) => repo.repo === `${params.org}/.firestartr`,
  );
  const stateApp = params.repos.find(
    (repo) => repo.repo === `${params.org}/app-${params.app}`,
  );
  if (!dotFirestartr?.pr || dotFirestartr.state !== 'open') return undefined;
  if (!stateApp?.pr || stateApp.state !== 'open') return undefined;
  return `Merge ${dotFirestartr.repo}#${dotFirestartr.pr.number} (${dotFirestartr.pr.url}) first: the ${params.org}/app-${params.app} validate-changes check reads the app name from .firestartr apps/${params.app}.yaml.`;
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
    const step1Deadline = now() + timeoutMs;
    let step1TimedOut: { reason: string } | undefined;

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

            const remainingMs = step1Deadline - now();
            if (!noWait && remainingMs <= 0) {
              const reason = `Timed out waiting for claim ${claim.kind}/${claim.name} to provision.`;
              step1Repos.push({
                repo: entry.repo,
                branch: entry.headBranch,
                state: 'open',
                reason,
              });
              step1TimedOut = { reason };
              break;
            }

            try {
              let existingSha: string | undefined;
              if (file.outcome.kind === 'merge') {
                const existing = await api.readFile(
                  claimsRepoObj.ref,
                  file.path,
                  entry.baseBranch,
                );
                existingSha = existing?.sha;
              }

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
                  timeoutMs: remainingMs,
                  pollIntervalMs,
                  now,
                  sleep,
                },
                pulse,
              );
            } catch (error) {
              if (
                error instanceof DispatchTimeoutError ||
                error instanceof WetPrTimeoutError
              ) {
                const refUrl =
                  error instanceof DispatchTimeoutError
                    ? error.runUrl
                    : error.prUrl;
                const pr = trail.result().pr;
                const detail = refUrl
                  ? ` (${refUrl})`
                  : pr
                    ? ` (${pr.url})`
                    : '';
                const reason = `Timed out waiting for claim ${claim.kind}/${claim.name}${detail}: ${error.message}`;
                step1Repos.push({
                  repo: entry.repo,
                  branch: entry.headBranch,
                  ...(pr ? { pr } : {}),
                  state: 'open',
                  reason,
                });
                step1TimedOut = { reason };
                break;
              }

              const reason = `${claim.kind}/${claim.name}: ${errorMessage(error)}`;
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

    if (step1TimedOut) {
      return {
        outcome: 'pending',
        steps,
        ...(auditIssue ? { auditIssue } : {}),
        reason: step1TimedOut.reason,
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
    const mergeFirstHint = () =>
      stepPlan.step === 2
        ? step2MergeFirstHint({
            org,
            app: plan.context.inputs.app,
            repos: stepRepos,
          })
        : undefined;
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
      try {
        const openPrs = (
          await api.listOpenPullRequests(ref, entry.headBranch)
        ).filter((candidate) => candidate.headRef === entry.headBranch);

        if (openPrs.length > 1) {
          const prList = openPrs
            .map((p) => `${entry.repo}#${p.number} (${p.htmlUrl})`)
            .join(', ');
          const reason = `Multiple open PRs found for ${entry.headBranch} in ${entry.repo}: ${prList}. Close the duplicate PR(s) before applying again.`;
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

        if (openPrs.length === 1) {
          const existingPr = openPrs[0];
          const pr: ApplyPrRef = {
            number: existingPr.number,
            url: existingPr.htmlUrl,
          };
          const plannedFiles = entry.files.filter(
            (file) =>
              (file.outcome.kind === 'create' ||
                file.outcome.kind === 'merge') &&
              file.content !== undefined,
          );
          const plannedPaths = new Set(plannedFiles.map((file) => file.path));
          const prFiles = await api.listPullRequestFiles(
            ref,
            existingPr.number,
          );
          const extraPaths = prFiles
            .map((file) => file.filename)
            .filter((filename) => !plannedPaths.has(filename));
          if (extraPaths.length > 0) {
            const reason = `Open PR ${entry.repo}#${existingPr.number} (${existingPr.htmlUrl}) touches files outside the current plan: ${extraPaths.join(', ')}. Update or close the PR before applying again.`;
            stepRepos.push({
              repo: entry.repo,
              branch: entry.headBranch,
              pr,
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

          const mismatched: string[] = [];
          for (const file of plannedFiles) {
            const onBranch = await api.readFile(
              ref,
              file.path,
              entry.headBranch,
            );
            if (
              !onBranch ||
              normalizeEol(onBranch.content) !== normalizeEol(file.content!)
            ) {
              mismatched.push(file.path);
            }
          }
          if (mismatched.length > 0) {
            const reason = `Open PR ${entry.repo}#${existingPr.number} (${existingPr.htmlUrl}) does not match the current plan for: ${mismatched.join(', ')}. Update or close the PR before applying again.`;
            stepRepos.push({
              repo: entry.repo,
              branch: entry.headBranch,
              pr,
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
        await api.createBranch(ref, entry.headBranch, baseSha);

        for (const file of entry.files) {
          if (
            (file.outcome.kind !== 'create' && file.outcome.kind !== 'merge') ||
            file.content === undefined
          ) {
            continue;
          }
          let sha: string | undefined;
          if (file.outcome.kind === 'merge') {
            const existing = await api.readFile(
              ref,
              file.path,
              entry.baseBranch,
            );
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
    }

    if (noWait) {
      const hint = mergeFirstHint();
      return {
        outcome: 'pending',
        steps,
        ...(auditIssue ? { auditIssue } : {}),
        ...(hint ? { reason: hint } : {}),
      };
    }

    // Poll getPullRequest until all pending PRs in this step are merged
    const deadline = now() + timeoutMs;
    const remaining = new Set(pending);
    while (remaining.size > 0) {
      for (const item of [...remaining]) {
        let status;
        try {
          status = await api.getPullRequest(item.ref, item.pr.number);
        } catch (error) {
          const reason = errorMessage(error);
          stepRepos[item.index].state = 'failed';
          stepRepos[item.index].reason = reason;
          return {
            outcome: 'failed',
            steps,
            ...(auditIssue ? { auditIssue } : {}),
            reason,
          };
        }
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
        const hint = mergeFirstHint();
        const timedOut = `Timed out waiting for PRs to merge: ${pendingList}`;
        return {
          outcome: 'pending',
          steps,
          ...(auditIssue ? { auditIssue } : {}),
          reason: hint ? `${timedOut}. ${hint}` : timedOut,
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

function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, '\n');
}
