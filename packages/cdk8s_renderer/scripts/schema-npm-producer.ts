#!/usr/bin/env tsx

// ---- CLI Argument Parsing ----
const args = process.argv.slice(2);
const rawVersion = args[0];

function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(
    version,
  );
}

if (!rawVersion) {
  console.error('Usage: schema-npm-producer.ts <version>');
  process.exit(1);
}
if (!isValidSemver(rawVersion)) {
  console.error(
    `Invalid version "${rawVersion}". Expected a valid SemVer version.`,
  );
  process.exit(1);
}
const version = rawVersion;
console.log(`[cdk8s_renderer:schema-npm-producer] Version: ${version}`);

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import schemasModule from '../src/claims/base/schemas/index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function flattenSchemas(schemas: any[]): any[] {
  const result: any[] = [];
  const stack = [...schemas];
  while (stack.length) {
    const sch = stack.shift();
    if (!sch) continue;
    if (Array.isArray(sch)) {
      stack.push(...sch);
      continue;
    }
    result.push(sch);
  }
  return result;
}
function buildRegistry(schemas: any[]): Map<string, any> {
  const registry = new Map<string, any>();
  for (const sch of schemas) {
    if (sch.$id) registry.set(sch.$id, sch);
    if (sch.definitions) {
      for (const def of Object.values(sch.definitions)) {
        if ((def as any).$id) registry.set((def as any).$id, def);
      }
    }
  }
  return registry;
}

const CLAIM_KINDS: Record<string, string> = {
  ComponentClaim: 'firestartr.dev://common/ComponentClaim',
  GroupClaim: 'firestartr.dev://common/GroupClaim',
  UserClaim: 'firestartr.dev://common/UserClaim',
  SystemClaim: 'firestartr.dev://common/SystemClaim',
  DomainClaim: 'firestartr.dev://common/DomainClaim',
  TFWorkspaceClaim: 'firestartr.dev://common/TFWorkspaceClaim',
  SecretsClaim: 'firestartr.dev://common/SecretsClaim',
  OrgWebhookClaim: 'firestartr.dev://common/OrgWebhookClaim',
  ArgoDeployClaim: 'firestartr.dev://common/ArgoDeployClaim',
};

const GENERATED_PACKAGE_NAME = '@firestartr/firestartr-claims_schemas';

// ---- allOf Merge Utility ----
const MERGEABLE_ALLOF_BRANCH_KEYS = new Set([
  '$id',
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
]);

function isCompatibleAdditionalProperties(
  value: any,
): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function isSimpleMergeableObjectBranch(branch: any): boolean {
  if (
    !branch ||
    typeof branch !== 'object' ||
    branch.type !== 'object' ||
    !branch.properties
  ) {
    return false;
  }

  for (const key of Object.keys(branch)) {
    if (!MERGEABLE_ALLOF_BRANCH_KEYS.has(key)) {
      return false;
    }
  }

  if (branch.required && !Array.isArray(branch.required)) {
    return false;
  }

  if (!isCompatibleAdditionalProperties(branch.additionalProperties)) {
    return false;
  }

  return true;
}

function mergeAllOf(schema: any): any {
  if (!Array.isArray(schema.allOf)) return schema;

  const base: any = { properties: {}, required: [], type: 'object' };
  let canMerge = true;
  let mergedAdditionalProperties: boolean | undefined = undefined;

  for (const branch of schema.allOf) {
    if (!isSimpleMergeableObjectBranch(branch)) {
      canMerge = false;
      break;
    }

    if (branch.additionalProperties !== undefined) {
      if (
        mergedAdditionalProperties !== undefined &&
        mergedAdditionalProperties !== branch.additionalProperties
      ) {
        canMerge = false;
        break;
      }
      mergedAdditionalProperties = branch.additionalProperties;
    }

    Object.assign(base.properties, branch.properties);
    if (branch.required) base.required.push(...branch.required);
  }

  if (canMerge) {
    if (mergedAdditionalProperties !== undefined) {
      base.additionalProperties = mergedAdditionalProperties;
    }

    const cleaned = { ...schema, ...base };
    delete cleaned.allOf;
    // Remove dup required fields
    if (cleaned.required) cleaned.required = [...new Set(cleaned.required)];
    return cleaned;
  }

  return schema;
}

// ---- Deref Helper ----
function derefSchema(
  schema: any,
  registry: Map<string, any>,
  seen = new Set(),
): any {
  if (Array.isArray(schema)) {
    return schema.map((item) => derefSchema(item, registry, seen));
  }
  if (schema && typeof schema === 'object') {
    if (schema.$ref) {
      if (seen.has(schema.$ref)) {
        throw new Error(`Cycle or duplicate in refs: ${schema.$ref}`);
      }
      const target = registry.get(schema.$ref);
      if (!target) throw new Error(`Unresolved $ref: ${schema.$ref}`);
      seen.add(schema.$ref);
      const deref = derefSchema(target, registry, seen);
      seen.delete(schema.$ref);
      return deref;
    }
    const output: any = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === '$schema' || k === '$id') continue; // Strip as per requirements
      output[k] = derefSchema(v, registry, seen);
    }

    return mergeAllOf(output);
  }
  return schema;
}

