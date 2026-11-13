import { CLAIM_PRESENTATION, isHiddenFlag } from '../schema/claimOverlay.js';
import { deriveFlags, deriveRequiredContainers } from '../utils/deriveFlags.js';

import type { ClaimPresentation } from '../schema/claimOverlay.js';
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

function presentation(kind: string): ClaimPresentation {
  const value = CLAIM_PRESENTATION[kind];
  if (!value) {
    throw new Error(`${kind} has no entry in CLAIM_PRESENTATION`);
  }
  return value;
}

/** Pure: schema in, everything the emitter needs out. */
export function buildCommandModel(
  schema: Record<string, unknown>,
  kind: string,
): ClaimCommandModel {
  return {
    kind,
    id: kind.replace(/Claim$/, '').toLowerCase(),
    summary: presentation(kind).summary,
    icon: presentation(kind).icon,
    flagSpecs: deriveFlags(schema).filter(
      (flag) => !isHiddenFlag(kind, flag.path),
    ),
    requiredContainers: deriveRequiredContainers(schema),
  };
}
