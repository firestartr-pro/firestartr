import fs from 'fs';

import Ajv from 'ajv/dist/2020';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import YAML from 'yaml';

import schemas from '../claims/base/schemas';

interface MessageOnlyValidationError {
  message?: string;
  [key: string]: unknown;
}

export type ValidationError = ErrorObject | MessageOnlyValidationError;

export interface ValidationResult {
  valid: boolean;
  claimType: string;
  errors: ValidationError[];
  message: string;
}

export interface ValidateOptions {
  claimPath: string;
  schemaType?: string;
}

type ClaimDocument = {
  kind?: unknown;
  [key: string]: unknown;
};

let ajvInstance: Ajv | null = null;

function flattenSchemas(schemaEntries: unknown[]): AnySchema[] {
  return schemaEntries.flat(Number.POSITIVE_INFINITY) as AnySchema[];
}

function getAjv(): Ajv {
  if (ajvInstance) return ajvInstance;

  ajvInstance = new Ajv({ useDefaults: true });
  ajvInstance.addSchema(flattenSchemas(schemas.schemas as unknown[]));

  return ajvInstance;
}

function parseClaim(claimContent: string): ClaimDocument {
  const parsedClaim = claimContent.trim().startsWith('{')
    ? JSON.parse(claimContent)
    : YAML.parse(claimContent);

  if (
    !parsedClaim ||
    typeof parsedClaim !== 'object' ||
    Array.isArray(parsedClaim)
  ) {
    throw new Error('Claim must be a YAML or JSON object');
  }

  return parsedClaim as ClaimDocument;
}

function normalizeSchemaId(schemaType: string): string {
  return schemaType.startsWith('firestartr.dev://')
    ? schemaType
    : `firestartr.dev://common/${schemaType}`;
}

function claimTypeFromSchemaId(schemaId: string): string {
  return schemaId.substring(schemaId.lastIndexOf('/') + 1);
}

function getValidationErrors(error: unknown): ValidationError[] {
  if (Array.isArray(error)) return error as ValidationError[];

  if (error instanceof Error) return [{ message: error.message }];

  return [{ message: String(error) }];
}

export async function validateClaimAgainstSchema(
  options: ValidateOptions,
): Promise<ValidationResult> {
  const { claimPath, schemaType } = options;

  if (!fs.existsSync(claimPath)) {
    return {
      valid: false,
      claimType: 'unknown',
      errors: [{ message: `Claim file not found: ${claimPath}` }],
      message: `Claim file not found: ${claimPath}`,
    };
  }

  let claim: ClaimDocument;

  try {
    claim = parseClaim(fs.readFileSync(claimPath, 'utf-8'));
  } catch (error: unknown) {
    return {
      valid: false,
      claimType: 'unknown',
      errors: getValidationErrors(error),
      message: 'Invalid YAML or JSON format',
    };
  }

  const detectedType =
    schemaType ?? (typeof claim.kind === 'string' ? claim.kind : undefined);

  if (!detectedType) {
    return {
      valid: false,
      claimType: 'unknown',
      errors: [{ message: 'Claim kind is required to select a schema' }],
      message: 'Claim kind is required to select a schema',
    };
  }

  const schemaId = normalizeSchemaId(detectedType);
  const claimType = claimTypeFromSchemaId(schemaId);
  let validate: ValidateFunction | undefined;

  try {
    validate = getAjv().getSchema(schemaId);
  } catch (error: unknown) {
    const errors = getValidationErrors(error);

    return {
      valid: false,
      claimType,
      errors,
      message: `Schema lookup failed with ${errors.length} error(s)`,
    };
  }

  if (!validate) {
    return {
      valid: false,
      claimType,
      errors: [{ message: `No schema found for type: ${detectedType}` }],
      message: `No schema found for type: ${detectedType}`,
    };
  }

  const isValid = validate(claim);

  if (isValid) {
    return {
      valid: true,
      claimType,
      errors: [],
      message: 'Claim is valid',
    };
  }

  const errors = validate.errors ?? [];

  return {
    valid: false,
    claimType,
    errors,
    message: `Claim is invalid with ${errors.length} error(s)`,
  };
}

async function runCli() {
  const [claimPath, schemaType] = process.argv.slice(2);

  if (!claimPath) {
    console.error(
      'Usage: ts-node validate-claim-against-schema.ts <claim-file> [schemaType]',
    );
    process.exit(1);
  }

  try {
    const result = await validateClaimAgainstSchema({ claimPath, schemaType });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.valid ? 0 : 1);
  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

if (process.argv[1]?.match(/validate-claim-against-schema\.[jt]s$/)) {
  void runCli();
}
