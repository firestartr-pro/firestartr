import { buildClaimFromFlags } from './buildClaim.js';
import { isRecord } from './isRecord.js';
import { serializeClaim } from '../claims/keyOrdering.js';
import type { FlagSpec, VariantGroup } from './deriveFlags.js';

export interface ClaimDiff {
  path: string;
  before?: unknown;
  after?: unknown;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function getNestedValue(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function deleteNestedValue(value: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  if (
    parts.some((part) =>
      ['__proto__', 'prototype', 'constructor'].includes(part),
    )
  ) {
    throw new Error(`Invalid --unset path: ${path}`);
  }

  const parents: Record<string, unknown>[] = [value];
  let current = value;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!hasOwn(current, part) || !isRecord(child)) return;
    current = child;
    parents.push(current);
  }
  delete current[parts.at(-1) as string];

  for (let index = parents.length - 1; index > 0; index--) {
    if (Object.keys(parents[index]).length > 0) break;
    delete parents[index - 1][parts[index - 1]];
  }
}

/**
 * Recursively merges the overrides into the target, keeping the stored keys
 * that the overrides do not name. Base's Feature edit used it through
 * `mutateClaim`, so claim edits and Feature edits share one merge semantics.
 */
export function mergeObjects(
  target: Record<string, unknown>,
  overrides: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new Error(`Invalid override key: ${key}`);
    }
    const current = target[key];
    if (isRecord(value) && isRecord(current)) {
      mergeObjects(current, value);
    } else {
      target[key] = value;
    }
  }
}

function dropStaleVariants(
  claim: Record<string, unknown>,
  base: Record<string, unknown>,
  explicitPaths: Set<string>,
  groups: VariantGroup[],
): void {
  for (const group of groups) {
    const previous = getNestedValue(base, group.discriminatorPath);
    const next = getNestedValue(claim, group.discriminatorPath);
    if (previous === next || typeof previous !== 'string') continue;

    for (const path of group.variants[previous] ?? []) {
      if (!explicitPaths.has(path)) deleteNestedValue(claim, path);
    }
  }
}

export function mutateClaim(
  base: Record<string, unknown>,
  flags: Record<string, unknown>,
  specs: FlagSpec[],
  unsets: string[] = [],
  variantGroups: VariantGroup[] = [],
): Record<string, unknown> {
  const claim = structuredClone(base);
  const specPaths = new Set(specs.map((spec) => spec.path));
  const explicitPaths = new Set(
    Object.keys(flags).filter(
      (path) => flags[path] !== undefined && specPaths.has(path),
    ),
  );
  mergeObjects(claim, buildClaimFromFlags(flags, specs));

  for (const path of unsets) {
    if (specs.some((spec) => spec.path === path && spec.required)) {
      throw new Error(`Cannot unset required field: ${path}`);
    }
    deleteNestedValue(claim, path);
  }
  dropStaleVariants(claim, base, explicitPaths, variantGroups);
  return claim;
}

