function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertMergeableObject(
  value: unknown,
  label: 'target' | 'source',
): asserts value is Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error(`deepMerge ${label} must be a plain object`);
  }
}

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  assertMergeableObject(target, 'target');
  assertMergeableObject(source, 'source');

  const result: Record<string, unknown> = { ...target };

  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result[key];

    if (isObject(targetValue) && isObject(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
      continue;
    }

    result[key] = sourceValue;
  }

  return result;
}
