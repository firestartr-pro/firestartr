import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import YAML from 'yaml';

import { formatAjvErrors } from '../utils/ajvValidation.js';

export type AppTrack = 'snapshots' | 'pre-releases' | 'releases';

export interface AppServiceInput {
  repo: string;
  release_type: string;
  service_names?: string[];
}

export interface AppTargetInput {
  platform: string;
  tenant: string;
  env: string;
  cluster_url: string;
  track: AppTrack;
  flavor?: string;
}

export interface AppChartInput {
  name: string;
  version: string;
  registry: string;
}

export interface AppInputs {
  org?: string;
  app: string;
  service: AppServiceInput;
  targets: AppTargetInput[];
  chart: AppChartInput;
  slack_channel?: string;
  owner?: string;
  system?: string;
}

export type AppInputsValidationResult =
  | { valid: true; data: AppInputs; errors: [] }
  | { valid: false; errors: string[] };

// Plain Draft 2020-12 Ajv instance; kept separate from utils/ajvValidation.ts (custom claim keyword) and schema/vendorSchemas.ts (Draft-07 + strict: false for CRD schemas).
const ajv = new Ajv2020({ allErrors: true });
type CompiledAppInputsValidator = ReturnType<Ajv2020['compile']>;
const validatorCache = new Map<string, CompiledAppInputsValidator>();

export function appInputsSchemaDir(root: string): string {
  return join(root, 'schemas');
}

function getAppInputsValidator(schemasDir: string): CompiledAppInputsValidator {
  const cached = validatorCache.get(schemasDir);
  if (cached) return cached;

  const schemaPath = join(schemasDir, 'AppInputs.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const compiled = ajv.compile<AppInputs>(schema);
  validatorCache.set(schemasDir, compiled);
  return compiled;
}

export function validateAppInputs(
  data: unknown,
  schemasDir: string,
): AppInputsValidationResult {
  const validate = getAppInputsValidator(schemasDir);
  if (validate(data)) {
    return { valid: true, data: data as AppInputs, errors: [] };
  }
  return { valid: false, errors: formatAjvErrors(validate.errors) };
}

export function parseAppInputsYaml(
  yamlContent: string,
  schemasDir: string,
): AppInputsValidationResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlContent);
  } catch (err) {
    return {
      valid: false,
      errors: [`YAML parse error: ${(err as Error).message}`],
    };
  }
  return validateAppInputs(parsed, schemasDir);
}

export async function loadAppInputsFile(
  filePath: string,
  schemasDir: string,
): Promise<AppInputsValidationResult> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (err) {
    return {
      valid: false,
      errors: [
        `Unable to read inputs file ${filePath}: ${(err as Error).message}`,
      ],
    };
  }
  return parseAppInputsYaml(content, schemasDir);
}
