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
import { createClaimValidator } from '../utils/ajvValidation.js';
import { validateFeatureArgs } from '../utils/featureSchema.js';
import {
  getFeatureReferences,
  mutateFeatureReference,
} from '../utils/features.js';
import { waitForDispatch } from '../utils/waitForDispatch.js';

import type { ClaimsRepo, WorkflowDispatch } from '../claims/claimsRepo.js';
import type { FeatureReference } from '../utils/features.js';

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
  repo?: ClaimsRepo;
}): Promise<ComponentTarget> {
  if (Boolean(options.component) === Boolean(options.file)) {
    throw new Error(
      'Provide exactly one target: positional COMPONENT or --file <path>',
    );
  }

  const repo = () =>
    options.repo ?? claimsRepo(createGitHubApi(), requireOrg(options.org));

  if (options.file) {
    const claim = parseClaimYaml(await readFile(options.file, 'utf8'));
    const name = assertComponentClaim(claim);
    return {
      claim,
      name,
      publish: async (output) => {
        if (!options.commit) return undefined;
        const target = repo();
        const path = deterministicPath('ComponentClaim', name);
        const branch = await target.api.getDefaultBranch(target.ref);
        const current = await target.api.readFile(target.ref, path, branch);
        return {
          repo: target,
          dispatch: await publishClaim(target, {
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

  const target = repo();
  const map = await loadClaimsMap(target);
  const source = await resolveClaim(
    target,
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
            repo: target,
            dispatch: await publishClaim(target, {
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

function assertComponentClaim(
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

function formatClaim(claim: Record<string, unknown>, json: boolean): string {
  return json ? JSON.stringify(claim, null, 2) : serializeClaim(claim);
}

/** Merges an edit payload over the stored reference, preserving its pin. */
function mergeFeatureReference(
  existing: FeatureReference,
  feature: FeatureReference,
): FeatureReference {
  const merged: FeatureReference = {
    ...existing,
    ...feature,
    args: { ...existing.args, ...(feature.args ?? {}) },
  };
  if (feature.version !== undefined) delete merged.ref;
  if (feature.ref !== undefined) delete merged.version;
  return merged;
}

export interface FeatureMutationRequest {
  operation: 'add' | 'edit' | 'remove';
  component?: string;
  file?: string;
  org?: string;
  commit?: boolean;
  noWait?: boolean;
  json: boolean;
  feature?: FeatureReference;
  featureSchema?: Record<string, unknown>;
}

export interface FeatureMutationResult {
  claim: Record<string, unknown>;
  output: string;
  publishUrl?: string;
}

/**
 * The Feature mutation pipeline shared by `features add`, `features edit` and
 * `features remove`: load the ComponentClaim, mutate one Feature reference,
 * validate, present, and optionally publish and wait.
 */
export async function runFeatureMutation(
  request: FeatureMutationRequest,
  deps: { repo?: ClaimsRepo; schemasDir: string },
): Promise<FeatureMutationResult> {
  const target = await loadComponentTarget({
    component: request.component,
    file: request.file,
    org: request.org,
    commit: request.commit,
    repo: deps.repo,
  });

  let claim: Record<string, unknown>;
  if (request.operation === 'remove') {
    const name = request.feature?.name;
    if (!name) throw new Error('A Feature name is required');
    claim = mutateFeatureReference(target.claim, 'remove', { name });
  } else {
    const feature = request.feature;
    if (!feature?.name) throw new Error('A Feature name is required');
    if (request.featureSchema) {
      const argsValidation = validateFeatureArgs(
        request.featureSchema,
        feature.args ?? {},
      );
      if (!argsValidation.valid) {
        throw new Error(argsValidation.errors.join('\n'));
      }
    }
    if (request.operation === 'edit') {
      const existing = getFeatureReferences(target.claim).find(
        (reference) => reference.name === feature.name,
      );
      if (!existing) throw new Error(`Feature not found: ${feature.name}`);
      claim = mutateFeatureReference(
        target.claim,
        'edit',
        mergeFeatureReference(existing, feature),
      );
    } else {
      claim = mutateFeatureReference(target.claim, 'add', feature);
    }
  }

  const validator = createClaimValidator({ schemasDir: deps.schemasDir });
  const claimValidation = await validator.validate(claim, 'ComponentClaim');
  if (!claimValidation.valid) {
    throw new Error(claimValidation.errors.join('\n'));
  }

  const output = serializeClaim(claim);
  process.stdout.write(`${formatClaim(claim, request.json)}\n`);

  const published = await target.publish(output);
  if (!published) return { claim, output };

  const publishUrl = await waitForDispatch(
    published.repo.api,
    published.repo.ref,
    published.dispatch,
    {
      noWait: request.noWait,
      claimType: 'ComponentClaim',
      claimName: target.name,
      label: 'Provisioning',
    },
  );
  return { claim, output, publishUrl };
}
