import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import common from 'catalog_common';

import type { K8sListResource, K8sResource } from './types';

const MANIFEST_EXTENSIONS = new Set(['.yaml', '.yml']);

export function assertManifestPath(inputPath: string): void {
  const stats = fs.statSync(inputPath);
  if (!stats.isFile()) {
    return;
  }

  const extension = path.extname(inputPath);
  if (!MANIFEST_EXTENSIONS.has(extension)) {
    throw new Error(
      `Expected YAML file but got: ${inputPath}. File must have .yaml or .yml extension.`,
    );
  }
}

function splitManifests(content: string): string[] {
  return content
    .split(/^---\s*$/m)
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function readManifestFile(
  filePath: string,
): Promise<K8sResource[]> {
  const content = await fsPromises.readFile(filePath, 'utf-8');
  const parts = splitManifests(content);

  return parts
    .map((doc) => {
      try {
        return common.io.fromYaml(doc) as K8sResource;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse YAML in ${filePath}: ${message}`);
      }
    })
    .filter((doc) => doc !== null && doc !== undefined);
}

export function isManifestList(obj: K8sResource): obj is K8sListResource {
  return (
    obj.kind === 'List' &&
    'items' in obj &&
    Array.isArray((obj as unknown as K8sListResource).items)
  );
}

export function expandManifestList(objects: K8sResource[]): K8sResource[] {
  const expanded: K8sResource[] = [];

  for (const obj of objects) {
    if (!obj) continue;

    if (isManifestList(obj)) {
      expanded.push(...obj.items);
      continue;
    }

    expanded.push(obj);
  }

  return expanded;
}

export async function getPrimaryManifestResource(
  crPath: string,
): Promise<K8sResource> {
  const parsed = await readManifestFile(crPath);
  const objects = expandManifestList(parsed);
  const resource = objects[0];

  if (!resource) {
    throw new Error(`No Kubernetes resources found in ${crPath}`);
  }

  if (!resource.metadata?.name) {
    throw new Error(`Missing metadata.name in first resource from ${crPath}`);
  }

  return resource;
}

export function formatResourceLabel(
  kind: string,
  name: string,
  namespace?: string,
): string {
  const nsLabel = namespace ? ` (ns=${namespace})` : '';
  return `${kind}/${name}${nsLabel}`;
}
