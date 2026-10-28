import { claimExists } from '../claims/claimsMap.js';
import { loadClaimsMap, publishClaim } from '../claims/claimsRepo.js';
import { watchWetPrChecks } from '../claims/wetPrChecks.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';

import type { ClaimsRepo, WorkflowDispatch } from '../claims/claimsRepo.js';
import type { ClaimKindName } from '../claims/kinds.js';
import type { WetPrCheckWatch } from '../claims/wetPrChecks.js';
import type { GitHubApi, RepoRef } from '../github/api.js';

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

export interface ProvisionWait extends WetPrCheckWatch {
  noWait?: boolean;
  waitForChecks?: boolean;
}

/**
 * The wait that follows a publish, shared by the claim mutations and the
 * Feature mutations: poll the provision workflow run, then watch the wet PR
 * check runs it produced — skipped entirely by `--no-wait`.
 */
export async function waitForProvision(
  api: GitHubApi,
  ref: RepoRef,
  dispatch: WorkflowDispatch,
  wait: ProvisionWait,
  diagnostic: (line: string) => void,
): Promise<string> {
  const publishUrl = await waitForDispatch(api, ref, dispatch, {
    noWait: wait.noWait,
    claimType: wait.claimType,
    claimName: wait.claimName,
    label: 'Provisioning',
  });

  if (wait.waitForChecks && !wait.noWait) {
    await watchWetPrChecks(api, ref, wait, diagnostic);
  }

  return publishUrl;
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

  const publishUrl = await waitForProvision(
    repo.api,
    repo.ref,
    dispatch,
    { claimType: kind, claimName: name, noWait, waitForChecks, stateRepos },
    pulse.diagnostic,
  );

  return { publishUrl };
}