export function diffClaims(
  before: unknown,
  after: unknown,
  prefix = '',
): ClaimDiff[] {
  if (Object.is(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((key) =>
      diffClaims(before[key], after[key], prefix ? `${prefix}.${key}` : key),
    );
  }
  return [{ path: prefix, before, after }];
}

export function formatDiff(diff: ClaimDiff[], json = false): string {
  if (json) {
    return JSON.stringify(
      diff,
      (_key, value) => (value === undefined ? null : value),
      2,
    );
  }
  if (diff.length === 0) return 'No changes';
  return diff
    .flatMap((entry) => [
      `- ${entry.path}: ${JSON.stringify(entry.before)}`,
      `+ ${entry.path}: ${JSON.stringify(entry.after)}`,
    ])
    .join('\n');
}

export interface MutationDiffInputs {
  before: Record<string, unknown>;
  transformed: Record<string, unknown>;
  merged: Record<string, unknown>;
  diff: ClaimDiff[];
  defaultsDiff: ClaimDiff[];
}

export interface MutationDiffOptions {
  json: boolean;
  showDefaults: boolean;
}

interface LineOp {
  type: 'same' | 'add' | 'del';
  line: string;
}

const MAX_LCS_CELLS = 1_000_000;

function diffLines(a: string[], b: string[]): LineOp[] {
  let prefixLength = 0;
  while (
    prefixLength < a.length &&
    prefixLength < b.length &&
    a[prefixLength] === b[prefixLength]
  ) {
    prefixLength++;
  }

  let aEnd = a.length;
  let bEnd = b.length;
  while (
    aEnd > prefixLength &&
    bEnd > prefixLength &&
    a[aEnd - 1] === b[bEnd - 1]
  ) {
    aEnd--;
    bEnd--;
  }

  const ops: LineOp[] = a
    .slice(0, prefixLength)
    .map((line) => ({ type: 'same', line }));
  const n = aEnd - prefixLength;
  const m = bEnd - prefixLength;

  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    for (let i = prefixLength; i < aEnd; i++) {
      ops.push({ type: 'del', line: a[i] });
    }
    for (let j = prefixLength; j < bEnd; j++) {
      ops.push({ type: 'add', line: b[j] });
    }
  } else {
    const lcs: number[][] = Array.from({ length: n + 1 }, () =>
      new Array(m + 1).fill(0),
    );
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] =
          a[prefixLength + i] === b[prefixLength + j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[prefixLength + i] === b[prefixLength + j]) {
        ops.push({ type: 'same', line: a[prefixLength + i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        ops.push({ type: 'del', line: a[prefixLength + i] });
        i++;
      } else {
        ops.push({ type: 'add', line: b[prefixLength + j] });
        j++;
      }
    }
    while (i < n) {
      ops.push({ type: 'del', line: a[prefixLength + i++] });
    }
    while (j < m) {
      ops.push({ type: 'add', line: b[prefixLength + j++] });
    }
  }

  for (let i = aEnd; i < a.length; i++) {
    ops.push({ type: 'same', line: a[i] });
  }
  return ops;
}

/**
 * Renders a unified line diff over the serialized YAML of two claims: full
 * document context, with changed lines marked `-`/`+`. There's no separate
 * dotted-path list alongside it — the rendered document already reads as
 * "the full claim, with changes highlighted", so a second block would only
 * repeat the same content.
 */
export function formatUnifiedDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string {
  const beforeYaml = serializeClaim(before).trimEnd();
  const afterYaml = serializeClaim(after).trimEnd();
  if (beforeYaml === afterYaml) return 'No changes';
  return diffLines(beforeYaml.split('\n'), afterYaml.split('\n'))
    .map((op) =>
      op.type === 'same'
        ? `  ${op.line}`
        : `${op.type === 'del' ? '-' : '+'} ${op.line}`,
    )
    .join('\n');
}

/**
 * Renders the claim diff shown via `--diff`.
 *
 * - JSON mode keeps the flat `ClaimDiff[]` shape (or a `{ changes, defaults
 *   }` wrapper with `--show-defaults`) — machine-readable, unaffected by the
 *   text rendering below.
 * - Text mode is a single unified diff over the rendered YAML (see
 *   `formatUnifiedDiff`). `--show-defaults` widens the "after" side from the
 *   user's transformed claim to the fully-defaulted one, so defaults-filled
 *   fields show up as ordinary `+` lines instead of a separate trailer
 *   section.
 */
export function formatMutationDiff(
  inputs: MutationDiffInputs,
  options: MutationDiffOptions,
): string {
  const { before, transformed, merged, diff, defaultsDiff } = inputs;
  if (options.json) {
    if (!options.showDefaults) return formatDiff(diff, true);
    const defaults: Record<string, unknown> = {};
    for (const entry of defaultsDiff) defaults[entry.path] = entry.after;
    return JSON.stringify(
      { changes: diff, defaults },
      (_key, value) => (value === undefined ? null : value),
      2,
    );
  }
  return formatUnifiedDiff(before, options.showDefaults ? merged : transformed);
}
