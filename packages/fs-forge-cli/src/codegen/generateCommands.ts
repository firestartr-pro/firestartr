import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { format } from 'prettier';

import { buildCommandModel } from './model.js';
import {
  emitCreateCommand,
  emitKindMetadata,
  emitKindsCommand,
} from './emit.js';

import type { ClaimCommandModel } from './model.js';

/**
 * Package root. The npm scripts run this file directly (`tsx
 * src/codegen/generateCommands.ts`, and `prebuild` before `tsc`), so the entry
 * path is `<pkg>/src/codegen/generateCommands.ts` — or the built
 * `<pkg>/dist/codegen/generateCommands.js`. Deriving it from `process.argv[1]`
 * avoids `import.meta`, which the CommonJS test transform rejects.
 */
function packageRoot(): string {
  const entry = process.argv[1];
  if (entry && /^generateCommands\.(ts|js)$/.test(basename(entry))) {
    return resolve(dirname(entry), '..', '..');
  }
  return process.cwd();
}

const PKG_ROOT = packageRoot();

export interface GenerateOptions {
  /** Directory holding <Kind>.json claim schemas. Defaults to <pkg>/schemas. */
  schemasDir?: string;
  /** Destination root; mirrors src/commands and src/claims. Defaults to <pkg>/src. */
  outDir?: string;
}

export interface GenerateResult {
  written: string[];
  models: ClaimCommandModel[];
}

async function prettify(source: string): Promise<string> {
  return format(source, { parser: 'typescript', singleQuote: true });
}

/**
 * Reads claim schemas, builds command models and writes the generated sources.
 * Filesystem access is confined to the caller-supplied schemasDir and outDir.
 */
export async function generateAllCommands(
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const schemasDir = options.schemasDir ?? join(PKG_ROOT, 'schemas');
  const outDir = options.outDir ?? join(PKG_ROOT, 'src');

  const commandsDir = join(outDir, 'commands', 'create');
  await mkdir(commandsDir, { recursive: true });

  const claimKinds = (await readdir(schemasDir))
    .filter((file) => file.endsWith('Claim.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();

  const written: string[] = [];
  const models: ClaimCommandModel[] = [];
  for (const kind of claimKinds) {
    const schemaPath = join(schemasDir, `${kind}.json`);
    let schema: Record<string, unknown>;
    try {
      const content = await readFile(schemaPath, 'utf8');
      schema = JSON.parse(content) as Record<string, unknown>;
    } catch {
      console.warn(`Schema not found for ${kind}, skipping.`);
      continue;
    }

    const model = buildCommandModel(schema, kind);
    models.push(model);

    const outPath = join(commandsDir, `${model.id}.ts`);
    await writeFile(outPath, await prettify(emitCreateCommand(model)), 'utf8');
    written.push(outPath);
    console.log(`Generated: ${outPath} (${model.flagSpecs.length} flags)`);
  }

  const kindsCmdPath = join(outDir, 'commands', 'kinds.ts');
  await writeFile(
    kindsCmdPath,
    await prettify(emitKindsCommand(models)),
    'utf8',
  );
  written.push(kindsCmdPath);
  console.log(`Generated: ${kindsCmdPath}`);

  const claimKindsPath = join(outDir, 'claims', 'kinds.ts');
  await mkdir(join(outDir, 'claims'), { recursive: true });
  await writeFile(
    claimKindsPath,
    await prettify(emitKindMetadata(models)),
    'utf8',
  );
  written.push(claimKindsPath);
  console.log(`Generated: ${claimKindsPath}`);

  return { written, models };
}

function isEntryPoint(): boolean {
  return (
    process.argv[1] !== undefined &&
    /^generateCommands\.(ts|js)$/.test(basename(process.argv[1]))
  );
}

if (isEntryPoint()) {
  generateAllCommands().catch((err) => {
    console.error('Command generation failed:', err);
    process.exit(1);
  });
}
