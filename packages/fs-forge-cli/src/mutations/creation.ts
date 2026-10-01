import { claimExists, loadClaimsMap } from '../claims/claimsMap.js';
import { ClaimsClient } from '../claims/client.js';
import { deterministicPath } from '../claims/deterministicPath.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { watchCheckRuns } from '../claims/checkRuns.js';
import { findWetPr, parseStateRepos } from '../claims/wetPr.js';
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
    const client = commit ? new ClaimsClient(requireOrg(org)) : undefined;
    const output = serializeClaim(claim);
    writeOutput(output);
    if (!client || !destinationPath) return { output };

    const map = await loadClaimsMap(client);
    const reference = `${kind}-${name}`;
    if (claimExists(map, kind, name)) {
      throw new Error(`Claim already exists: ${reference}`);
    }
    const dispatchResult = await client.publishClaim(
      kind,
      name,
      destinationPath,
      output,
    );

    const publishUrl = await waitForDispatch(client, dispatchResult, {
      noWait,
      claimType: kind,
      claimName: name,
      label: 'Provisioning',
    });

    if (waitForChecks && !noWait) {
      const orgName = requireOrg(org);
      const repos = parseStateRepos(stateRepos, orgName);
      const wetPr = await findWetPr(client, repos, kind, name);

      if (wetPr) {
        writeDiagnostic(`Watching wet PR ${wetPr.repo}#${wetPr.number}...\n`);
        const watchRepoName = wetPr.repo.split('/')[1];
        const result = await watchCheckRuns(
          client,
          wetPr.owner,
          watchRepoName,
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
