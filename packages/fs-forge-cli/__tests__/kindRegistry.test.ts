import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';

import {
  CLAIM_KIND_OPTIONS,
  CLAIM_PATH_CAPABILITIES,
  KIND_CAPABILITIES,
  KIND_REGISTRY,
  isClaimKind,
  kindById,
  normalizeKind,
  resolveClaimReference,
} from '../src/claims/kindRegistry';
import { PREFLIGHT_KINDS } from '../src/commands/preflight';

const ROOT = process.cwd();

type Schema = Record<string, unknown>;

/** A property pattern that names claim kinds: `^(user|group):…`, `^system:…`. */
const CLAIM_REFERENCE_PATTERN = /^\^(\(([a-z]+(\|[a-z]+)*)\)|[a-z]+):/;

function isRecord(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Properties of a schema node, merged across its `allOf`/`oneOf`/`anyOf` branches. */
function schemaProperties(node: Schema): Record<string, Schema> {
  const properties: Record<string, Schema> = {};
  const collect = (schema: Schema): void => {
    for (const [name, value] of Object.entries(
      isRecord(schema.properties) ? schema.properties : {},
    )) {
      if (isRecord(value)) properties[name] = value;
    }
    for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
      const branches = schema[keyword];
      if (!Array.isArray(branches)) continue;
      for (const branch of branches) if (isRecord(branch)) collect(branch);
    }
  };
  collect(node);
  return properties;
}

function schemaProperty(node: Schema, path: string): Schema | undefined {
  let current: Schema | undefined = node;
  for (const segment of path.split('.')) {
    if (!current) return undefined;
    current = schemaProperties(current)[segment];
  }
  return current;
}

/** Every dotted path of a property literally named `org` in the schema. */
function orgPaths(node: Schema): string[] {
  const paths: string[] = [];
  for (const [name, value] of Object.entries(schemaProperties(node))) {
    if (name === 'org') paths.push('org');
    for (const nested of orgPaths(value)) paths.push(`${name}.${nested}`);
  }
  return paths;
}

function loadSchema(kind: string): Schema {
  return JSON.parse(
    readFileSync(join(ROOT, 'schemas', `${kind}.json`), 'utf8'),
  ) as Schema;
}

