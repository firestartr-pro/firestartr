import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const SCHEMAS_PACKAGE = '@firestartr/firestartr-claims_schemas';

export const ACTIONS_SCHEMA_FILES = {
  make_dispatches: 'config.schema.json',
  build_images: 'build-images.schema.json',
} as const;

export type ActionsSchemaName = keyof typeof ACTIONS_SCHEMA_FILES;

export type ActionsValidator = ReturnType<Ajv2020['compile']>;

// Plain Draft 2020-12 Ajv instance for actions schemas from @firestartr/firestartr-claims_schemas.
const ajv = new Ajv2020({ allErrors: true });

const compiledByDir = new Map<
  string,
  Map<ActionsSchemaName, ActionsValidator>
>();

export function actionsSchemasDir(root: string): string {
  const entry = createRequire(join(root, 'package.json')).resolve(
    SCHEMAS_PACKAGE,
  );
  return join(dirname(entry), 'actions');
}

export function loadActionsSchema(
  schemasDir: string,
  name: ActionsSchemaName,
): Record<string, unknown> {
  const filePath = join(schemasDir, ACTIONS_SCHEMA_FILES[name]);
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function loadActionsValidator(
  name: ActionsSchemaName,
  schemasDir: string,
): ActionsValidator {
  let dirCache = compiledByDir.get(schemasDir);
  if (!dirCache) {
    dirCache = new Map<ActionsSchemaName, ActionsValidator>();
    compiledByDir.set(schemasDir, dirCache);
  }

  const cached = dirCache.get(name);
  if (cached) return cached;

  const schema = loadActionsSchema(schemasDir, name);
  const validator = ajv.compile(schema);
  dirCache.set(name, validator);
  return validator;
}
