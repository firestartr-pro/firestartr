import { watchCheckRuns } from './checkRuns.js';
import { findCrOnMainBranch } from './stateRepo.js';
import { findWetPr } from './wetPr.js';

import type { AggregatedCheckResult, CheckRunResult } from './checkRuns.js';
import type { LastStatePrRedirect } from './wetPr.js';

import type { GitHubApi, RepoRef } from '../github/api.js';

const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/** A failing check names a run; a wide red PR must not produce a wall of text. */
const MAX_NAMED_FAILING_CHECKS = 5;

export class WetPrTimeoutError extends Error {
  readonly prUrl?: string;

  constructor(message: string, prUrl?: string) {
    super(message);
    this.name = 'WetPrTimeoutError';
    this.prUrl = prUrl;
  }
}

export interface WetPrCheckWatch {
  claimType: string;
  claimName: string;
  stateRepos: string[];
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function failedCheck(run: CheckRunResult): boolean {
  return !PASSING_CONCLUSIONS.has(run.conclusion ?? '');
}

/**
 * Names the wet PR and the checks that failed, so a user can go straight to
 * the red check run instead of reading the CLI source.
 */
export function describeWetPrFailure(
  conclusion: string,
  target: LastStatePrRedirect,
  result: AggregatedCheckResult,
): string {
  const pr = `${target.repo}#${target.number} https://github.com/${target.repo}/pull/${target.number}`;
  const failing = result.checkRuns
    .filter(failedCheck)
    .map((run) => (run.htmlUrl ? `${run.name} ${run.htmlUrl}` : run.name));
  const named = failing.slice(0, MAX_NAMED_FAILING_CHECKS);
  const rest = failing.length - named.length;
  const checks =
    rest > 0 ? `${named.join(', ')}, and +${rest} more` : named.join(', ');
  return `Wet PR checks failed: ${conclusion} (${checks ? `${pr}, ${checks}` : pr})`;
}

/**
 * Post-provision step shared by the claim mutations and the Feature mutations:
 * locate the wet (state repo) PR for the claim and watch its check runs until
 * completion. Throws when the checks do not all pass.
 */
export async function watchWetPrChecks(
  api: GitHubApi,
  ref: RepoRef,
  watch: WetPrCheckWatch,
  diagnostic: (line: string) => void,
): Promise<void> {
  const targets = new Map<string, LastStatePrRedirect>();
  for (const repo of watch.stateRepos) {
    const wetPr = await findWetPr(
      api,
      [repo],
      watch.claimType,
      watch.claimName,
    );
    if (wetPr) {
      const target = wetPr.lastStatePrRedirect ?? wetPr;
      targets.set(`${target.repo}#${target.number}`, target);
    } else {
      const crs = await findCrOnMainBranch(
        api,
        repo,
        watch.claimType,
        watch.claimName,
      );
      for (const cr of crs) {
        if (!cr.lastStatePr) continue;
        const { repo, number } = cr.lastStatePr;
        targets.set(`${repo}#${number}`, cr.lastStatePr);
      }
    }
  }

  if (targets.size === 0) {
    diagnostic('No wet PR found for this claim; skipping check watch.\n');
    return;
  }

  const now = watch.now ?? Date.now;
  const deadline =
    watch.timeoutMs !== undefined ? now() + watch.timeoutMs : undefined;

  for (const target of targets.values()) {
    diagnostic(`Watching wet PR ${target.repo}#${target.number}...\n`);
    const watchRepoName = target.repo.split('/')[1];
    const remainingMs =
      deadline !== undefined ? Math.max(0, deadline - now()) : undefined;
    const result = await watchCheckRuns(
      api,
      { owner: target.owner, repo: watchRepoName },
      target.number,
      {
        waitForRegistration: true,
        ...(remainingMs !== undefined ? { timeoutMs: remainingMs } : {}),
        ...(watch.pollIntervalMs !== undefined
          ? { pollIntervalMs: watch.pollIntervalMs }
          : {}),
        ...(watch.now ? { now: watch.now } : {}),
        ...(watch.sleep ? { sleep: watch.sleep } : {}),
      },
    );
    if (result.overallConclusion === 'timeout') {
      throw new WetPrTimeoutError(
        `Wet PR checks failed: ${result.overallConclusion}`,
        `https://github.com/${target.repo}/pull/${target.number}`,
      );
    }
    if (result.overallConclusion !== 'success') {
      throw new Error(
        describeWetPrFailure(result.overallConclusion, target, result),
      );
    }
  }
  diagnostic('All checks passed ✓\n');
}
