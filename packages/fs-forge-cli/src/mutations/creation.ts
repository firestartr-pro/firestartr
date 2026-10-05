import { claimsRepo } from '../claims/claimsRepo.js';
import { deterministicPath } from '../claims/deterministicPath.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { createGitHubApi } from '../github/index.js';
import { publishClaimAndWait } from './publish.js';
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
    if (!repo || !destinationPath) {
      writeOutput(output);
      return { output };
    }

    const { publishUrl } = await publishClaimAndWait(
      {
        repo,
        kind,
        name,
        output,
        path: destinationPath,
        noWait,
        waitForChecks,
        stateRepos,
        rejectExistingClaim: true,
      },
      { output: writeOutput, diagnostic: writeDiagnostic },
    );
    return { output, publishUrl };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Claim creation failed: ${String(error)}`);
  }
}
