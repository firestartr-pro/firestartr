import { isRecord } from './isRecord.js';

export type FlagType = 'string' | 'number' | 'boolean';

export interface FlagSpec {
  path: string;
  type: FlagType;
  required: boolean;
  conditionalRequired?: boolean;
  description?: string;
  enumValues?: string[];
  defaultValue?: unknown;
  conditionalDefault?: boolean;
  multiple: boolean;
  integer?: boolean;
  char?: string;
}

export interface VariantGroup {
  discriminatorPath: string;
  variants: Record<string, string[]>;
}

function branches(
  schema: Record<string, unknown>,
  keyword: 'allOf' | 'oneOf' | 'anyOf',
): Record<string, unknown>[] {
  const value = schema[keyword];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function requiredNames(schema: Record<string, unknown>): Set<string> {
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  for (const branch of branches(schema, 'allOf')) {
    for (const name of requiredNames(branch)) required.add(name);
  }
  return required;
}

function properties(
  schema: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  if (isRecord(schema.properties)) {
    for (const [name, value] of Object.entries(schema.properties)) {
      if (isRecord(value)) result[name] = value;
    }
  }
  for (const branch of branches(schema, 'allOf')) {
    Object.assign(result, properties(branch));
  }
  return result;
}

function addFlag(flags: FlagSpec[], flag: FlagSpec): void {
  const existing = flags.find(({ path }) => path === flag.path);
  if (!existing) {
    flags.push(flag);
    return;
  }
  existing.required ||= flag.required;
  existing.conditionalRequired ||=
    flag.conditionalRequired && !existing.required;
  existing.description ??= flag.description;
  existing.enumValues ??= flag.enumValues;
  existing.defaultValue ??= flag.defaultValue;
  existing.conditionalDefault ||= flag.conditionalDefault;
  existing.integer ??= flag.integer;
}

function jsonFlag(
  path: string,
  description: string | undefined,
  required: boolean,
  conditionalRequired = false,
): FlagSpec {
  return {
    path: `${path}.json`,
    type: 'string',
    required,
    conditionalRequired: conditionalRequired || undefined,
    description: description ?? `Raw JSON value for ${path}`,
    multiple: false,
  };
}

function walk(
  schema: Record<string, unknown>,
  prefix: string,
  parentRequired: boolean,
): FlagSpec[] {
  const flags: FlagSpec[] = [];

  const union = [...branches(schema, 'oneOf'), ...branches(schema, 'anyOf')];
  if (union.length > 0) {
    for (const branch of union) {
      for (const flag of walk(branch, prefix, false)) {
        flag.required = false;
        addFlag(flags, flag);
      }
    }
    if (prefix) {
      addFlag(
        flags,
        jsonFlag(
          prefix,
          `Raw JSON value for ${prefix} (escape hatch for union types)`,
          false,
        ),
      );
    }
  }

  const ownSchema = { ...schema };
  delete ownSchema.allOf;
  delete ownSchema.oneOf;
  delete ownSchema.anyOf;
  const ownProperties = isRecord(ownSchema.properties)
    ? (ownSchema.properties as Record<string, unknown>)
    : {};
  const required = new Set(
    Array.isArray(ownSchema.required) ? (ownSchema.required as string[]) : [],
  );

  for (const [key, value] of Object.entries(ownProperties)) {
    if (!isRecord(value)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const unconditionallyRequired = parentRequired && required.has(key);
    const conditionallyRequired = required.has(key) && !unconditionallyRequired;

    if (value.$ref) continue;

    const valueUnion =
      branches(value, 'oneOf').length + branches(value, 'anyOf').length > 0;
    const valueAllOf = branches(value, 'allOf').length > 0;
    const valueProperties = properties(value);
    const isObject =
      value.type === 'object' ||
      valueAllOf ||
      valueUnion ||
      Object.keys(valueProperties).length > 0;

    if (value.type === 'array') {
      const items = isRecord(value.items) ? value.items : undefined;
      if (
        items &&
        typeof items.type === 'string' &&
        ['string', 'number', 'boolean', 'integer'].includes(items.type)
      ) {
        addFlag(flags, {
          path,
          type: items.type === 'integer' ? 'number' : (items.type as FlagType),
          required: unconditionallyRequired,
          conditionalRequired: conditionallyRequired || undefined,
          description: value.description as string | undefined,
          enumValues: items.enum as string[] | undefined,
          defaultValue: value.default,
          conditionalDefault:
            value.default === undefined || parentRequired ? undefined : true,
          multiple: true,
          integer: items.type === 'integer' || undefined,
        });
      } else {
        addFlag(
          flags,
          jsonFlag(
            path,
            `Raw JSON value for ${path} (escape hatch for complex arrays)`,
            unconditionallyRequired,
            conditionallyRequired,
          ),
        );
      }
      continue;
    }

    if (isObject) {
      for (const flag of walk(value, path, unconditionallyRequired)) {
        addFlag(flags, flag);
      }
      if (
        value.additionalProperties === true ||
        isRecord(value.additionalProperties) ||
        isRecord(value.patternProperties)
      ) {
        addFlag(
          flags,
          jsonFlag(
            path,
            `Raw JSON object for ${path}`,
            unconditionallyRequired && requiredNames(value).size === 0,
            conditionallyRequired && requiredNames(value).size === 0,
          ),
        );
      }
      continue;
    }

    if (
      typeof value.type === 'string' &&
      ['string', 'number', 'boolean', 'integer'].includes(value.type)
    ) {
      addFlag(flags, {
        path,
        type: value.type === 'integer' ? 'number' : (value.type as FlagType),
        required: unconditionallyRequired,
        conditionalRequired: conditionallyRequired || undefined,
        description: value.description as string | undefined,
        enumValues: value.enum as string[] | undefined,
        defaultValue: value.default,
        conditionalDefault:
          value.default === undefined || parentRequired ? undefined : true,
        multiple: false,
        integer: value.type === 'integer' || undefined,
      });
    }
  }

  for (const branch of branches(schema, 'allOf')) {
    for (const flag of walk(branch, prefix, parentRequired)) {
      addFlag(flags, flag);
    }
  }

  return flags;
}

export function deriveFlags(
  schema: Record<string, unknown>,
  prefix = '',
): FlagSpec[] {
  if (!isRecord(schema)) return [];
  return walk(schema, prefix, true);
}

function acceptsEmptyObject(schema: Record<string, unknown>): boolean {
  if (requiredNames(schema).size > 0) return false;
  const oneOf = branches(schema, 'oneOf');
  const anyOf = branches(schema, 'anyOf');
  if (oneOf.length > 0 && oneOf.filter(acceptsEmptyObject).length !== 1) {
    return false;
  }
  if (anyOf.length > 0 && !anyOf.some(acceptsEmptyObject)) return false;
  return true;
}

export function deriveRequiredContainers(
  schema: Record<string, unknown>,
  prefix = '',
  parentRequired = true,
): string[] {
  if (!isRecord(schema)) return [];
  const result: string[] = [];
  const required = requiredNames(schema);
  for (const [key, child] of Object.entries(properties(schema))) {
    const path = prefix ? `${prefix}.${key}` : key;
    const childRequired = parentRequired && required.has(key);
    const isObject =
      child.type === 'object' ||
      branches(child, 'allOf').length > 0 ||
      Object.keys(properties(child)).length > 0;
    if (!isObject) continue;
    if (childRequired && acceptsEmptyObject(child)) result.push(path);
    result.push(...deriveRequiredContainers(child, path, childRequired));
  }
  return [...new Set(result)];
}

export function deriveVariantGroups(
  schema: Record<string, unknown>,
  prefix = '',
): VariantGroup[] {
  const groups: VariantGroup[] = [];
  const union = (schema.oneOf ?? schema.anyOf) as
    | Record<string, unknown>[]
    | undefined;

  if (Array.isArray(union) && union.length > 1) {
    const branchProperties = union.map((branch) =>
      isRecord(branch.properties)
        ? (branch.properties as Record<string, Record<string, unknown>>)
        : {},
    );
    const discriminator = Object.keys(branchProperties[0]).find((key) =>
      branchProperties.every(
        (properties) => properties[key]?.const !== undefined,
      ),
    );

    if (discriminator) {
      const discriminatorPath = prefix
        ? `${prefix}.${discriminator}`
        : discriminator;
      const variants: Record<string, string[]> = {};
      const branchPaths = union.map((branch) =>
        deriveFlags(branch, prefix).map((flag) => flag.path),
      );
      const sharedPaths = new Set(
        branchPaths[0].filter((path) =>
          branchPaths.every((paths) => paths.includes(path)),
        ),
      );
      for (let index = 0; index < union.length; index++) {
        const value = branchProperties[index][discriminator].const;
        variants[String(value)] = branchPaths[index].filter(
          (path) => path !== discriminatorPath && !sharedPaths.has(path),
        );
      }
      groups.push({ discriminatorPath, variants });
    }
  }

  for (const [key, value] of Object.entries(properties(schema))) {
    groups.push(
      ...deriveVariantGroups(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    for (const branch of branches(schema, keyword)) {
      groups.push(...deriveVariantGroups(branch, prefix));
    }
  }

  return groups.filter(
    (group, index) =>
      groups.findIndex(
        (candidate) => candidate.discriminatorPath === group.discriminatorPath,
      ) === index,
  );
}
