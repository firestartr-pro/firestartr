import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { x as extractArchive } from 'tar';
import YAML from 'yaml';

import { ClaimsClient } from './client.js';

async function yamlFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? yamlFiles(path)
          : /\.ya?ml$/i.test(entry.name)
            ? [path]
            : [];
      }),
    )
  ).flat();
}

export async function loadClaimsArchive(
  client: ClaimsClient,
  ref?: string,
): Promise<Record<string, unknown>[]> {
  const directory = await mkdtemp(join(tmpdir(), 'fs-forge-claims-'));
  try {
    const archive = join(directory, 'claims.tar.gz');
    await writeFile(archive, await client.downloadTarball(ref));
    await extractArchive({
      cwd: directory,
      file: archive,
      strip: 1,
      filter: (path, entry) =>
        !path.startsWith('/') &&
        !path.split('/').includes('..') &&
        /(^|\/)claims\/.*\.ya?ml$/i.test(path) &&
        'type' in entry &&
        ['File', 'OldFile'].includes(entry.type),
    });

    const claimsDirectory = join(directory, 'claims');
    const files = await yamlFiles(claimsDirectory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    return Promise.all(
      files.sort().map(async (file) => {
        const value: unknown = YAML.parse(await readFile(file, 'utf8'));
        if (
          typeof value !== 'object' ||
          value === null ||
          Array.isArray(value)
        ) {
          throw new Error(`${file} does not contain a claim object`);
        }
        return value as Record<string, unknown>;
      }),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
