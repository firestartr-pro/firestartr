import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const SCHEMAS_PACKAGE = '@firestartr/firestartr-claims_schemas';

export const DOT_FIRESTARTR_SCHEMA_FILES = {
  apps: 'apps.schema.json',
  state_apps_env: 'state_apps_env.schema.json',
} as const;

export type DotFirestartrSchemaName = keyof typeof DOT_FIRESTARTR_SCHEMA_FILES;

export type DotFirestartrValidator = ReturnType<Ajv2020['compile']>;

// Plain Draft 2020-12 Ajv instance for dot-firestartr schemas from @firestartr/firestartr-claims_schemas.
const ajv = new Ajv2020({ allErrors: true });

const compiledByDir = new Map<
  string,
  Map<DotFirestartrSchemaName, DotFirestartrValidator>
>();

export function dotFirestartrSchemasDir(root: string): string {
  const entry = createRequire(join(root, 'package.json')).resolve(
    SCHEMAS_PACKAGE,
  );
  return join(dirname(entry), 'dot-firestartr');
}

export function loadDotFirestartrSchema(
  schemasDir: string,
  name: DotFirestartrSchemaName,
): Record<string, unknown> {
  const filePath = join(schemasDir, DOT_FIRESTARTR_SCHEMA_FILES[name]);
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function loadDotFirestartrValidator(
  name: DotFirestartrSchemaName,
  schemasDir: string,
): DotFirestartrValidator {
  let dirCache = compiledByDir.get(schemasDir);
  if (!dirCache) {
    dirCache = new Map<DotFirestartrSchemaName, DotFirestartrValidator>();
    compiledByDir.set(schemasDir, dirCache);
  }

  const cached = dirCache.get(name);
  if (cached) return cached;

  const schema = loadDotFirestartrSchema(schemasDir, name);
  const validator = ajv.compile(schema);
  dirCache.set(name, validator);
  return validator;
}
