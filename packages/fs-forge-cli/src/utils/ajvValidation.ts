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
    const schemaJson = await readFile(join(schemasDir, `${kind}.json`), 'utf8');
    const validate = ajv.compile(JSON.parse(schemaJson));
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

      const errors = (validate.errors ?? []).map((err) =>
        `${err.instancePath} ${err.message}`.trim(),
      );
      return { valid: false, errors };
    },
  };
}
