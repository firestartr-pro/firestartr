import fs from 'node:fs/promises';
import common from 'catalog_common';
import { deepMerge } from './utils/deep-merge';
import {
  buildClaimRef,
  CLAIM_KIND_TO_CR_KIND,
  getRelatedCrKindsForClaimKind,
  isClaimKind,
  type ClaimKind,
  type ClaimRef,
} from './claim-taxonomy';

import type { TestContext } from './types';
import type { K8sResource } from './k8s/types';

type YamlResource = {
  kind?: string;
  metadata?: {
    name?: string;
    annotations?: Record<string, string>;
  };
  spec?: unknown;
};

export type ClaimResource = {
  kind: ClaimKind;
  name: string;
};

const SUPPORTED_CLAIM_KINDS = Object.keys(CLAIM_KIND_TO_CR_KIND).join(', ');

const CLAIM_REF_ANNOTATION =
  common.generic.getFirestartrAnnotation('claim-ref');

type RenderedCrMatch = {
  filePath: string;
  kind: string;
};

function sortRenderedCrMatches(
  matches: RenderedCrMatch[],
  kindOrder: string[],
): RenderedCrMatch[] {
  const kindRank = new Map(kindOrder.map((kind, index) => [kind, index]));

  return [...matches].sort((a, b) => {
    const aRank = kindRank.get(a.kind) ?? Number.MAX_SAFE_INTEGER;
    const bRank = kindRank.get(b.kind) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    return a.filePath.localeCompare(b.filePath);
  });
}

export async function findRenderedCrPaths(
  crsPath: string,
  claimKind: ClaimKind,
  claimRef: ClaimRef,
): Promise<string[]> {
  const crKinds = getRelatedCrKindsForClaimKind(claimKind);

  const files = common.io.getFileListRecursively(
    crsPath,
    [],
    ['.yaml', '.yml'],
  );

  const matches: RenderedCrMatch[] = [];

  for (const filePath of files) {
    const resource = await readK8sResource(filePath);
    if (!crKinds.includes(resource.kind)) continue;

    const annotation = resource.metadata?.annotations?.[CLAIM_REF_ANNOTATION];
    if (annotation !== claimRef) {
      continue;
    }

    matches.push({ filePath, kind: resource.kind });
  }

  if (matches.length === 0) {
    throw new Error(`Rendered ${crKinds[0]} not found for ${claimRef}`);
  }

  const orderedMatches = sortRenderedCrMatches(matches, crKinds);
  return orderedMatches.map(({ filePath }) => filePath);
}

export async function readK8sResource(filePath: string): Promise<K8sResource> {
  const content = await fs.readFile(filePath, 'utf-8');
  const resource = common.io.fromYaml(content) as unknown;
  if (!isYamlResource(resource)) {
    throw new Error(`Invalid resource in ${filePath}: expected object`);
  }
  return resource as K8sResource;
}

export async function readClaimResource(
  context: TestContext,
  claimFile: string,
): Promise<ClaimResource> {
  const content = await context.getFile(claimFile);
  return parseClaimResource(context.fromYaml(content), claimFile);
}

export function parseClaimResource(
  value: unknown,
  claimFile: string,
): ClaimResource {
  const error = getClaimResourceError(value, claimFile);
  if (error) {
    throw new Error(error);
  }

  return value as ClaimResource;
}

export async function patchResourceSpecContext(
  filePath: string,
  contextPatch: {
    backend: Record<string, unknown>;
    provider?: Record<string, unknown>;
    providers?: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = common.io.fromYaml(content);
  if (!isMergeableYamlObject(parsed)) {
    throw new Error(`Invalid resource in ${filePath}: expected YAML object`);
  }

  const merged = deepMerge(parsed, {
    spec: {
      context: contextPatch,
    },
  });

  await fs.writeFile(filePath, common.io.toYaml(merged), 'utf-8');
}

function isYamlResource(value: unknown): value is YamlResource {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if ('kind' in record && typeof record.kind !== 'string') return false;
  if (
    'metadata' in record &&
    (typeof record.metadata !== 'object' || record.metadata === null)
  ) {
    return false;
  }
  return true;
}

function isMergeableYamlObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClaimResource(value: unknown): value is ClaimResource {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isClaimKind(record.kind) &&
    typeof record.name === 'string' &&
    record.name.length > 0
  );
}

function getClaimResourceError(
  value: unknown,
  claimFile: string,
): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `Invalid claim in ${claimFile}: expected object`;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string') {
    return `Invalid claim in ${claimFile}: expected supported claim kind (${SUPPORTED_CLAIM_KINDS})`;
  }

  if (!isClaimKind(record.kind)) {
    return `Unsupported claim kind '${record.kind}' in ${claimFile}. Supported claim kinds: ${SUPPORTED_CLAIM_KINDS}`;
  }

  if (typeof record.name !== 'string' || record.name.length < 1) {
    return `Invalid claim in ${claimFile}: expected non-empty claim name`;
  }

  return null;
}
