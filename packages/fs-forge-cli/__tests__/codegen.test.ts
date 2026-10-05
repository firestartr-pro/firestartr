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

type SchemaObject = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaBranches(
  schema: SchemaObject,
  keyword: 'allOf' | 'oneOf' | 'anyOf',
): SchemaObject[] {
  const value = schema[keyword];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function schemaProperties(schema: SchemaObject): Record<string, SchemaObject> {
  const result: Record<string, SchemaObject> = {};
  if (isRecord(schema.properties)) {
    for (const [name, value] of Object.entries(schema.properties)) {
      if (isRecord(value)) result[name] = value;
    }
  }
  for (const branch of schemaBranches(schema, 'allOf')) {
    Object.assign(result, schemaProperties(branch));
  }
  return result;
}

/**
 * Every property the flag walker must expose as a `.json` escape hatch
 * (ADR 0001): unions and arrays whose items are not scalars. Read from the
 * schema, so a new complex property cannot silently ship without a hatch.
 */
function jsonEscapeHatchPaths(schema: SchemaObject): string[] {
  const paths = new Set<string>();
  const walk = (node: SchemaObject, prefix: string): void => {
    const union = [
      ...schemaBranches(node, 'oneOf'),
      ...schemaBranches(node, 'anyOf'),
    ];
    if (union.length > 0 && prefix !== '') paths.add(`${prefix}.json`);

    for (const [key, child] of Object.entries(schemaProperties(node))) {
      if (child.$ref) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (child.type === 'array') {
        const items = isRecord(child.items) ? child.items : undefined;
        const scalarItems =
          items !== undefined &&
          typeof items.type === 'string' &&
          ['string', 'number', 'boolean', 'integer'].includes(items.type);
        if (!scalarItems) paths.add(`${path}.json`);
        continue;
      }
      const isObject =
        child.type === 'object' ||
        schemaBranches(child, 'allOf').length > 0 ||
        schemaBranches(child, 'oneOf').length > 0 ||
        schemaBranches(child, 'anyOf').length > 0 ||
        Object.keys(schemaProperties(child)).length > 0;
      if (isObject) walk(child, path);
    }

    for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
      for (const branch of schemaBranches(node, keyword)) walk(branch, prefix);
    }
  };
  walk(schema, '');
  return [...paths];
}

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

    for (const { kind, schema } of schemas) {
      const model = models.find((candidate) => candidate.kind === kind)!;
      const paths = new Set(model.flagSpecs.map((flag) => flag.path));
      for (const path of jsonEscapeHatchPaths(schema)) {
        expect(paths).toContain(path);
      }
    }
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
