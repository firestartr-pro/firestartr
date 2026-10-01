import Ajv2020 from 'ajv/dist/2020.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

const ajv = new Ajv2020({ allErrors: true });
ajv.addKeyword({ keyword: 'x-fs-forge-icon', schemaType: 'object' });
ajv.addKeyword({ keyword: 'x-fs-forge-summary', schemaType: 'string' });

type UniqueItemPropertyValidator = {
  (propertyName: string, data: unknown): boolean;
  errors?: Array<{
    keyword: string;
    message: string;
    params: Record<string, unknown>;
  }>;
};

const uniqueItemPropertyValidator: UniqueItemPropertyValidator = (
  propertyName,
  data,
) => {
  if (!Array.isArray(data)) {
    uniqueItemPropertyValidator.errors = [];
    return true;
  }

  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;

    const value = (item as Record<string, unknown>)[propertyName];
    if (typeof value !== 'string') continue;

    if (seen.has(value)) {
      uniqueItemPropertyValidator.errors = [
        {
          keyword: 'x-fs-forge-unique-item-property',
          message: `must not contain duplicate ${propertyName} values`,
          params: { propertyName, duplicateValue: value },
        },
      ];
      return false;
    }

    seen.add(value);
  }

  uniqueItemPropertyValidator.errors = [];
  return true;
};

ajv.addKeyword({
  keyword: 'x-fs-forge-unique-item-property',
  schemaType: 'string',
  type: 'array',
  errors: true,
  validate: uniqueItemPropertyValidator,
});

const validators = new Map<string, ReturnType<Ajv2020['compile']>>();

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

let schemasDir: string | undefined;

export function setSchemasDir(dir: string): void {
  schemasDir = dir;
}

export async function getValidator(
  kind: string,
): Promise<ReturnType<Ajv2020['compile']> | null> {
  const cached = validators.get(kind);
  if (cached) return cached;

  try {
    if (!schemasDir) return null;
    const schemaPath = join(schemasDir, `${kind}.json`);
    const schemaJson = await readFile(schemaPath, 'utf8');
    const schema = JSON.parse(schemaJson);
    const validate = ajv.compile(schema);
    validators.set(kind, validate);
    return validate;
  } catch (err) {
    console.error(`Failed to load schema for ${kind}:`, err);
    return null;
  }
}

export async function validateClaim(
  claim: Record<string, unknown>,
  kind: string,
): Promise<ValidationResult> {
  const validate = await getValidator(kind);
  if (!validate) {
    return {
      valid: false,
      errors: [`No schema found for claim kind: ${kind}`],
    };
  }

  const valid = validate(claim) as boolean;

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map((err) =>
    `${err.instancePath} ${err.message}`.trim(),
  );

  return { valid: false, errors };
}

export function registerValidator(
  kind: string,
  schema: Record<string, unknown>,
): void {
  const validate = ajv.compile(schema);
  validators.set(kind, validate);
}
