import Ajv2020 from 'ajv/dist/2020.js';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join } from 'path';

import { createFeatureSource } from './featureSource.js';
import { isRecord } from './isRecord.js';

import type { ValidationResult } from './ajvValidation.js';

function cachePath(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid Feature name: ${name}`);
  }
  const cacheDir =
    process.env.FS_FORGE_FEATURE_CACHE_DIR ??
    join(homedir(), '.cache', 'fs-forge', 'features');
  return join(cacheDir, `${name}.json`);
}

export async function resolveLatestFeatureSchema(
  source: string,
  name: string,
  refresh = false,
): Promise<Record<string, unknown>> {
  const path = cachePath(name);
  if (!refresh) {
    let content: string | undefined;
    try {
      content = await readFile(path, 'utf8');
    } catch (error) {
      if (!isRecord(error) || !('code' in error) || error.code !== 'ENOENT') {
        throw new Error(
          `Unable to read cached schema for Feature ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (content !== undefined) {
      try {
        const cached: unknown = JSON.parse(content);
        if (isRecord(cached)) return cached;
      } catch {
        // Invalid cache entries are replaced from the Feature source below.
      }
    }
  }

  const featureSource = createFeatureSource(source);
  const feature = (await featureSource.readFeatureIndex()).features.find(
    (candidate) => candidate.name === name,
  );
  if (!feature) throw new Error(`Unknown Feature: ${name}`);
  const schema = await featureSource.readFeatureSchema(name, feature.version);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  return schema;
}

export function validateFeatureArgs(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): ValidationResult {
  // Feature schemas come from an external, uncontrolled source and may
  // declare a "$schema" draft (e.g. draft-07) that Ajv2020 has no
  // meta-schema registered for, which makes ajv.compile() throw instead of
  // returning validation errors. These schemas only use basic keywords
  // (type/properties/const/...) that are meta-schema-agnostic, so drop the
  // declared draft and let Ajv2020 validate structurally.
  const { $schema: _ignoredSchemaDraft, ...schemaWithoutDraft } = schema;
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    schemaWithoutDraft,
  );
  if (validate(args)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((error) =>
      `${error.instancePath} ${error.message}`.trim(),
    ),
  };
}
