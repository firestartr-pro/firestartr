import fs from 'node:fs/promises';
import path from 'node:path';
import common from 'catalog_common';
import { getE2EState } from '../api/internal-state';
import { isClaimKind, type ClaimKind } from '../claim-taxonomy';
import { parseClaimResource } from '../cr-finder';
import { resolveE2eBaseClaimsPath } from '../fixtures-path';

import type { E2EApi } from '../types';
import type { ResolvedFixtureResource } from './fixture-plan';

type ResolvedFixtureMetadata = {
  fixtureName: string;
  claimName: string;
  claimKind: ClaimKind;
};

function normalizeFixtureName(fixtureName: string): string {
  return fixtureName.replace(/-/g, '_').trim();
}

function findFixturePaths(
  baseClaimsPath: string,
  fixtureName: string,
): string[] {
  const normalizedFixtureName = normalizeFixtureName(fixtureName);
  if (!normalizedFixtureName) {
    return [];
  }

  const files = common.io.getFileListRecursively(
    baseClaimsPath,
    [],
    ['.yaml', '.yml'],
  );

  return files.filter((filePath) => {
    return path.parse(filePath).name === normalizedFixtureName;
  });
}

async function readFixtureClaimKind(
  baseClaimsPath: string,
  fixtureName: string,
): Promise<ClaimKind> {
  const fixturePaths = findFixturePaths(baseClaimsPath, fixtureName);

  if (fixturePaths.length < 1) {
    throw new Error(
      `Fixture '${fixtureName}' not found under base claims path '${baseClaimsPath}'`,
    );
  }

  if (fixturePaths.length > 1) {
    throw new Error(
      `Fixture '${fixtureName}' is ambiguous under base claims path '${baseClaimsPath}': ${fixturePaths.join(', ')}`,
    );
  }

  const fixturePath = fixturePaths[0];
  if (!fixturePath) {
    throw new Error(
      `Fixture '${fixtureName}' resolved to an empty path under '${baseClaimsPath}'`,
    );
  }

  const content = await fs.readFile(fixturePath, 'utf-8');
  const parsed = common.io.fromYaml(content);
  const claim = parseClaimResource(parsed, fixturePath);

  if (!isClaimKind(claim.kind)) {
    throw new Error(`Unsupported claim kind '${claim.kind}' in ${fixturePath}`);
  }

  return claim.kind;
}

export async function resolveFixtureMetadata(
  client: E2EApi,
  resolvedFixtures: ResolvedFixtureResource[],
): Promise<ResolvedFixtureMetadata[]> {
  const baseClaimsPath = resolveBaseClaimsPath(client);
  const claimKindByFixtureName = new Map<string, ClaimKind>();

  for (const { fixtureName } of resolvedFixtures) {
    if (claimKindByFixtureName.has(fixtureName)) {
      continue;
    }

    claimKindByFixtureName.set(
      fixtureName,
      await readFixtureClaimKind(baseClaimsPath, fixtureName),
    );
  }

  return resolvedFixtures.map(({ fixtureName, claimName }) => {
    const claimKind = claimKindByFixtureName.get(fixtureName);
    if (!claimKind) {
      throw new Error(
        `Could not resolve claim kind for fixture '${fixtureName}'`,
      );
    }

    return {
      fixtureName,
      claimName,
      claimKind,
    };
  });
}

function resolveBaseClaimsPath(client: E2EApi): string {
  try {
    const state = getE2EState(client);
    return state.fixturesBasePath
      ? path.join(state.fixturesBasePath, 'base_claims')
      : resolveE2eBaseClaimsPath();
  } catch {
    return resolveE2eBaseClaimsPath();
  }
}
