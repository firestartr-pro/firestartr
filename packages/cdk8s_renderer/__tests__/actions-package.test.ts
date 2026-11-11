import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv';
import { schemas } from '../src/schemas/actions';

test('producer publishes disjoint views without duplicate IDs', () => {
  const root = resolve(__dirname, '../../..');
  const output = execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/tsx/dist/cli.mjs'),
      join(root, 'packages/cdk8s_renderer/scripts/schema-npm-producer.ts'),
      '0.0.0-test',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const directory = output.match(/Created output dir: (.+)/)?.[1];
  expect(directory).toBeDefined();
  if (!directory) throw new Error(output);
  const json = (file: string) =>
    JSON.parse(readFileSync(join(directory, file), 'utf8'));
  try {
    expect(readdirSync(join(directory, 'actions')).sort()).toEqual(
      [
        ...Object.keys(schemas).map((name) => `${name}.schema.json`),
        'index.mjs',
      ].sort(),
    );
    expect(json('package.json').exports).toMatchObject({
      './actions': './actions/index.mjs',
      './actions/*': './actions/*',
    });
    expect(
      readFileSync(join(directory, 'actions/index.mjs'), 'utf8'),
    ).toContain("with { type: 'json' }");
    const ajv = new Ajv();
    for (const name of readdirSync(join(directory, 'dot-firestartr'))) {
      if (name.endsWith('.json')) {
        const schema = json(`dot-firestartr/${name}`);
        expect(schema).not.toHaveProperty('$id');
        ajv.compile(schema);
      }
    }
    for (const [name, source] of Object.entries(schemas)) {
      const schema = json(`actions/${name}.schema.json`);
      const expected = { ...source } as Record<string, unknown>;
      delete expected.$id;
      expect(schema).toEqual(expected);
      expect(schema).not.toHaveProperty('$id');
      expect(() => ajv.compile(schema)).not.toThrow();
      expect(readdirSync(join(directory, 'schemas'))).not.toContain(
        `${name}.json`,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30000);
