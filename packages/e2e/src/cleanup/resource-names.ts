export function normalizeResourceNames(resourceNames: string[]): string[] {
  const unique = new Set<string>();
  for (const resourceName of resourceNames) {
    const normalized = resourceName.trim();
    if (!normalized) continue;
    unique.add(normalized);
  }

  return [...unique];
}
