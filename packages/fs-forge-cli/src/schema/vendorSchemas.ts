import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { join } from 'path';

export const VENDOR_SCHEMA_FILES = {
  'argocd-applicationset': 'argocd-applicationset.schema.json',
  'argocd-appproject': 'argocd-appproject.schema.json',
} as const;

export type VendorSchemaName = keyof typeof VENDOR_SCHEMA_FILES;

export type VendorValidator = ReturnType<Ajv['compile']>;

// Draft-07 Ajv with strict: false for CRD x-kubernetes-*/nullable keywords; kept separate from schema/appInputs.ts (plain Draft 2020-12) and utils/ajvValidation.ts (custom claim keyword).
const ajv = new Ajv({ allErrors: true, strict: false });

// Register formats used by the vendored Kubernetes/ArgoCD CRD schemas so Ajv
// does not emit `unknown format "..." ignored` warnings to stderr while
// preserving full type validation (e.g. integer fields still reject strings).
ajv.addFormat('int32', {
  type: 'number',
  validate: (n: number) =>
    Number.isInteger(n) && n >= -2147483648 && n <= 2147483647,
});
ajv.addFormat('int64', {
  type: 'number',
  validate: (n: number) => Number.isInteger(n),
});
ajv.addFormat('date-time', true);

const compiledByDir = new Map<string, Map<VendorSchemaName, VendorValidator>>();

export function vendorSchemasDir(root: string): string {
  return join(root, 'schemas', 'vendor');
}

export function loadVendorValidator(
  name: VendorSchemaName,
  vendorDir: string,
): VendorValidator {
  let dirCache = compiledByDir.get(vendorDir);
  if (!dirCache) {
    dirCache = new Map<VendorSchemaName, VendorValidator>();
    compiledByDir.set(vendorDir, dirCache);
  }

  const cached = dirCache.get(name);
  if (cached) return cached;

  const filePath = join(vendorDir, VENDOR_SCHEMA_FILES[name]);
  const schema = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
    string,
    unknown
  >;
  const validator = ajv.compile(schema);
  dirCache.set(name, validator);
  return validator;
}
