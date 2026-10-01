// All labels made by us will start with this prefix
const FIRESTARTR_LABEL_PREFIX = 'firestartr.dev';

/*
 * Returns an annotation created by the following concatenation:
 *
 * FIRESTARTR_LABEL_PREFIX + "/" + normalizedSuffix
 *
 */
export function getFirestartrLabel(suffix: string): string {
  const normalizedSuffix: string = normalizeLabel(suffix);

  return `${FIRESTARTR_LABEL_PREFIX}/${normalizedSuffix}`;
}

export function normalizeLabel(suffix: string): string {
  let normalizedSuffix: string = suffix.substring(0, 64);
  normalizedSuffix = normalizedSuffix.toLowerCase();
  normalizedSuffix = normalizedSuffix.replace(/[^a-z0-9]/g, '-');

  return normalizedSuffix;
}
