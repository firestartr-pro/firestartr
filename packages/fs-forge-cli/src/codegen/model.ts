import { deriveFlags, deriveRequiredContainers } from '../utils/deriveFlags.js';

import type { FlagSpec } from '../utils/deriveFlags.js';

export interface ClaimIcon {
  emoji: string;
  ascii: string;
}

export interface ClaimCommandModel {
  kind: string;
  id: string;
  summary: string;
  icon: ClaimIcon;
  flagSpecs: FlagSpec[];
  requiredContainers: string[];
}

function claimSummary(schema: Record<string, unknown>, kind: string): string {
  const value = schema['x-fs-forge-summary'];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${kind} schema is missing x-fs-forge-summary metadata`);
  }
  return value;
}

function claimIcon(schema: Record<string, unknown>, kind: string): ClaimIcon {
  const value = schema['x-fs-forge-icon'];
  if (
    typeof value !== 'object' ||
    value === null ||
    !('emoji' in value) ||
    typeof value.emoji !== 'string' ||
    !('ascii' in value) ||
    typeof value.ascii !== 'string'
  ) {
    throw new Error(`${kind} schema is missing x-fs-forge-icon metadata`);
  }
  return { emoji: value.emoji, ascii: value.ascii };
}

/** Pure: schema in, everything the emitter needs out. */
export function buildCommandModel(
  schema: Record<string, unknown>,
  kind: string,
): ClaimCommandModel {
  return {
    kind,
    id: kind.replace(/Claim$/, '').toLowerCase(),
    summary: claimSummary(schema, kind),
    icon: claimIcon(schema, kind),
    flagSpecs: deriveFlags(schema),
    requiredContainers: deriveRequiredContainers(schema),
  };
}