async function schemaKindOrder(): Promise<string[]> {
  return (await readdir(join(ROOT, 'schemas')))
    .filter((file) => file.endsWith('Claim.json'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

describe('kind registry', () => {
  it('classifies every kind with generated metadata and CLI capabilities', async () => {
    expect(KIND_CAPABILITIES.map(({ kind }) => kind)).toEqual(
      await schemaKindOrder(),
    );

    for (const capability of KIND_CAPABILITIES) {
      expect(capability.id).not.toBe('');
      expect(capability.summary).not.toBe('');
      expect(capability.icon.emoji).not.toBe('');
      expect(capability.icon.ascii).not.toBe('');
      expect(KIND_REGISTRY[capability.kind]).toEqual(capability);

      expect(capability.claimsDirectory === null).toBe(
        CLAIM_PATH_CAPABILITIES[capability.kind].requiresExplicitPath,
      );
    }
  });

  it('keeps the claim path capabilities unchanged', () => {
    expect(CLAIM_PATH_CAPABILITIES).toEqual({
      ComponentClaim: { directory: 'components', requiresExplicitPath: false },
      GroupClaim: { directory: 'groups', requiresExplicitPath: false },
      UserClaim: { directory: 'users', requiresExplicitPath: false },
      SystemClaim: { directory: 'systems', requiresExplicitPath: false },
      DomainClaim: { directory: 'domains', requiresExplicitPath: false },
      OrgWebhookClaim: { directory: 'orgWebhook', requiresExplicitPath: false },
      OrgSettingsClaim: { directory: 'orgSettings', requiresExplicitPath: false },
      ArgoDeployClaim: { directory: 'argocd', requiresExplicitPath: false },
      TFWorkspaceClaim: { requiresExplicitPath: true },
      SecretsClaim: { requiresExplicitPath: true },
    });
  });

  it('classifies the catalog-only and preflight kinds', () => {
    expect(
      KIND_CAPABILITIES.filter(({ catalogOnly }) => catalogOnly).map(
        ({ kind }) => kind,
      ),
    ).toEqual(['DomainClaim', 'SystemClaim']);
    expect(PREFLIGHT_KINDS).toEqual({
      repo: 'ComponentClaim',
      team: 'GroupClaim',
      user: 'UserClaim',
      tfworkspace: 'TFWorkspaceClaim',
    });
    expect(Object.keys(PREFLIGHT_KINDS)).toEqual([
      'repo',
      'team',
      'user',
      'tfworkspace',
    ]);
  });

  it('offers the short id and the full kind as --kind options', () => {
    expect(CLAIM_KIND_OPTIONS).toEqual(
      KIND_CAPABILITIES.flatMap(({ id, kind }) => [id, kind]),
    );
    expect(CLAIM_KIND_OPTIONS.slice(0, 4)).toEqual([
      'argodeploy',
      'ArgoDeployClaim',
      'component',
      'ComponentClaim',
    ]);
  });

  it('normalises short ids and full kind names, and resolves only full references', () => {
    expect(normalizeKind('component')).toBe('ComponentClaim');
    expect(normalizeKind('ComponentClaim')).toBe('ComponentClaim');
    expect(normalizeKind('COMPONENTCLAIM')).toBe('ComponentClaim');
    expect(normalizeKind('nope')).toBeUndefined();

    expect(kindById('component')?.kind).toBe('ComponentClaim');
    expect(kindById('ComponentClaim')).toBeUndefined();
    expect(kindById('COMPONENT')?.kind).toBe('ComponentClaim');
    expect(kindById('ComponentClaim')).toBeUndefined();

    expect(isClaimKind('ComponentClaim')).toBe(true);
    expect(isClaimKind('component')).toBe(false);
    expect(isClaimKind('constructor')).toBe(false);
    expect(isClaimKind('toString')).toBe(false);

    expect(resolveClaimReference('ComponentClaim-api')).toEqual({
      kind: 'ComponentClaim',
      name: 'api',
    });
    expect(resolveClaimReference('ComponentClaim-my-service')).toEqual({
      kind: 'ComponentClaim',
      name: 'my-service',
    });
    expect(resolveClaimReference('component-api')).toBeUndefined();
    expect(resolveClaimReference('constructor-api')).toBeUndefined();
    expect(resolveClaimReference('-api')).toBeUndefined();
    expect(resolveClaimReference('ComponentClaim-')).toBeUndefined();
    expect(resolveClaimReference('foo-bar')).toBeUndefined();
  });
});

describe('kind capabilities against the claim schemas', () => {
  it('names the org field the kind schema declares, and none other', () => {
    for (const capability of KIND_CAPABILITIES) {
      const declared = orgPaths(loadSchema(capability.kind));

      expect(declared).toEqual(
        capability.orgField === null ? [] : [capability.orgField],
      );
    }
  });

  it('lists reference fields that exist in the kind schema, and no others', () => {
    for (const capability of KIND_CAPABILITIES) {
      const schema = loadSchema(capability.kind);
      const fields = capability.references.map((reference) =>
        reference.replace(/\[\]$/, ''),
      );

      for (const [index, reference] of capability.references.entries()) {
        const property = schemaProperty(schema, fields[index]!);
        expect(property).toBeDefined();
        if (reference.endsWith('[]')) {
          expect(property?.type).toBe('array');
        }
      }
      expect(new Set(fields).size).toBe(fields.length);

      const patterned = Object.entries(schemaProperties(schema))
        .filter(
          ([, value]) =>
            typeof value.pattern === 'string' &&
            CLAIM_REFERENCE_PATTERN.test(value.pattern),
        )
        .map(([name]) => name);
      expect(patterned.filter((name) => !fields.includes(name))).toEqual([]);
    }
  });

  it('derives the --path requirement from the claims directory', () => {
    expect(
      KIND_CAPABILITIES.filter(({ requiresPath }) => requiresPath).map(
        ({ kind }) => kind,
      ),
    ).toEqual(['SecretsClaim', 'TFWorkspaceClaim']);

    for (const capability of KIND_CAPABILITIES) {
      expect(capability.requiresPath).toBe(capability.claimsDirectory === null);
      if (capability.claimsDirectory !== null) {
        expect(
          schemaProperty(loadSchema(capability.kind), 'name'),
        ).toBeDefined();
      }
    }
  });

  it('hydrates, deletes and stores state with the workflow a claims repo dispatches', () => {
    const expected: Record<
      string,
      {
        hydration: string | null;
        inputs?: string[];
        deletion: string | null;
        stateRepo: string | null;
      }
    > = {
      ArgoDeployClaim: {
        hydration: null,
        deletion: null,
        stateRepo: null,
      },
      ComponentClaim: {
        hydration: 'hydrate-github-claim.yaml',
        inputs: ['kind', 'name'],
        deletion: 'delete-github-claim.yaml',
        stateRepo: 'state-github',
      },
      DomainClaim: {
        hydration: null,
        deletion: null,
        stateRepo: null,
      },
      GroupClaim: {
        hydration: 'hydrate-github-claim.yaml',
        inputs: ['kind', 'name'],
        deletion: 'delete-github-claim.yaml',
        stateRepo: 'state-github',
      },
      OrgSettingsClaim: {
        hydration: null,
        deletion: null,
        stateRepo: 'state-github',
      },
      OrgWebhookClaim: {
        hydration: 'hydrate-github-claim.yaml',
        inputs: ['kind', 'name'],
        deletion: 'delete-github-claim.yaml',
        stateRepo: 'state-github',
      },
      SecretsClaim: {
        hydration: 'hydrate-secrets-claim.yaml',
        inputs: ['name'],
        deletion: 'delete-secrets-claim.yaml',
        stateRepo: 'state-infra',
      },
      SystemClaim: {
        hydration: null,
        deletion: null,
        stateRepo: null,
      },
      TFWorkspaceClaim: {
        hydration: 'hydrate-tfworkspace-claim.yaml',
        inputs: ['name'],
        deletion: 'delete-tfworkspace-claim.yaml',
        stateRepo: 'state-infra',
      },
      UserClaim: {
        hydration: 'hydrate-github-claim.yaml',
        inputs: ['kind', 'name'],
        deletion: 'delete-github-claim.yaml',
        stateRepo: 'state-github',
      },
    };

    for (const capability of KIND_CAPABILITIES) {
      const wanted = expected[capability.kind]!;

      expect(capability.hydration?.workflow ?? null).toBe(wanted.hydration);
      expect(capability.hydration?.inputs ?? []).toEqual(wanted.inputs ?? []);
      expect(capability.hydration?.key ?? 'name').toBe('name');
      expect(capability.delete.workflow).toBe(wanted.deletion);
      expect(capability.delete.supported).toBe(wanted.deletion !== null);
      expect(capability.stateRepo).toBe(wanted.stateRepo);
    }
  });

  it('marks only TFWorkspaceClaim as variant-capable', () => {
    expect(
      KIND_CAPABILITIES.filter(({ variants }) => variants).map(
        ({ kind }) => kind,
      ),
    ).toEqual(['TFWorkspaceClaim']);
  });
});
