import { describe, expect, it, jest } from '@jest/globals';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildCommandModel } from '../src/codegen/model';
import { generateAllCommands } from '../src/codegen/generateCommands';

// prettier's CommonJS entry lazily imports its ESM build, which jest's VM
// rejects without --experimental-vm-modules. Substitute the standalone build
// (same version, same printer) so the runner can be exercised in-process.
jest.mock('prettier', () => ({
  format: async (source: string, options: Record<string, unknown>) => {
    const standalone = jest.requireActual(
      'prettier/standalone',
    ) as typeof import('prettier/standalone');
    const typescript = jest.requireActual('prettier/plugins/typescript');
    const estree = jest.requireActual('prettier/plugins/estree');
    return standalone.format(source, {
      ...options,
      plugins: [estree, typescript],
    } as never);
  },
}));

const ROOT = process.cwd();
const SCHEMAS_DIR = join(ROOT, 'schemas');

async function claimSchemas(): Promise<Array<{ kind: string; schema: Record<string, unknown> }>> {
  const files = (await readdir(SCHEMAS_DIR))
    .filter((file) => file.endsWith('Claim.json'))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      kind: file.replace(/\.json$/, ''),
      schema: JSON.parse(
        await readFile(join(SCHEMAS_DIR, file), 'utf8'),
      ) as Record<string, unknown>,
    })),
  );
}

describe('claim command model', () => {
  it('builds one model per claim schema from its metadata', async () => {
    const schemas = await claimSchemas();
    expect(schemas).toHaveLength(10);

    for (const { kind, schema } of schemas) {
      const model = buildCommandModel(schema, kind);

      expect(model.kind).toBe(kind);
      expect(model.id).toBe(kind.replace(/Claim$/, '').toLowerCase());
      expect(model.summary.length).toBeGreaterThan(0);
      expect(model.summary).not.toMatch(/^A(n)? \w+ claim$/);
      expect(model.icon.emoji.length).toBeGreaterThan(0);
      expect(model.icon.ascii.length).toBeGreaterThan(0);
    }
  });

  it('rejects a schema without summary or icon metadata', () => {
    expect(() => buildCommandModel({}, 'FooClaim')).toThrow(
      'FooClaim schema is missing x-fs-forge-summary metadata',
    );
    expect(() =>
      buildCommandModel(
        { 'x-fs-forge-summary': 'A foo claim.' },
        'FooClaim',
      ),
    ).toThrow('FooClaim schema is missing x-fs-forge-icon metadata');
  });

  it('derives unique flag paths and the JSON escape hatches for complex fields', async () => {
    const schemas = await claimSchemas();
    const models = schemas.map(({ kind, schema }) =>
      buildCommandModel(schema, kind),
    );

    for (const model of models) {
      const paths = model.flagSpecs.map((flag) => flag.path);
      expect(new Set(paths).size).toBe(paths.length);
    }

    const component = models.find((model) => model.kind === 'ComponentClaim')!;
    expect(
      component.flagSpecs.map((flag) => flag.path),
    ).toContain('providesApis.json');

    const secrets = models.find((model) => model.kind === 'SecretsClaim')!;
    expect(secrets.flagSpecs.map((flag) => flag.path)).toContain(
      'providers.external_secrets.json',
    );
  });
});

describe('generateAllCommands', () => {
  it('regenerates the committed files byte for byte', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'fs-forge-codegen-'));
    try {
      const { written } = await generateAllCommands({
        schemasDir: SCHEMAS_DIR,
        outDir,
      });

      expect(written).toHaveLength(12);

      for (const path of written) {
        const relative = path.slice(outDir.length + 1);
        const generated = await readFile(path, 'utf8');
        const committed = await readFile(join(ROOT, 'src', relative), 'utf8');
        expect(generated).toBe(committed);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
