import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

import { isRecord } from '../utils/isRecord.js';
import { SCHEMA_PATCHES } from './claimOverlay.js';

import type { SchemaPatches } from './claimOverlay.js';

const SCHEMAS_PACKAGE = '@firestartr/firestartr-claims_schemas';

/**
 * Directory of the published claim schemas. Resolved from the package root
 * because the package's `exports` only exposes its entry point; the entry
 * itself is never imported.
 */
export function claimSchemasDir(root: string): string {
  const entry = createRequire(join(root, 'package.json')).resolve(
    SCHEMAS_PACKAGE,
  );
  return join(dirname(entry), 'schemas');
}

export function listClaimKinds(schemasDir: string): string[] {
  return readdirSync(schemasDir)
    .filter((file) => file.endsWith('Claim.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

/** The node itself plus the `allOf` branches it is composed of. */
function expandBranches(
  node: Record<string, unknown>,
): Record<string, unknown>[] {
  const branches = Array.isArray(node.allOf) ? node.allOf.filter(isRecord) : [];
  return [node, ...branches.flatMap(expandBranches)];
}

function findNodes(
  schema: Record<string, unknown>,
  path: string,
): Record<string, unknown>[] {
  let nodes = [schema];
  for (const segment of path.split('.')) {
    nodes = nodes.flatMap((node) =>
      expandBranches(node).flatMap((branch) => {
        const child = isRecord(branch.properties)
          ? branch.properties[segment]
          : undefined;
        return isRecord(child) ? [child] : [];
      }),
    );
  }
  return nodes;
}

/** Assigns each keyword; an object-valued keyword is merged one level deep. */
function mergeKeywords(
  node: Record<string, unknown>,
  keywords: Record<string, unknown>,
): void {
  for (const [keyword, value] of Object.entries(keywords)) {
    const existing = node[keyword];
    node[keyword] =
      isRecord(existing) && isRecord(value) ? { ...existing, ...value } : value;
  }
}

function applyPatches(
  schema: Record<string, unknown>,
  kind: string,
  patches: SchemaPatches,
): void {
  for (const [path, keywords] of Object.entries(patches)) {
    const nodes = findNodes(schema, path);
    if (nodes.length === 0) {
      throw new Error(`${kind} schema has no property at "${path}" to patch`);
    }
    for (const node of nodes) mergeKeywords(node, keywords);
  }
}

/** A claim schema as fs-forge uses it: the published one plus CLI patches. */
export function loadClaimSchema(
  schemasDir: string,
  kind: string,
): Record<string, unknown> {
  const schema = JSON.parse(
    readFileSync(join(schemasDir, `${kind}.json`), 'utf8'),
  ) as Record<string, unknown>;
  applyPatches(schema, kind, SCHEMA_PATCHES[kind] ?? {});
  return schema;
}
