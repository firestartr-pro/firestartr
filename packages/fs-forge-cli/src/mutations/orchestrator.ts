import { join } from 'path';

import { loadClaimsMap, resolveClaim } from '../claims/claimsRepo.js';
import { applyDefaultsFromRepo } from '../claims/defaults.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import { FLAG_SPECS_BY_KIND } from './definitions.js';
import { publishClaimAndWait } from './publish.js';
import {
  assertClaimIdentity,
  loadVariantGroups,
  parseClaimYaml,
  requireOrg,
} from './support.js';
import { createClaimValidator } from '../utils/ajvValidation.js';
import {
  diffClaims,
  formatMutationDiff,
  mutateClaim,
} from '../utils/mutateClaim.js';
import type { ClaimsRepo } from '../claims/claimsRepo.js';
import type { ClaimsMap } from '../claims/claimsMap.js';
import type { ClaimKind } from './definitions.js';
import type { ValidationResult } from '../utils/ajvValidation.js';
import type { ClaimDiff } from '../utils/mutateClaim.js';

export { runClaimCreation } from './creation.js';
export type { ClaimCreationOptions, ClaimCreationResult } from './creation.js';

export interface ClaimMutationPresentationOptions {
  diff?: boolean;
  showDefaults?: boolean;
  json?: boolean;
}

export interface ClaimMutationOptions {
  repo: ClaimsRepo;
  root: string;
  kind: ClaimKind;
  sourceName: string;
  flags: Record<string, unknown>;
  unset?: string[];
  commit?: boolean;
  noWait?: boolean;
  waitForChecks?: boolean;
  stateRepos?: string;
  transform?: (claim: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Applies repo-level defaults after user overrides (and `transform`). Runs
   * before validation so the committed claim is complete. Returning the claim
   * unchanged (e.g. no defaults file) skips defaults application.
   */
  defaults?: (
    claim: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  presentation: ClaimMutationPresentationOptions;
}

export interface ClaimMutationContext {
  before: Record<string, unknown>;
  /** User changes applied, before defaults; feeds the hidden-by-default diff. */
  transformed: Record<string, unknown>;
  after: Record<string, unknown>;
  map: ClaimsMap;
}

export interface ClaimMutationResult extends ClaimMutationContext {
  output: string;
  /** User changes (base -> transformed); defaults never leak into this diff. */
  diff: ClaimDiff[];
  /** Defaults-filled fields (transformed -> merged); empty when no defaults. */
  defaultsDiff: ClaimDiff[];
  validation: ValidationResult;
  publishUrl?: string;
}

function validatePresentation(
  presentation: ClaimMutationPresentationOptions,
): void {
  if (
    presentation.json === true &&
    presentation.diff !== true &&
    presentation.showDefaults !== true
  ) {
    throw new Error('--json requires --diff or --show-defaults');
  }
}

function presentMutation(
  result: ClaimMutationResult,
  presentation: ClaimMutationPresentationOptions,
): void {
  const showDefaults = presentation.showDefaults === true;
  const showDiff =
    presentation.diff === true || showDefaults || !result.validation.valid;
  const json = presentation.json === true;
  if (showDiff) {
    process.stderr.write(
      `${formatMutationDiff(
        {
          before: result.before,
          transformed: result.transformed,
          merged: result.after,
          diff: result.diff,
          defaultsDiff: result.defaultsDiff,
        },
        { json, showDefaults },
      )}\n`,
    );
  }
  if (!result.validation.valid) {
    throw new Error(result.validation.errors.join('\n'));
  }
  process.stdout.write(`${result.output}\n`);
}

export async function runClaimMutation(
  options: ClaimMutationOptions,
): Promise<ClaimMutationResult> {
  try {
    const {
      repo,
      root,
      kind,
      sourceName,
      flags,
      unset = [],
      commit = false,
      noWait = false,
      waitForChecks = false,
      stateRepos,
      transform,
      defaults = (claim) => applyDefaultsFromRepo(repo, claim, 'tolerant'),
      presentation,
    } = options;
    validatePresentation(presentation);

    const map = await loadClaimsMap(repo);
    const source = await resolveClaim(repo, map, `${kind}-${sourceName}`);
    const base = parseClaimYaml(source.content);
    assertClaimIdentity(base, kind, sourceName);

    const validator = createClaimValidator({
      schemasDir: join(root, 'schemas'),
    });
    const mutated = mutateClaim(
      base,
      flags,
      FLAG_SPECS_BY_KIND[kind],
      unset,
      await loadVariantGroups(root, kind),
    );
    const transformed = transform?.(mutated) ?? mutated;
    const merged = await defaults(transformed);
    const diff = diffClaims(base, transformed);
    const defaultsDiff = diffClaims(transformed, merged);
    const validation = await validator.validate(merged, kind);

    const context = { before: base, transformed, after: merged, map };
    if (!validation.valid) {
      const result = { output: '', diff, defaultsDiff, validation, ...context };
      presentMutation(result, presentation);
      return result;
    }

    const output = serializeClaim(merged);
    const result = { output, diff, defaultsDiff, validation, ...context };
    presentMutation(result, presentation);
    if (!commit) return result;

    const target = {
      name: sourceName,
      path: source.filePath,
      existingSha: source.sha,
    };
    const { publishUrl } = await publishClaimAndWait(
      {
        repo,
        kind,
        name: target.name,
        output,
        path: target.path,
        existingSha: target.existingSha,
        commit: true,
        noWait,
        waitForChecks,
        stateRepos,
      },
      {
        // The mutation output was already presented above.
        output: () => {},
        diagnostic: (line) => process.stderr.write(line),
      },
    );

    return { ...result, publishUrl };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(`Claim mutation failed: ${String(error)}`);
  }
}
