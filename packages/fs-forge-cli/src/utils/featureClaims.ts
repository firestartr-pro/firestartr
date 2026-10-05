import { readFile } from 'fs/promises';

import {
  claimsRepo,
  loadClaimsMap,
  publishClaim,
  resolveClaim,
} from '../claims/claimsRepo.js';
import { deterministicPath } from '../claims/deterministicPath.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { createGitHubApi } from '../github/index.js';
import { parseClaimYaml, requireOrg } from '../mutations/support.js';

import type { ClaimsRepo, WorkflowDispatch } from '../claims/claimsRepo.js';

export interface ComponentPublish {
  dispatch: WorkflowDispatch;
  repo: ClaimsRepo;
}

export interface ComponentTarget {
  claim: Record<string, unknown>;
  name: string;
  publish(output: string): Promise<ComponentPublish | undefined>;
}

export async function loadComponentTarget(options: {
  component?: string;
  file?: string;
  org?: string;
  commit?: boolean;
}): Promise<ComponentTarget> {
  if (Boolean(options.component) === Boolean(options.file)) {
    throw new Error(
      'Provide exactly one target: positional COMPONENT or --file <path>',
    );
  }

  if (options.file) {
    const claim = parseClaimYaml(await readFile(options.file, 'utf8'));
    const name = assertComponentClaim(claim);
    return {
      claim,
      name,
      publish: async (output) => {
        if (!options.commit) return undefined;
        const repo = claimsRepo(createGitHubApi(), requireOrg(options.org));
        const path = deterministicPath('ComponentClaim', name);
        const branch = await repo.api.getDefaultBranch(repo.ref);
        const current = await repo.api.readFile(repo.ref, path, branch);
        return {
          repo,
          dispatch: await publishClaim(repo, {
            kind: 'ComponentClaim',
            name,
            path,
            yaml: output,
            existingSha: current?.sha,
          }),
        };
      },
    };
  }

  const repo = claimsRepo(createGitHubApi(), requireOrg(options.org));
  const map = await loadClaimsMap(repo);
  const source = await resolveClaim(
    repo,
    map,
    `ComponentClaim-${options.component}`,
  );
  const claim = parseClaimYaml(source.content);
  const name = assertComponentClaim(claim, options.component);
  return {
    claim,
    name,
    publish: async (output) =>
      options.commit
        ? {
            repo,
            dispatch: await publishClaim(repo, {
              kind: 'ComponentClaim',
              name,
              path: source.filePath,
              yaml: output,
              existingSha: source.sha,
            }),
          }
        : undefined,
  };
}

export function assertComponentClaim(
  claim: Record<string, unknown>,
  expectedName?: string,
): string {
  if (claim.kind !== 'ComponentClaim') {
    throw new Error('Feature operations require a ComponentClaim');
  }
  if (typeof claim.name !== 'string' || !claim.name) {
    throw new Error('ComponentClaim is missing a valid name');
  }
  if (expectedName !== undefined && claim.name !== expectedName) {
    throw new Error(
      `Resolved claim identity does not match ComponentClaim-${expectedName}`,
    );
  }
  return claim.name;
}

export function formatClaim(
  claim: Record<string, unknown>,
  json: boolean,
): string {
  return json ? JSON.stringify(claim, null, 2) : serializeClaim(claim);
}

export async function writeAndPublishClaim(
  target: ComponentTarget,
  claim: Record<string, unknown>,
  json: boolean,
): Promise<ComponentPublish | undefined> {
  process.stdout.write(`${formatClaim(claim, json)}\n`);
  return target.publish(formatClaim(claim, false));
}
