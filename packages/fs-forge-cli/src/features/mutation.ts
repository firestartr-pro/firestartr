import { Errors } from '@oclif/core';
import { readFile } from 'fs/promises';

import {
  claimsRepo,
  loadClaimsMap,
  resolveClaim,
} from '../claims/claimsRepo.js';
import { deterministicPath } from '../claims/deterministicPath.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { createGitHubApi } from '../github/index.js';
import { withAuditTrail } from '../mutations/auditIssue.js';
import { publishClaimAndWait } from '../mutations/publish.js';
import { parseClaimYaml, requireOrg } from '../mutations/support.js';
import { mergeObjects } from '../utils/mutateClaim.js';
import { createClaimValidator } from '../utils/ajvValidation.js';
import { validateFeatureArgs } from '../utils/featureSchema.js';
import {
  getFeatureReferences,
  mutateFeatureReference,
} from '../utils/features.js';

import type {
  AuditOperation,
  AuditTrailOptions,
} from '../mutations/auditIssue.js';
import type { ClaimsRepo } from '../claims/claimsRepo.js';
import type { FeatureReference } from '../utils/features.js';

/** Where a commit writes the claim, and the sha it replaces. */
interface ComponentDestination {
  path: string;
  existingSha?: string;
}

export interface ComponentTarget {
  claim: Record<string, unknown>;
  name: string;
  /** The claims repo this target already resolved, if any. */
  repo?: ClaimsRepo;
  /** The claims-repo destination of a commit; resolved only when committing. */
  destination(repo: ClaimsRepo): Promise<ComponentDestination>;
}

export async function loadComponentTarget(options: {
  component?: string;
  file?: string;
  org?: string;
  repo?: ClaimsRepo;
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
      repo: options.repo,
      async destination(repo) {
        const path = deterministicPath('ComponentClaim', name);
        const branch = await repo.api.getDefaultBranch(repo.ref);
        const current = await repo.api.readFile(repo.ref, path, branch);
        // A local file may already exist in the claims repo: replace that copy.
        return { path, existingSha: current?.sha };
      },
    };
  }

  const repo =
    options.repo ?? claimsRepo(createGitHubApi(), requireOrg(options.org));
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
    repo,
    async destination() {
      return { path: source.filePath, existingSha: source.sha };
    },
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

/**
 * Merges an edit payload over the stored reference, preserving its pin and
 * recursively merging `args` (the same merge semantics `mutateClaim` uses).
 */
function mergeFeatureReference(
  existing: FeatureReference,
  feature: FeatureReference,
): FeatureReference {
  const merged: FeatureReference = { ...existing, ...feature };
  if (existing.args !== undefined || feature.args !== undefined) {
    const args = structuredClone(existing.args ?? {});
    mergeObjects(args, feature.args ?? {});
    merged.args = args;
  }
  if (feature.version !== undefined) delete merged.ref;
  if (feature.ref !== undefined) delete merged.version;
  return merged;
}

export interface FeatureMutationRequest extends AuditTrailOptions {
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

/** A Feature operation audits the claim as the matching claim operation. */
const AUDIT_OPERATIONS: Record<
  FeatureMutationRequest['operation'],
  AuditOperation
> = {
  add: 'create',
  edit: 'edit',
  remove: 'delete',
};

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
    let resolved = feature;
    if (request.operation === 'edit') {
      const existing = getFeatureReferences(target.claim).find(
        (reference) => reference.name === feature.name,
      );
      if (!existing) Errors.error(`Feature not found: ${feature.name}`);
      resolved = mergeFeatureReference(existing, feature);
    }
    if (request.featureSchema) {
      const argsValidation = validateFeatureArgs(
        request.featureSchema,
        resolved.args ?? {},
      );
      if (!argsValidation.valid) {
        Errors.error(argsValidation.errors.join('\n'));
      }
    }
    claim = mutateFeatureReference(target.claim, request.operation, resolved);
  }

  const validator = createClaimValidator({ schemasDir: deps.schemasDir });
  const claimValidation = await validator.validate(claim, 'ComponentClaim');
  if (!claimValidation.valid) {
    Errors.error(claimValidation.errors.join('\n'));
  }

  const output = serializeClaim(claim);
  process.stdout.write(`${formatClaim(claim, request.json)}\n`);
  if (!request.commit) return { claim, output };

  const repo =
    target.repo ?? claimsRepo(createGitHubApi(), requireOrg(request.org));
  try {
    const { publishUrl } = await withAuditTrail(
      {
        repo,
        operation: AUDIT_OPERATIONS[request.operation],
        kind: 'ComponentClaim',
        name: target.name,
      },
      request,
      async (audit) => {
        const destination = await target.destination(repo);
        return publishClaimAndWait(
          {
            repo,
            kind: 'ComponentClaim',
            name: target.name,
            output,
            path: destination.path,
            existingSha: destination.existingSha,
            noWait: Boolean(request.noWait),
            waitForChecks: false,
            audit,
          },
          {
            // The mutation output was already presented above.
            output: () => {},
            diagnostic: (line) => process.stderr.write(line),
          },
        );
      },
    );
    return { claim, output, publishUrl };
  } catch (error) {
    Errors.error(error instanceof Error ? error.message : String(error));
  }
}