void (async () => {
  // --- Step 1: Prepare output dir ---
  const pkgdir = await fs.mkdtemp('/tmp/cdk8s-claims-npm-');
  await fs.mkdir(path.join(pkgdir, 'schemas'));
  console.log(
    `[cdk8s_renderer:schema-npm-producer] Created output dir: ${pkgdir}`,
  );

  // --- Step 2: Load, flatten, registry, deref ---
  const schemas = schemasModule.schemas;
  const flatSchemas = flattenSchemas(schemas);
  const registry = buildRegistry(flatSchemas);

  // Step 3: Dereference and write each claim kind
  for (const [claim, $id] of Object.entries(CLAIM_KINDS)) {
    const entry = registry.get($id);
    if (!entry) {
      console.error(`Missing schema for top-level kind ${claim} ($id: ${$id})`);
      process.exit(1);
    }
    console.log(`[write] ${claim}: ${$id}`);
    try {
      const deref = derefSchema(entry, registry);
      await fs.writeFile(
        path.join(pkgdir, 'schemas', `${claim}.json`),
        JSON.stringify(deref, null, 2),
        'utf8',
      );
    } catch (e) {
      console.error(`Failed to dereference/write ${claim}: ${String(e)}`);
      process.exit(1);
    }
  }

  // --- Step 4: Output other package files (README, package.json, index.mjs) ---
  // README
  await fs.writeFile(
    path.join(pkgdir, 'README.md'),
    "# cdk8s-claims-schemas (Generated)\n\nThis package was generated automatically by schema-npm-producer.ts.\nIt contains fully dereferenced JSON schemas for claim types used in Prefapp's cdk8s-renderer, intended for use in downstream tools like react-jsonschema-form.\n",
  );

  // package.json
  await fs.writeFile(
    path.join(pkgdir, 'package.json'),
    JSON.stringify(
      {
        name: GENERATED_PACKAGE_NAME,
        version,
        type: 'module',
        description: 'Fully dereferenced JSON schemas from cdk8s_renderer',
        main: './index.mjs',
        exports: { '.': './index.mjs' },
        devDependencies: { ajv: '^8.0.0' },
        repository: {
          type: 'git',
          url: 'git+https://github.com/firestartr-pro/firestartr.git',
          directory: 'packages/cdk8s_renderer',
        },
        author: 'Firestartr contributors',
        license: 'Apache-2.0',
      },
      null,
      2,
    ),
  );

  const schemaImports = Object.keys(CLAIM_KINDS)
    .map(
      (claimKind) =>
        `import ${claimKind} from './schemas/${claimKind}.json' assert { type: 'json' };`,
    )
    .join('\n');
  const schemaExports = Object.keys(CLAIM_KINDS)
    .map((claimKind) => `  ${claimKind},`)
    .join('\n');
  const allSchemasEntries = Object.keys(CLAIM_KINDS)
    .map((claimKind) => `${claimKind},`)
    .join(' ');

  // index.mjs
  await fs.writeFile(
    path.join(pkgdir, 'index.mjs'),
    `// Auto-generated ESM entrypoint; do not hand-edit\n\n${schemaImports}\n\nexport {\n${schemaExports}\n};\n\nexport const ALL_SCHEMAS = {\n  ${allSchemasEntries}\n};\n`,
  );

  // ---- Step 5: Copy fixture and generate test file ---
  // Copy and convert group_a.yaml fixture
  const { parse } = await import('yaml');
  const fixtureSrc = path.resolve(
    __dirname,
    '../__tests__/fixtures/base_claims/groups/group_a.yaml',
  );
  const fixtureYaml = await fs.readFile(fixtureSrc, 'utf8');
  const fixtureJson = parse(fixtureYaml);

  await fs.writeFile(
    path.join(pkgdir, 'group_a.fixture.json'),
    JSON.stringify(fixtureJson, null, 2),
    'utf8',
  );

  // Write test file
  await fs.writeFile(
    path.join(pkgdir, 'smoke.test.js'),
    `import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import Ajv2020 from 'ajv/dist/2020.js';

const GroupClaim = require('./schemas/GroupClaim.json');
const fixture = require('./group_a.fixture.json');

const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(GroupClaim);
const valid = validate(fixture);
if (!valid) {
  console.error(validate.errors);
  process.exit(1);
} else {
  console.log('Fixture validated successfully.');
}
`,
  );

  // Inform user
  console.log(
    `[cdk8s_renderer:schema-npm-producer] Wrote schemas, package.json, README, index.mjs, test, and fixture in: ${pkgdir}`,
  );
  console.log(
    '[cdk8s_renderer:schema-npm-producer] DONE. You may inspect or publish manually or run the smoke test.',
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
