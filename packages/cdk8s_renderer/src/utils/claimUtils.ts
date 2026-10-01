const KINDS_CR_MAP: any = {
  group: 'FirestartrGithubGroup',
  user: 'FirestartrGithubMembership',
  repo: 'FirestartrGithubRepository',
  feat: 'FirestartrGithubRepositoryFeature',
  secretsSection: 'FirestartrGithubRepositorySecretsSection',
};

import fs from 'fs';
import { stat, readdir } from 'node:fs/promises';
import path from 'path';
import common from 'catalog_common';

import log from '../logger';
import { getTfWorkspacesRefs } from '../refsSorter/refsExtractor';

export function resolveStringReference(reference: string): any {
  const referenceElements: string[] = reference.split(':');

  const actualKind: string = KINDS_CR_MAP[referenceElements[0]];

  return {
    kind: actualKind,

    name: referenceElements[1],
  };
}

export async function* claimsRefListAsGenerator(
  refs: string[],
): AsyncGenerator<string, void, unknown> {
  for (const ref of refs) {
    yield ref;
  }
}

// Given a fileList "<file1>,<file2>....<fileN>"
// It parses the files an returns a list of references
// in the form of <kind>-<name>
export function resolveClaimFilesList(claimRefsList: string): string[] {
  const fileList: string[] = claimRefsList.replace(/\s/g, '').split(',');

  const refList: string[] = [];

  for (const file of fileList) {
    try {
      const data = fs.readFileSync(file, 'utf-8');

      const claim: any = common.io.fromYaml(data);

      if (!('kind' in claim && 'name' in claim)) {
        throw 'Invalid claim file, has not kind and/or name';
      } else {
        const claimRef = `${claim.kind}-${claim.name}`;

        refList.push(claimRef);
      }
    } catch (err) {
      throw `Error: file ${file}: ${err}`;
    }
  }

  return refList;
}

// This function receives an array of entries (dirs or files)
// it returns a generator able to be used in a loop
// under the form: for await (const claimRef of resolveClaimRefsGenerator){}
// If dirs are passed, it resolves them recursively
export async function* resolveClaimEntries(
  claimRefsList: string[],
): AsyncGenerator<string, void, unknown> {
  log.info(`Resolving ${claimRefsList.join(',')}`);

  for (const claimEntry of claimRefsList) {
    try {
      const claimEntryStats = await stat(claimEntry);

      if (claimEntryStats.isDirectory()) {
        yield* resolveDirEntries(claimEntry);
      } else if (claimEntryStats.isFile()) {
        log.debug(
          `Sending entry ${resolveClaimFileRef(claimEntry)} (${claimEntry})`,
        );
        yield resolveClaimFileRef(claimEntry);
      }
    } catch (err) {
      throw new Error(`Error processing: ${claimEntry}: ${err}`);
    }
  }
}
// this function recursively searches for files
// it returns a generator that yields claimRefs
async function* resolveDirEntries(
  dir: string,
): AsyncGenerator<string, void, unknown> {
  let entries = [];

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Reading dir: ${dir}: ${err}`);
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* resolveDirEntries(fullPath);
    } else if (entry.isFile() && entry.name.match(/\.yaml$|\.yml$/)) {
      const claimRef = await resolveClaimFileRef(fullPath);
      log.debug(`Sending entry ${claimRef} (${fullPath})`);
      yield claimRef;
    }
  }
}

export async function resolveClaimFileRef(claimFile: string): Promise<string> {
  try {
    const data = await fs.promises.readFile(claimFile, 'utf-8');

    const claim: any = common.io.fromYaml(data);

    if (!('kind' in claim && 'name' in claim)) {
      throw new Error('Invalid claim file has not kind and/or name');
    } else {
      const claimRef = `${claim.kind}-${claim.name}`;

      return claimRef;
    }
  } catch (err) {
    throw new Error(`Error: file ${claimFile}: ${err}`);
  }
}

export function getClaimsEntryAbsolutePath(
  claimsDir: string,

  entryPath: string,
) {
  let realEntryPath = '';

  if (path.isAbsolute(entryPath)) {
    realEntryPath = entryPath;
  } else {
    realEntryPath = path.join(claimsDir, entryPath);
  }

  if (isPathInside(claimsDir, realEntryPath)) {
    return realEntryPath;
  } else {
    throw new Error(
      `getClaimsEntryAbsolutePath: path ${entryPath} does not belong to ${claimsDir}`,
    );
  }
}

function isPathInside(pathA: string, pathB: string): boolean {
  const absolutePathA = path.resolve(pathA);
  const absolutePathB = path.resolve(pathB);

  const normalizedPathA = path.normalize(absolutePathA);
  const normalizedPathB = path.normalize(absolutePathB);

  // Ensure pathA ends with a separator to avoid partial matches
  // e.g., /foo/lol must not match /foo/lollipop
  const pathAWithSeparator = normalizedPathA.endsWith(path.sep)
    ? normalizedPathA
    : `${normalizedPathA}${path.sep}`;

  return (
    normalizedPathB.startsWith(pathAWithSeparator) ||
    normalizedPathB === normalizedPathA
  );
}

export function sanitizeApiEntityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ClaimsMapEntry {
  filePath: string;
  refs?: string[];
}

export interface ClaimsMap {
  headers: {
    sha: string;
  };
  claims: Record<string, ClaimsMapEntry>;
}

export async function generateClaimsMap(
  claimsPath: string,
  outputPath: string,
  sha?: string,
): Promise<void> {
  const map: ClaimsMap = {
    headers: {
      sha: sha ?? '',
    },
    claims: {},
  };

  await crawlClaimsDir(claimsPath, claimsPath, map.claims);

  await fs.promises.writeFile(
    outputPath,
    JSON.stringify(map, null, 2),
    'utf-8',
  );
}

async function crawlClaimsDir(
  dir: string,
  basePath: string,
  claims: Record<string, ClaimsMapEntry>,
): Promise<void> {
  let entries: fs.Dirent[];

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(`Reading directory ${dir}: ${err}`);
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await crawlClaimsDir(fullPath, basePath, claims);
    } else if (entry.isFile() && entry.name.match(/\.yaml$|\.yml$/)) {
      try {
        const data = await fs.promises.readFile(fullPath, 'utf-8');
        const claim: any = common.io.fromYaml(data);

        if (
          typeof claim !== 'object' ||
          claim === null ||
          typeof claim.kind !== 'string' ||
          !claim.kind ||
          typeof claim.name !== 'string' ||
          !claim.name
        ) {
          log.warn(
            `Skipping file ${fullPath}: missing or invalid kind or name`,
          );
          continue;
        }

        const ref = `${claim.kind}-${claim.name}`;
        if (claims[ref]) {
          throw new Error(`Duplicate claim reference: ${ref}`);
        }
        const relativePath = path
          .relative(basePath, fullPath)
          .split(path.sep)
          .join(path.posix.sep);

        if (claim.kind === 'TFWorkspaceClaim') {
          const values = claim.providers?.terraform?.values;
          const [tfRefs] = getTfWorkspacesRefs(values ?? {});
          const uniqueRefs = [
            ...new Set(tfRefs.map((r) => `TFWorkspaceClaim-${r}`)),
          ];
          claims[ref] = { filePath: relativePath, refs: uniqueRefs };
        } else {
          claims[ref] = { filePath: relativePath };
        }
      } catch (err) {
        throw new Error(`Error processing claim file ${fullPath}: ${err}`);
      }
    }
  }
}
