import * as fjp from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import featuresPreparer from 'features_preparer';
import lodash from 'lodash';

import { isProtectedPath, normalizePointer } from './protectedPaths';
import { StitchingError, StitchingViolation } from './errors';
import { validateFeatureDescriptors } from './validateFeatureDescriptors';

export interface FeaturePatchEnvelope {
  feature: string;
  patches: Array<{ op: string; path: string; value?: unknown; name?: string }>;
}

let MOCK_FEATURES_FN:
  | ((claim: unknown) => Promise<FeaturePatchEnvelope[]>)
  | undefined;

export function MOCK_STITCHING_FEATURES(
  mock?: (claim: unknown) => Promise<FeaturePatchEnvelope[]>,
): void {
  MOCK_FEATURES_FN = mock;
}

// Non-enumerable stamp marking a claim as already stitched. Lets stitching be
// once-only at each entry point (e.g. renderFromImports) without re-running
// feature downloads or re-applying gates on the same claim object.
export const STITCHED_CLAIM = Symbol('firestartr.stitchedClaim');

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerExists(doc: unknown, pointer: string): boolean {
  const segments = pointer.split('/').slice(1).map(unescapePointer);
  let cur: unknown = doc;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object')
      return false;
    if (
      !Object.prototype.hasOwnProperty.call(cur as Record<string, unknown>, seg)
    )
      return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return true;
}

