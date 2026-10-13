import { randomUUID } from 'crypto';
import { posix } from 'path';

import { parseClaimsMap } from './claimsMap.js';
import { KIND_REGISTRY } from './kindRegistry.js';
import { isNotFoundError } from '../github/api.js';

import type { ClaimsMap, ResolvedClaim } from './claimsMap.js';
import type { GitHubApi, RepoRef } from '../github/api.js';

export interface ClaimsRepo {
  readonly ref: RepoRef;
  readonly api: GitHubApi;
}

export interface WorkflowDispatch {
  url: string;
  correlationId: string;
  workflowId: string;
  branch: string;
}

function isBranchAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 422 &&
    'message' in error &&
    typeof error.message === 'string' &&
    /reference already exists/i.test(error.message)
  );
}

export function claimsRepo(
  api: GitHubApi,
  org: string,
  repoName = 'claims',
): ClaimsRepo {
  return { api, ref: { owner: org, repo: repoName } };
}

async function hasInFlightClaimsMapWorkflow(
  repo: ClaimsRepo,
): Promise<boolean> {
  const branch = await repo.api.getDefaultBranch(repo.ref);
  try {
    const runs = await repo.api.listWorkflowRuns(repo.ref, {
      workflowId: 'generate-claims-map.yaml',
      branch,
    });
    return runs.some(
      (run) => run.status === 'queued' || run.status === 'in_progress',
    );
  } catch (error) {
    // A repo without the generation workflow has no runs in flight.
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

export async function loadClaimsMap(
  repo: ClaimsRepo,
  options: {
    wait?: (milliseconds: number) => Promise<void>;
    maxAttempts?: number;
  } = {},
): Promise<ClaimsMap> {
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = options.maxAttempts ?? 30;

  for (let attempt = 0; await hasInFlightClaimsMapWorkflow(repo); attempt++) {
    if (attempt >= maxAttempts) {
      throw new Error('Timed out waiting for claims-map generation');
    }
    await wait(2000);
  }

  const current = await repo.api.readFile(
    repo.ref,
    'claims-map.json',
    'claims-index',
  );
  if (current) return parseClaimsMap(current.content);

  const stale = await repo.api.readFile(
    repo.ref,
    'claims-map.json.stale',
    'claims-index',
  );
  if (stale) {
    throw new Error(
      'The claims map is stale; wait for generate-claims-map.yaml to recover',
    );
  }
  throw new Error('The claims repo does not have a claims map yet');
}

export async function resolveClaim(
  repo: ClaimsRepo,
  map: ClaimsMap,
  reference: string,
): Promise<ResolvedClaim> {
  const entry = map.claims[reference];
  if (!entry) throw new Error(`Claim not found: ${reference}`);

  const normalized = posix.normalize(entry.filePath);
  if (
    normalized !== entry.filePath ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    posix.isAbsolute(normalized)
  ) {
    throw new Error(`Invalid claim path in claims map: ${entry.filePath}`);
  }

  const defaultBranch = await repo.api.getDefaultBranch(repo.ref);
  const file = await repo.api.readFile(
    repo.ref,
    `claims/${normalized}`,
    defaultBranch,
  );
  if (!file) {
    throw new Error(`Claim file is missing: claims/${normalized}`);
  }
  return { ...file, filePath: `claims/${normalized}` };
}

export async function publishClaim(
  repo: ClaimsRepo,
  input: {
    kind: string;
    name: string;
    path: string;
    yaml: string;
    existingSha?: string;
  },
): Promise<WorkflowDispatch> {
  const { kind, name, path, yaml, existingSha } = input;
  const correlationId = randomUUID();
  const defaultBranch = await repo.api.getDefaultBranch(repo.ref);
  const baseSha = await repo.api.branchHeadSha(repo.ref, defaultBranch);
  const branch = `fs-forge/${kind}-${name}`;

  try {
    await repo.api.createBranch(repo.ref, branch, baseSha);
  } catch (error) {
    if (isBranchAlreadyExists(error)) {
      throw new Error(
        `Branch already exists: ${branch}. Delete it before publishing again.`,
      );
    }
    throw error;
  }

  await repo.api.commitFile(repo.ref, {
    path,
    branch,
    message: `${kind}-${name}: update claim`,
    content: yaml,
    ...(existingSha ? { sha: existingSha } : {}),
  });
  await repo.api.dispatchWorkflow(repo.ref, {
    workflowId: 'provision-claim.yaml',
    gitRef: branch,
    inputs: {
      claimType: kind,
      claimName: name,
      correlationId,
      skipHydration:
        KIND_REGISTRY[kind as keyof typeof KIND_REGISTRY]?.catalogOnly === true,
    },
  });

  return {
    url: `https://github.com/${repo.ref.owner}/${repo.ref.repo}/actions/workflows/provision-claim.yaml`,
    correlationId,
    workflowId: 'provision-claim.yaml',
    branch,
  };
}

export async function dispatchUnprovision(
  repo: ClaimsRepo,
  input: {
    kind: string;
    name: string;
    includeVariants?: boolean;
    waitForClaimChecks?: boolean;
  },
): Promise<WorkflowDispatch> {
  const correlationId = randomUUID();
  const defaultBranch = await repo.api.getDefaultBranch(repo.ref);

  await repo.api.dispatchWorkflow(repo.ref, {
    workflowId: 'unprovision-claim.yaml',
    gitRef: defaultBranch,
    inputs: {
      claimType: input.kind,
      claimName: input.name,
      correlationId,
      includeVariants: input.includeVariants ?? true,
      waitForClaimChecks: input.waitForClaimChecks ?? false,
    },
  });

  return {
    url: `https://github.com/${repo.ref.owner}/${repo.ref.repo}/actions/workflows/unprovision-claim.yaml`,
    correlationId,
    workflowId: 'unprovision-claim.yaml',
    branch: defaultBranch,
  };
}
