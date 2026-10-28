import { claimExists } from '../claims/claimsMap.js';
import { loadClaimsMap, publishClaim } from '../claims/claimsRepo.js';
import { watchWetPrChecks } from '../claims/wetPrChecks.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';

import type { AuditTrail } from './auditIssue.js';
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
  /** Opens or links the audit issue around the claim PR. */
  audit?: AuditTrail;
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
    audit,
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

  const dispatch = await publishClaim(
    repo,
    {
      kind,
      name,
      path,
      yaml: output,
      existingSha,
    },
    audit,
  );

  const publishUrl = await waitForDispatch(repo.api, repo.ref, dispatch, {
    noWait,
    claimType: kind,
    claimName: name,
    label: 'Provisioning',
    extra: audit?.result(),
  });

  // Only a successful publish has a run to record; failures are reported by
  // the caller's audit trail.
  await audit?.commentRunUrl(publishUrl);

  if (waitForChecks && !noWait) {
    await watchWetPrChecks(
      repo.api,
      repo.ref,
      { claimType: kind, claimName: name, stateRepos },
      pulse.diagnostic,
    );
  }

  return { publishUrl };
}
