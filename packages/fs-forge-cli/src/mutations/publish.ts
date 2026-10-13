import { claimExists } from '../claims/claimsMap.js';
import { loadClaimsMap, publishClaim } from '../claims/claimsRepo.js';
import { findWetPr, parseStateRepos } from '../claims/wetPr.js';
import { watchCheckRuns } from '../claims/checkRuns.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';

import type { ClaimsRepo } from '../claims/claimsRepo.js';
import type { ClaimKindName } from '../claims/kinds.js';

export interface ClaimPublishRequest {
  repo: ClaimsRepo;
  kind: ClaimKindName;
  name: string;
  output: string;
  path?: string;
  existingSha?: string;
  noWait: boolean;
  waitForChecks: boolean;
  stateRepos?: string;
  /** Create only: reject a claim that already exists in the claims map. */
  rejectExistingClaim?: boolean;
}

export interface Pulse {
  output(line: string): void;
  diagnostic(line: string): void;
}

export interface ClaimPublishResult {
  publishUrl: string;
}

/**
 * Publishes a claim and (unless `--no-wait`) polls its provision workflow,
 * optionally watching the wet PR check runs. Presentation is injected so the
 * callers keep their exact output plumbing.
 */
export async function publishClaimAndWait(
  request: ClaimPublishRequest,
  pulse: Pulse,
): Promise<ClaimPublishResult> {
  const {
    repo,
    kind,
    name,
    output,
    path,
    existingSha,
    noWait,
    waitForChecks,
    stateRepos,
    rejectExistingClaim,
  } = request;

  pulse.output(output);

  if (rejectExistingClaim) {
    const map = await loadClaimsMap(repo);
    if (claimExists(map, kind, name)) {
      throw new Error(`Claim already exists: ${kind}-${name}`);
    }
  }
  if (!path) {
    throw new Error(
      `A destination path is required to publish ${kind}-${name}`,
    );
  }

  const dispatch = await publishClaim(repo, {
    kind,
    name,
    path,
    yaml: output,
    existingSha,
  });

  const publishUrl = await waitForDispatch(repo.api, repo.ref, dispatch, {
    noWait,
    claimType: kind,
    claimName: name,
    label: 'Provisioning',
  });

  if (waitForChecks && !noWait) {
    const repos = parseStateRepos(stateRepos, repo.ref.owner);
    const wetPr = await findWetPr(repo.api, repos, kind, name);

    if (wetPr) {
      pulse.diagnostic(`Watching wet PR ${wetPr.repo}#${wetPr.number}...\n`);
      const watchRepoName = wetPr.repo.split('/')[1];
      const result = await watchCheckRuns(
        repo.api,
        { owner: wetPr.owner, repo: watchRepoName },
        wetPr.number,
      );
      if (result.overallConclusion !== 'success') {
        throw new Error(`Wet PR checks failed: ${result.overallConclusion}`);
      }
      pulse.diagnostic('All checks passed ✓\n');
    } else {
      pulse.diagnostic(
        'No wet PR found for this claim; skipping check watch.\n',
      );
    }
  }

  return { publishUrl };
}
