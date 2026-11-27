import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

interface VendorSchemaEntry {
  name: string;
  output: string;
  format: 'crd-openapi' | 'json';
  ref: string;
  url: string;
}

interface VendorManifest {
  schemas: VendorSchemaEntry[];
}

interface CrdVersion {
  name?: string;
  storage?: boolean;
  schema?: {
    openAPIV3Schema?: Record<string, unknown>;
  };
}

interface CrdDocument {
  spec?: {
    versions?: CrdVersion[];
  };
}

// Safe because this script is only executed directly via tsx, never imported by Jest's CJS transform.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VENDOR_DIR = join(PACKAGE_ROOT, 'schemas', 'vendor');
const MANIFEST_PATH = join(VENDOR_DIR, 'manifest.json');

function extractCrdOpenApiSchema(
  yamlText: string,
  name: string,
): Record<string, unknown> {
  const doc = YAML.parse(yamlText) as CrdDocument | null;
  const versions = doc?.spec?.versions;
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error(`CRD ${name} has no spec.versions`);
  }
  const selected = versions.find((v) => v.storage) ?? versions[0];
  const schema = selected?.schema?.openAPIV3Schema;
  if (!schema || typeof schema !== 'object') {
    throw new Error(`CRD ${name} has no schema.openAPIV3Schema`);
  }
  return schema;
}

async function fetchSchema(entry: VendorSchemaEntry): Promise<unknown> {
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${entry.name} (${entry.url}): ${response.status} ${response.statusText}`,
    );
  }
  const text = await response.text();
  if (entry.format === 'crd-openapi') {
    return extractCrdOpenApiSchema(text, entry.name);
  }
  return JSON.parse(text) as unknown;
}

async function main(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, 'utf8'),
  ) as VendorManifest;

  for (const entry of manifest.schemas) {
    const schema = await fetchSchema(entry);
    const outPath = join(VENDOR_DIR, entry.output);
    await writeFile(outPath, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
    console.log(`Updated ${entry.output} (${entry.ref})`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
