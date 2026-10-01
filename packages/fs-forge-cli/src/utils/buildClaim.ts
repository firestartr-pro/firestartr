import { FlagSpec } from './deriveFlags.js';

export function buildClaimFromFlags(
  flags: Record<string, unknown>,
  flagSpecs: FlagSpec[],
  requiredContainers: string[] = [],
): Record<string, unknown> {
  const claim: Record<string, unknown> = {};
  for (const path of requiredContainers) setNestedValue(claim, path, {});

  for (const [flagName, flagValue] of Object.entries(flags)) {
    if (flagValue === undefined || flagValue === null) continue;

    const spec = flagSpecs.find((s) => s.path === flagName);
    if (!spec) continue;

    if (flagName.endsWith('.json') && typeof flagValue === 'string') {
      try {
        setNestedValue(claim, flagName.slice(0, -5), JSON.parse(flagValue));
      } catch {
        throw new Error(`Invalid JSON for --${flagName}`);
      }
      continue;
    }

    const normalizedValue =
      typeof flagValue === 'string' &&
      spec.enumValues?.includes(flagValue.toLowerCase())
        ? flagValue.toLowerCase()
        : flagValue;

    if (spec.multiple && Array.isArray(normalizedValue)) {
      setNestedValue(claim, flagName, normalizedValue);
    } else if (
      typeof normalizedValue === 'string' ||
      typeof normalizedValue === 'number' ||
      typeof normalizedValue === 'boolean'
    ) {
      setNestedValue(claim, flagName, normalizedValue);
    }
  }

  for (const spec of flagSpecs) {
    if (!spec.conditionalDefault || spec.defaultValue === undefined) continue;
    const parts = spec.path.split('.');
    const key = parts.pop() as string;
    const parent = getNestedObject(claim, parts);
    if (parent && !(key in parent))
      parent[key] = structuredClone(spec.defaultValue);
  }

  return claim;
}

function getNestedObject(
  value: Record<string, unknown>,
  parts: string[],
): Record<string, unknown> | undefined {
  let current = value;
  for (const part of parts) {
    const child = current[part];
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      return undefined;
    }
    current = child as Record<string, unknown>;
  }
  return current;
}

export function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  if (
    parts.some((part) =>
      ['__proto__', 'prototype', 'constructor'].includes(part),
    )
  ) {
    throw new Error(`Invalid flag path: ${path}`);
  }
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}
