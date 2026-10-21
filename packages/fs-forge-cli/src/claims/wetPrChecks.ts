import { watchCheckRuns } from './checkRuns.js';
import { findWetPr, parseStateRepos } from './wetPr.js';

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
  const wetPr = await findWetPr(api, repos, watch.claimType, watch.claimName);

  if (!wetPr) {
    diagnostic('No wet PR found for this claim; skipping check watch.\n');
    return;
  }

  const target = wetPr.lastStatePrRedirect ?? wetPr;
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
  diagnostic('All checks passed ✓\n');
}
