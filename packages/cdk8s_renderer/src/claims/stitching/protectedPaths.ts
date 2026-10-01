// Platform-curated protected claim paths — features may not write to these.
// Stored as JSON Pointers (RFC 6901). Supports wildcard `*` for a single segment.
// Example: /providers/STAR/org matches /providers/github/org where STAR is *.
export const PROTECTED_CLAIM_PATHS: string[] = [
  '/kind',
  '/name',
  '/providers/*/org',
  '/providers/github/org',
  '/providers/github/name',
  '/providers/*/features',
  '/metadata/name',
  '/metadata/namespace',
];

export function isProtectedPath(patchPath: string): boolean {
  const normalizedPatch = normalizePointer(patchPath);
  for (const protectedPath of PROTECTED_CLAIM_PATHS) {
    if (matchesProtected(protectedPath, normalizedPatch)) {
      return true;
    }
  }
  return false;
}

export function normalizePointer(pointer: string): string {
  // '' is RFC 6901's whole-document (root) pointer. Replacing the root touches
  // every protected field, so it must keep its identity for classification
  // instead of being rewritten to '/' (the "" empty-string member).
  if (pointer === '') return pointer;
  if (!pointer.startsWith('/')) {
    return '/' + pointer;
  }
  return pointer;
}

function matchesProtected(
  protectedPointer: string,
  patchPointer: string,
): boolean {
  const protectedSegments = protectedPointer
    .split('/')
    .slice(1)
    .map(unescapePointer);
  const patchSegments = patchPointer.split('/').slice(1).map(unescapePointer);

  // Treat ancestor/descendant as protected: a patch to a parent (e.g. /metadata)
  // would replace the protected child (/metadata/name), and a patch to a child
  // (e.g. /metadata/name/extra) is also under the protected tree. Match when
  // the shorter prefix equals the longer prefix (with wildcard support).
  const minLen = Math.min(protectedSegments.length, patchSegments.length);
  for (let i = 0; i < minLen; i++) {
    if (protectedSegments[i] === '*') continue;
    if (protectedSegments[i] !== patchSegments[i]) return false;
  }
  return true;
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}
