import type { ErrorObject } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';

import { loadClaimSchema } from '../schema/claimSchemas.js';

// Draft 2020-12 Ajv with custom x-fs-forge-unique-item-property claim keyword; kept separate from schema/appInputs.ts (plain Draft 2020-12) and schema/vendorSchemas.ts (Draft-07 + strict: false).
const ajv = new Ajv2020({ allErrors: true });

export function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
): string[] {
  return (errors ?? []).map((err) => {
    const path = err.instancePath || '/';
    const extra =
      err.keyword === 'additionalProperties' &&
      typeof err.params?.additionalProperty === 'string'
        ? ` (${err.params.additionalProperty})`
        : '';
    return `${path} ${err.message ?? 'is invalid'}${extra}`.trim();
  });
}

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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ClaimValidator {
  validate(
    claim: Record<string, unknown>,
    kind: string,
  ): Promise<ValidationResult>;
}

export interface ClaimValidatorOptions {
  /** Directory holding `<Kind>.json` claim schemas. */
  schemasDir: string;
}

type CompiledValidator = ReturnType<Ajv2020['compile']>;

// Compiled validators are pure functions of the schema file, so they are
// shared per schemas directory across registries.
const compiledByDirectory = new Map<string, Map<string, CompiledValidator>>();

async function loadValidator(
  schemasDir: string,
  cache: Map<string, CompiledValidator>,
  kind: string,
): Promise<CompiledValidator | null> {
  const cached = cache.get(kind);
  if (cached) return cached;

  try {
    const validate = ajv.compile(loadClaimSchema(schemasDir, kind));
    cache.set(kind, validate);
    return validate;
  } catch (err) {
    console.error(`Failed to load schema for ${kind}:`, err);
    return null;
  }
}

/**
 * Claim-schema registry: validation is scoped to a schemas directory instead
 * of module-global state, so it needs no ordering between setup and use.
 */
export function createClaimValidator(
  options: ClaimValidatorOptions,
): ClaimValidator {
  const { schemasDir } = options;
  const cache =
    compiledByDirectory.get(schemasDir) ?? new Map<string, CompiledValidator>();
  compiledByDirectory.set(schemasDir, cache);

  return {
    async validate(claim, kind) {
      const validate = await loadValidator(schemasDir, cache, kind);
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

      return { valid: false, errors: formatAjvErrors(validate.errors) };
    },
  };
}
