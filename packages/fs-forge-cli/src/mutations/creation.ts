import {
  claimsRepo,
  loadClaimsMap,
  publishClaim,
} from '../claims/claimsRepo.js';
import { claimExists } from '../claims/claimsMap.js';
import { deterministicPath } from '../claims/deterministicPath.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { watchCheckRuns } from '../claims/checkRuns.js';
import { findWetPr, parseStateRepos } from '../claims/wetPr.js';
import { createGitHubApi } from '../github/index.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';
import { requireOrg } from './support.js';

import type { ClaimKind } from './definitions.js';

export interface ClaimCreationOptions {
  org?: string;
  kind: ClaimKind;
  name: string;
  claim: Record<string, unknown>;
  commit?: boolean;
  noWait?: boolean;
  waitForChecks?: boolean;
  stateRepos?: string;
  path?: string;
  writeOutput: (output: string) => void;
  writeDiagnostic: (output: string) => void;
}

export interface ClaimCreationResult {
  output: string;
  publishUrl?: string;
}

export async function runClaimCreation(
  options: ClaimCreationOptions,
): Promise<ClaimCreationResult> {
  try {
    const {
      org,
      kind,
      name,
      claim,
      commit = false,
      noWait = false,
      waitForChecks = false,
      stateRepos,
      path,
      writeOutput,
      writeDiagnostic,
    } = options;
    const destinationPath = commit
      ? deterministicPath(kind, name, path)
      : undefined;
    const orgName = commit ? requireOrg(org) : undefined;
    const repo =
      commit && orgName ? claimsRepo(createGitHubApi(), orgName) : undefined;
    const output = serializeClaim(claim);
    writeOutput(output);
    if (!repo || !destinationPath) return { output };

    const map = await loadClaimsMap(repo);
    const reference = `${kind}-${name}`;
    if (claimExists(map, kind, name)) {
      throw new Error(`Claim already exists: ${reference}`);
    }
    const dispatchResult = await publishClaim(repo, {
      kind,
      name,
      path: destinationPath,
      yaml: output,
    });

    const publishUrl = await waitForDispatch(
      repo.api,
      repo.ref,
      dispatchResult,
      {
        noWait,
        claimType: kind,
        claimName: name,
        label: 'Provisioning',
      },
    );

    if (waitForChecks && !noWait) {
      const repos = parseStateRepos(stateRepos, requireOrg(org));
      const wetPr = await findWetPr(repo.api, repos, kind, name);

      if (wetPr) {
        writeDiagnostic(`Watching wet PR ${wetPr.repo}#${wetPr.number}...\n`);
        const watchRepoName = wetPr.repo.split('/')[1];
        const result = await watchCheckRuns(
          repo.api,
          { owner: wetPr.owner, repo: watchRepoName },
          wetPr.number,
        );
        if (result.overallConclusion !== 'success') {
          throw new Error(`Wet PR checks failed: ${result.overallConclusion}`);
        }
        writeDiagnostic('All checks passed ✓\n');
      } else {
        writeDiagnostic(
          'No wet PR found for this claim; skipping check watch.\n',
        );
      }
    }

    return { output, publishUrl };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Claim creation failed: ${String(error)}`);
  }
}
