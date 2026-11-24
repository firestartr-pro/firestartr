import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { join } from 'path';

export const VENDOR_SCHEMA_FILES = {
  'argocd-applicationset': 'argocd-applicationset.schema.json',
  'argocd-appproject': 'argocd-appproject.schema.json',
  'build-images': 'build-images.schema.json',
} as const;

export type VendorSchemaName = keyof typeof VENDOR_SCHEMA_FILES;

export type VendorValidator = ReturnType<Ajv['compile']>;

// OpenAPI v3 CRD schemas include Kubernetes extension keywords (x-kubernetes-*)
// and nullable, so strict mode is disabled.
const ajv = new Ajv({ allErrors: true, strict: false });

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
