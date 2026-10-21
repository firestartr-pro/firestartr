import { watchCheckRuns } from './checkRuns.js';
import { findCrOnMainBranch } from './stateRepo.js';
import { findWetPr, parseStateRepos } from './wetPr.js';

import type { LastStatePrRedirect } from './wetPr.js';

import type { GitHubApi, RepoRef } from '../github/api.js';

export interface WetPrCheckWatch {
  claimType: string;
  claimName: string;
  /** Comma-separated state repos; defaults to `<org>/state-github,<org>/state-infra`. */
  stateRepos?: string;
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
  const repos = parseStateRepos(watch.stateRepos, ref.owner);
  const targets = new Map<string, LastStatePrRedirect>();
  for (const repo of repos) {
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
      // Provisioning can merge the wet PR before it completes. The rendered CRs
      // retain its identity even when it is no longer in the open-PR listing.
      const crs = await findCrOnMainBranch(
        api,
        repo,
        watch.claimType,
        watch.claimName,
      );
      for (const cr of crs) {
        if (!cr.lastStatePr) continue;
        const { repo, number } = cr.lastStatePr;
        targets.set(`${repo}#${number}`, {
          owner: repo.split('/')[0],
          repo,
          number,
        });
      }
    }
  }

  if (targets.size === 0) {
    diagnostic('No wet PR found for this claim; skipping check watch.\n');
    return;
  }

  for (const target of targets.values()) {
    diagnostic(`Watching wet PR ${target.repo}#${target.number}...\n`);
    const watchRepoName = target.repo.split('/')[1];
    const result = await watchCheckRuns(
      api,
      { owner: target.owner, repo: watchRepoName },
      target.number,
    );
    if (result.overallConclusion !== 'success') {
      throw new Error(`Wet PR checks failed: ${result.overallConclusion}`);
    }
  }
  diagnostic('All checks passed ✓\n');
}
