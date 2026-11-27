import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';

import {
  dotFirestartrSchemasDir,
  loadDotFirestartrSchema,
  loadDotFirestartrValidator,
} from '../src/schema/dotFirestartrSchemas.js';

const PACKAGE_ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(PACKAGE_ROOT, '__tests__', 'fixtures', 'dot-firestartr');

describe('dotFirestartrSchemas', () => {
  const schemasDir = dotFirestartrSchemasDir(PACKAGE_ROOT);

  it('resolves and loads apps and state_apps_env schemas offline', () => {
    const appsSchema = loadDotFirestartrSchema(schemasDir, 'apps');
    const envSchema = loadDotFirestartrSchema(schemasDir, 'state_apps_env');
    expect(appsSchema.title).toBe('Firestartr application');
    expect(envSchema.title).toBe('State repo app environment');
  });

  it('validates the apps.yaml fixture and rejects missing required fields', () => {
    const validate = loadDotFirestartrValidator('apps', schemasDir);
    const fixture = YAML.parse(
      readFileSync(join(FIXTURES_DIR, 'apps.yaml'), 'utf8'),
    );
    expect(validate(fixture)).toBe(true);
    expect(validate({ name: 'only-name' })).toBe(false);
  });

  it('validates a state_apps_env object and rejects forbidden keys', () => {
    const validate = loadDotFirestartrValidator('state_apps_env', schemasDir);
    expect(
      validate({
        version: '1.2.3',
        chart: 'example-aws/example/charts/web',
        releaseName: 'my-app',
        hooks: [],
        extraPatches: [],
        remoteArtifacts: [],
        execs: [],
      }),
    ).toBe(true);
    expect(
      validate({
        version: '1.2.3',
        chart: 'example-aws/example/charts/web',
        app: 'my-app',
      }),
    ).toBe(false);
  });
});