function isAppendPointer(pointer: string): boolean {
  return pointer.endsWith('/-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Deduplication identity for a feature patch (Phase 1 silent dedup). Two
// patches are only considered identical intent when the operation, the
// normalized pointer, and — for array appends (`add ... /-`) — the appended
// element's `name` all match, e.g. two features adding the same label. The
// operation is part of the identity so an `add` and a `replace` on the same
// pointer are never deduplicated against each other.
function dedupIdentity(patch: {
  op?: string;
  path: string;
  value?: unknown;
}): string {
  const path = normalizePointer(patch.path);
  if (
    patch.op === 'add' &&
    isAppendPointer(path) &&
    isRecord(patch.value) &&
    typeof patch.value.name === 'string'
  ) {
    return `${patch.op} ${path}#${patch.value.name}`;
  }
  return `${patch.op} ${path}`;
}

// Write region for a feature patch — the claim locations the patch occupies.
// For a regular op it is the unescaped pointer segments; for an array append
// (`add ... /-`) carrying a `name` it is the array parent plus the element
// `name`, so two appends of distinct names stay sibling writes while an append
// and a whole-array write overlap.
function writeRegion(patch: {
  op?: string;
  path: string;
  value?: unknown;
}): string[] {
  const path = normalizePointer(patch.path);
  const segments = path.split('/').slice(1).map(unescapePointer);
  if (
    patch.op === 'add' &&
    isAppendPointer(path) &&
    isRecord(patch.value) &&
    typeof patch.value.name === 'string'
  ) {
    return [...segments.slice(0, -1), patch.value.name];
  }
  return segments;
}

// Ancestor/descendant (or identical) regions conflict: under JSON Patch
// semantics a parent write replaces its whole subtree, so the composed result
// would depend on feature order. Distinct-name appends yield sibling regions
// and stay composable.
function regionsOverlap(a: string[], b: string[]): boolean {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isStitchedClaim(claim: unknown): boolean {
  return (
    isRecord(claim) &&
    (claim as unknown as Record<symbol, unknown>)[STITCHED_CLAIM] === true
  );
}

function markStitched(claim: unknown): unknown {
  if (isRecord(claim)) {
    Object.defineProperty(claim, STITCHED_CLAIM, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }
  return claim;
}

// Check whether an array at `appendPath`'s parent already contains an element
// whose `name` matches `value.name`.  Used for the "claim wins" gate: when a
// feature tries to append an array element that already exists in the claim,
// the patch is silently dropped.
function arrayElementExists(
  doc: unknown,
  appendPath: string,
  value: unknown,
): boolean {
  if (!isRecord(value) || typeof value.name !== 'string') return false;

  const parentPath = appendPath.slice(0, -2); // strip trailing /-
  const segments = parentPath.split('/').slice(1).map(unescapePointer);

  let cur: unknown = doc;
  for (const seg of segments) {
    if (cur === null || cur === undefined || typeof cur !== 'object')
      return false;
    if (
      !Object.prototype.hasOwnProperty.call(cur as Record<string, unknown>, seg)
    )
      return false;
    cur = (cur as Record<string, unknown>)[seg];
  }

  if (!Array.isArray(cur)) return false;

  return cur.some((el: unknown) => isRecord(el) && el.name === value.name);
}

// fast-json-patch does not create intermediate containers for `add`, and
// appending to an array requires the array to already exist. Ensure every
// ancestor segment exists before applying an `add`: missing containers are
// created as objects, except the immediate parent of a `/-` append, which is
// created as an array. Existing (user/default-declared) values are never
// overwritten.
function ensureAddParents(doc: object, patch: { path: string }): object {
  const segments = patch.path.split('/').slice(1);
  let prefix = '';
  for (let i = 0; i < segments.length - 1; i++) {
    prefix += '/' + segments[i];
    if (pointerExists(doc, prefix)) continue;
    const isArrayParent =
      isAppendPointer(patch.path) && i === segments.length - 2;
    const value = isArrayParent ? [] : {};
    try {
      doc = fjp.applyPatch(
        doc,
        [{ op: 'add', path: prefix, value }] as Operation[],
        false,
        false,
      ).newDocument;
    } catch {
      // Concurrent structural conflict — let the actual patch surface the error.
    }
  }
  return doc;
}

export async function stitchClaim(
  claimAfterDefaults: unknown,
  preCollectedEnvelopes?: FeaturePatchEnvelope[],
  originalClaim?: unknown,
): Promise<unknown> {
  if (isStitchedClaim(claimAfterDefaults)) {
    return claimAfterDefaults;
  }
  const envelopes =
    preCollectedEnvelopes ?? (await collectFeaturePatches(claimAfterDefaults));

  if (envelopes.length === 0) {
    return markStitched(claimAfterDefaults);
  }

  // Normalize all patches once so every gate and the apply phase use the same pointers.
  const normalizedEnvelopes = envelopes.map((env) => ({
    feature: env.feature,
    patches: env.patches.map((p) => ({
      ...p,
      path: normalizePointer(p.path),
      _raw: p.path,
    })),
  }));

  // ── Phase 1: silently drop patches that should not be applied ──────────
  //  • Array append whose element already exists in the claim → claim wins
  //    (never for protected claim paths, which are rejected in Phase 2)
  //  • Duplicate identity with identical value across features → silent dedup
  //    (a feature's own ordered patches are always retained verbatim)
  const dropped = new Set<string>(); // "envelopeIdx:patchIdx"
  const seenIdentities = new Map<string, { feature: string; value: unknown }>();

  for (let ei = 0; ei < normalizedEnvelopes.length; ei++) {
    const envelope = normalizedEnvelopes[ei];
    for (let pi = 0; pi < envelope.patches.length; pi++) {
      const patch = envelope.patches[pi];
      const key = `${ei}:${pi}`;

      // Array claim-wins: element already in claim → drop (protected paths
      // are exempt so every attempt on them is rejected in Phase 2)
      if (
        patch.op === 'add' &&
        isAppendPointer(patch.path) &&
        !isProtectedPath(patch.path)
      ) {
        if (arrayElementExists(claimAfterDefaults, patch.path, patch.value)) {
          dropped.add(key);
          continue;
        }
      }

      // Silent dedup across features only: same op + destination + value from
      // a DIFFERENT feature → drop. A feature's own ordered patches (e.g. a
      // repeated append, or a scalar written twice) are always retained.
      const identity = dedupIdentity(patch);
      const existing = seenIdentities.get(identity);
      if (existing && existing.feature !== envelope.feature) {
        if (lodash.isEqual(existing.value, patch.value)) {
          dropped.add(key);
          continue;
        }
        // Different value — kept here, caught as a violation in Phase 2.
      }
      // Refresh the recorded writer/value so later features compare against
      // the latest write by this feature.
      seenIdentities.set(identity, {
        feature: envelope.feature,
        value: patch.value,
      });
    }
  }

  // ── Phase 2: collect violations on non-dropped patches ─────────────────
  const violations: StitchingViolation[] = [];
  // Writers observed so far (write region + feature). Gate 2 compares every new
  // patch's region against prior writers from OTHER features, covering both
  // identical destinations and ancestor/descendant destinations.
  const priorWrites: Array<{
    region: string[];
    feature: string;
    path: string;
  }> = [];

  for (let ei = 0; ei < normalizedEnvelopes.length; ei++) {
    const envelope = normalizedEnvelopes[ei];
    // Per-feature shadow document: tracks mutations within this envelope so that
    // ordered sequences like add → replace within one feature resolve correctly.
    let shadow = JSON.parse(JSON.stringify(claimAfterDefaults));
    for (let pi = 0; pi < envelope.patches.length; pi++) {
      if (dropped.has(`${ei}:${pi}`)) continue;

      const patch = envelope.patches[pi];
      const path = patch.path;
      const raw = (patch as unknown as { _raw: string })._raw ?? path;

      // Gate 1: protected path
      if (isProtectedPath(path)) {
        violations.push({
          feature: envelope.feature,
          op: patch.op,
          path,
          reason: 'protected-path',
          message: `Feature '${envelope.feature}' patch ${patch.op} ${raw} (normalized ${path}) targets protected claim path`,
        });
      }

      // Gate 2: conflicting write from a DIFFERENT feature to the same
      // destination or an ancestor/descendant of it (region-based, op-agnostic
      // — see writeRegion). A feature's own ordered patches never self-conflict.
      const region = writeRegion(patch);
      const overlapping = priorWrites.find(
        (w) =>
          w.feature !== envelope.feature && regionsOverlap(w.region, region),
      );
      if (overlapping) {
        violations.push({
          feature: envelope.feature,
          op: patch.op,
          path,
          reason: 'duplicate-path',
          conflictingFeature: overlapping.feature,
          message: `Feature '${envelope.feature}' and '${overlapping.feature}' both write overlapping paths (${raw} overlaps ${overlapping.path}); compose them in one feature instead`,
        });
      }
      priorWrites.push({ region, feature: envelope.feature, path });

      // Gate 3: replace / remove to a path absent from this feature's mutation
      //        sequence (tracked via shadow), not the static claimAfterDefaults.
      if (['replace', 'remove'].includes(patch.op)) {
        if (!pointerExists(shadow, path)) {
          violations.push({
            feature: envelope.feature,
            op: patch.op,
            path,
            reason: 'overwrite-protected',
            message: `Feature '${envelope.feature}' patch ${patch.op} ${raw} (normalized ${path}) targets absent path (replace/remove requires existing value)`,
          });
        }
      }

      // Gate 4: non-append ops must not overwrite a user-declared field
      // (overwrite protection). The user's own claim wins over any feature.
      // Only the patch's target field itself is protected: adding a sibling
      // field under a user-declared parent (e.g. a new field in
      // /providers/github) is allowed. Array appends (`add ... /-`) are
      // exempt: the appended element is deduplicated against the claim in
      // Phase 1, preserving original values, while distinct elements from
      // multiple features may be added.
      if (originalClaim && !isAppendPointer(path)) {
        if (pointerExists(originalClaim, path)) {
          violations.push({
            feature: envelope.feature,
            op: patch.op,
            path,
            reason: 'user-declared-path',
            message: `Feature '${envelope.feature}' patch ${patch.op} ${raw} (normalized ${path}) targets a field declared by the user (overwrite protection)`,
          });
        }
      }
      // Update shadow for subsequent patches within this feature
      try {
        if (patch.op === 'add')
          shadow = ensureAddParents(shadow as object, patch);
        shadow = fjp.applyPatch(
          shadow as object,
          [patch as unknown as Operation],
          false,
          false,
        ).newDocument;
      } catch {
        /* leave shadow unchanged — Gate 3 stays conservative */
      }
    }
  }

  if (violations.length > 0) {
    throw new StitchingError(violations);
  }

  // ── Phase 3: apply remaining patches ───────────────────────────────────
  let stitched: unknown = JSON.parse(JSON.stringify(claimAfterDefaults));
  for (let ei = 0; ei < normalizedEnvelopes.length; ei++) {
    const envelope = normalizedEnvelopes[ei];
    const patchesToApply = envelope.patches.filter(
      (_, pi) => !dropped.has(`${ei}:${pi}`),
    );
    if (patchesToApply.length === 0) continue;
    // ── Apply each patch in order, creating parents for adds as needed ───
    for (const patch of patchesToApply) {
      if (patch.op === 'add') {
        stitched = ensureAddParents(stitched as object, patch);
      }
      const result = fjp.applyPatch(
        stitched as object,
        [patch as unknown as Operation],
        false,
        false,
      );
      stitched = result.newDocument;
    }
  }

  return markStitched(stitched);
}

async function collectFeaturePatches(
  claim: unknown,
): Promise<FeaturePatchEnvelope[]> {
  if (MOCK_FEATURES_FN) {
    return MOCK_FEATURES_FN(claim);
  }

  const typedClaim = claim as {
    kind?: string;
    providers?: {
      github?: {
        features?: Array<{
          name: string;
          version?: string;
          ref?: string;
          repo?: string;
          args?: unknown;
        }>;
      };
    };
  };

  const features = typedClaim.providers?.github?.features;
  if (features === undefined) return [];
  if (!Array.isArray(features)) {
    throw new Error(
      'Invalid feature descriptor(s): /providers/github/features must be an array',
    );
  }
  if (features.length === 0) return [];

  // Gate 0: reject malformed feature descriptors (repo/ref/version shape)
  // BEFORE any preparer call, so no auth/network work is triggered by data
  // that claim-kind AJV validation would reject.
  validateFeatureDescriptors(claim);

  const envelopes: FeaturePatchEnvelope[] = [];
  for (const feature of features) {
    const featureName = feature.name;
    const versionOrRef = feature.ref ?? feature.version ?? '';
    const repo = feature.repo
      ? (feature.repo.split('/')[1] ?? 'features')
      : 'features';
    const owner = feature.repo
      ? (feature.repo.split('/')[0] ?? 'prefapp')
      : 'prefapp';
    const args = (feature as { args?: unknown }).args ?? {};

    try {
      let patchesOrRendered: unknown;
      const preparerAny = featuresPreparer as unknown as Record<
        string,
        (...args: unknown[]) => Promise<unknown>
      >;
      if ((feature as { ref?: string }).ref) {
        if (typeof preparerAny.getFeatureClaimPatchesFromRef === 'function') {
          patchesOrRendered = await preparerAny.getFeatureClaimPatchesFromRef(
            featureName,
            versionOrRef,
            claim,
            args,
            repo,
            owner,
          );
        } else {
          patchesOrRendered = await preparerAny.getFeatureConfigFromRef(
            featureName,
            versionOrRef,
            claim,
            args,
            repo,
            owner,
          );
        }
      } else {
        if (typeof preparerAny.getFeatureClaimPatches === 'function') {
          patchesOrRendered = await preparerAny.getFeatureClaimPatches(
            featureName,
            versionOrRef,
            claim,
            args,
            repo,
            owner,
          );
        } else {
          patchesOrRendered = await preparerAny.getFeatureConfig(
            featureName,
            versionOrRef,
            claim,
            args,
            repo,
            owner,
          );
        }
      }

      const patches = Array.isArray(patchesOrRendered)
        ? (patchesOrRendered as Array<{
            op: string;
            path: string;
            value?: unknown;
            name?: string;
          }>)
        : extractClaimPatches(patchesOrRendered as { claimPatches?: unknown });
      envelopes.push({ feature: featureName, patches });
    } catch (err) {
      throw new Error(
        `Failed to collect claimPatches for feature '${featureName}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return envelopes;
}

export function extractClaimPatches(rendered: {
  claimPatches?: unknown;
}): Array<{ op: string; path: string; value?: unknown; name?: string }> {
  const patches = (rendered as { claimPatches?: unknown }).claimPatches;
  if (!patches) return [];
  if (Array.isArray(patches))
    return patches as Array<{ op: string; path: string; value?: unknown }>;
  throw new Error(
    `Feature claimPatches must be a flat array (claim-relative pointers like /annotations/...), got ${typeof patches}: ${JSON.stringify(patches).slice(0, 200)}`,
  );
}
