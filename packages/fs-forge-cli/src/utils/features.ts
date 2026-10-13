import { mutateClaim } from './mutateClaim.js';
import { isRecord } from './isRecord.js';

import type { FlagSpec } from './deriveFlags.js';

export interface FeatureReference {
  [key: string]: unknown;
  name: string;
  version?: string;
  ref?: string;
  repo?: string;
  args?: Record<string, unknown>;
}

export function getFeatureReferences(
  claim: Record<string, unknown>,
): FeatureReference[] {
  const providers = claim.providers;
  const github = isRecord(providers) ? providers.github : undefined;
  const features = isRecord(github) ? github.features : undefined;
  if (features === undefined) return [];
  if (
    !Array.isArray(features) ||
    features.some(
      (feature) => !isRecord(feature) || typeof feature.name !== 'string',
    )
  ) {
    throw new Error('providers.github.features must be an array');
  }
  return features as FeatureReference[];
}

function setFeatureReferences(
  claim: Record<string, unknown>,
  features: FeatureReference[],
): void {
  const providers = isRecord(claim.providers) ? claim.providers : {};
  claim.providers = providers;
  const github = isRecord(providers.github) ? providers.github : {};
  providers.github = github;
  github.features = features;
}

export function mutateFeatureReference(
  claim: Record<string, unknown>,
  operation: 'add' | 'edit' | 'remove',
  feature: FeatureReference,
): Record<string, unknown> {
  const result = structuredClone(claim);
  const features = getFeatureReferences(result);
  const index = features.findIndex(({ name }) => name === feature.name);

  if (operation === 'add') {
    if (index >= 0) {
      throw new Error(
        `Feature already exists: ${feature.name}. Use features edit instead.`,
      );
    }
    setFeatureReferences(result, [...features, feature]);
    return result;
  }

  if (index < 0) throw new Error(`Feature not found: ${feature.name}`);
  if (operation === 'remove') {
    setFeatureReferences(
      result,
      features.filter((_, featureIndex) => featureIndex !== index),
    );
    return result;
  }

  const updated = [...features];
  updated[index] = feature;
  setFeatureReferences(result, updated);
  return result;
}

export function buildFeatureReference(
  flags: Record<string, unknown>,
  specs: FlagSpec[],
): FeatureReference {
  for (const [name, value] of Object.entries(flags)) {
    if (!name.startsWith('args.') || !name.endsWith('.json')) continue;
    if (typeof value !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(value);
      if (name === 'args.json' && !isRecord(parsed)) {
        throw new Error('--args.json must contain a JSON object');
      }
    } catch (error) {
      throw new Error(
        `Invalid JSON for --${name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const feature = mutateClaim({}, flags, specs) as FeatureReference;
  feature.name = flags.name as string;

  if (flags.version !== undefined) delete feature.ref;
  if (flags.ref !== undefined) delete feature.version;
  return feature;
}

export function parseFeatureReference(value: string): FeatureReference {
  const match = /^([^@#:]+)([@#])([^:]+):(.*)$/s.exec(value);
  if (!match) {
    throw new Error(
      `Invalid Feature reference: ${value}. Expected name@version:{...} or name#ref:{...}`,
    );
  }

  let args: unknown;
  try {
    args = JSON.parse(match[4]) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid Feature args JSON for ${match[1]}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isRecord(args)) {
    throw new Error(`Feature args for ${match[1]} must be a JSON object`);
  }

  return {
    name: match[1],
    ...(match[2] === '@' ? { version: match[3] } : { ref: match[3] }),
    args,
  };
}
