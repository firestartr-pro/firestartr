import jsonPatch from 'fast-json-patch';

import type { AddOperation, Operation } from 'fast-json-patch';

const { applyPatch, compare, getValueByPointer } = jsonPatch;

/*
 * Default blocks are objects that cannot be merged but are applied as a whole:
 * - If the block is defined at the claim level, it is preserved as-is (no merge)
 * - If the block is missing at the claim level, the whole default block is applied
 *
 * Must stay in sync with cdk8s_renderer/src/loader/claimsDefaulter.ts.
 */
const DEFAULT_BLOCKS_PATHS = ['/providers/terraform/sync'];

function hasDeepPath(data: Record<string, unknown>, deepPath: string): boolean {
  const dotted = deepPath.replace(/\//g, '.').replace(/^\./, '');
  let current: unknown = data;
  for (const part of dotted.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current) ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

/**
 * Applies per-kind defaults to a claim using additive-only semantics: every
 * field the claim does not define is filled from the defaults; fields the
 * claim defines are never overwritten. Default blocks are atomic.
 *
 * A faithful port of `cdk8s_renderer`'s `applyBlockAwareDefaults()`; the CLI
 * does not depend on the renderer at runtime.
 *
 * @param claim - the claim document (never mutated)
 * @param defaults - the full defaults object keyed by claim kind
 * @returns a new claim document with defaults filled in
 */
export function applyClaimDefaults(
  claim: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  // Always work on a clone of the original claim
  const claimClone = JSON.parse(JSON.stringify(claim)) as Record<
    string,
    unknown
  >;

  const kindDefaults = defaults[claim.kind as string];
  if (typeof kindDefaults !== 'object' || kindDefaults === null) {
    return claimClone;
  }

  // Claim-level blocks are stored here and substituted back into the diff
  const defaultBlocks = new Map<string, unknown>();

  // Remove claim-level blocks entirely so the diff sees them as additions
  for (const blockPath of DEFAULT_BLOCKS_PATHS) {
    if (!hasDeepPath(claimClone, blockPath)) continue;

    const originalValue = getValueByPointer(claimClone, blockPath);
    if (originalValue) {
      defaultBlocks.set(blockPath, originalValue);
      applyPatch(claimClone, [{ op: 'remove', path: blockPath }]);
    }
  }

  // Keep only `add` operations: fills missing fields, never overwrites.
  // When a block path was claim-level defined, substitute the claim's own
  // value back in so the atomic block is preserved as-is.
  const ops: Operation[] = compare(claimClone, kindDefaults)
    .filter((op): op is AddOperation<unknown> => op.op === 'add')
    .map((op) => {
      const blockValue = defaultBlocks.get(op.path);
      return blockValue === undefined ? op : { ...op, value: blockValue };
    });

  return applyPatch(claimClone, ops).newDocument;
}
