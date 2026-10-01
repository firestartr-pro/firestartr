import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  deriveFlags,
  deriveRequiredContainers,
  deriveVariantGroups,
} from '../src/utils/deriveFlags';
import type { FlagSpec } from '../src/utils/deriveFlags';

function claimSchema(kind: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'schemas', `${kind}.json`), 'utf8'),
  ) as Record<string, unknown>;
}

function names(flags: FlagSpec[]): string[] {
  return flags.map((f) => f.path).sort();
}

describe('deriveFlags', () => {
  it('returns empty array for empty schema', () => {
    expect(deriveFlags({})).toEqual([]);
  });

  it('returns empty array for null schema', () => {
    expect(deriveFlags(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('derives string and boolean flags from flat properties', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        active: { type: 'boolean' },
        count: { type: 'integer' },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(3);
    expect(names(flags)).toEqual(['active', 'count', 'name']);

    const nameFlag = flags.find((f) => f.path === 'name')!;
    expect(nameFlag.type).toBe('string');
    expect(nameFlag.required).toBe(false);
    expect(nameFlag.multiple).toBe(false);

    const countFlag = flags.find((f) => f.path === 'count')!;
    expect(countFlag.type).toBe('number');
  });

  it('marks required flags based on schema.required array', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string' },
      },
      required: ['name'],
    };

    const flags = deriveFlags(schema);
    expect(flags.find((f) => f.path === 'name')!.required).toBe(true);
    expect(flags.find((f) => f.path === 'kind')!.required).toBe(false);
  });

  it('derives nested object flags with dot-notation path', () => {
    const schema = {
      type: 'object',
      properties: {
        sync: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            period: { type: 'string' },
          },
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(2);
    expect(names(flags)).toEqual(['sync.enabled', 'sync.period']);

    const enabledFlag = flags.find((f) => f.path === 'sync.enabled')!;
    expect(enabledFlag.type).toBe('boolean');
    expect(enabledFlag.required).toBe(false);
  });

  it('merges allOf branches into a single flag set', () => {
    const schema = {
      type: 'object',
      properties: {
        github: {
          type: 'object',
          allOf: [
            {
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
            {
              properties: {
                visibility: { type: 'string', enum: ['private', 'public'] },
              },
              required: ['visibility'],
            },
          ],
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(2);
    expect(names(flags)).toEqual(['github.name', 'github.visibility']);

    const nameFlag = flags.find((f) => f.path === 'github.name')!;
    expect(nameFlag).toMatchObject({
      required: false,
      conditionalRequired: true,
      type: 'string',
    });

    const visFlag = flags.find((f) => f.path === 'github.visibility')!;
    expect(visFlag).toMatchObject({
      required: false,
      conditionalRequired: true,
    });
    expect(visFlag.enumValues).toEqual(['private', 'public']);
  });

  it('flattens oneOf branches and marks all as not required', () => {
    const schema = {
      type: 'object',
      properties: {
        endpoint: {
          oneOf: [
            { type: 'object', properties: { url: { type: 'string' } } },
            { type: 'object', properties: { arn: { type: 'string' } } },
          ],
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(3);
    expect(names(flags)).toEqual([
      'endpoint.arn',
      'endpoint.json',
      'endpoint.url',
    ]);
    for (const f of flags) {
      expect(f.required).toBe(false);
    }
  });

  it('flattens anyOf branches and marks all as not required', () => {
    const schema = {
      type: 'object',
      properties: {
        providesApis: {
          anyOf: [
            {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
            {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: { name: { type: 'string' } },
              },
            },
          ],
        },
      },
    };

    const flags = deriveFlags(schema);
    for (const f of flags) {
      expect(f.required).toBe(false);
    }
  });

  it('derives array-of-primitives as multiple flag', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(1);
    expect(flags[0].path).toBe('tags');
    expect(flags[0].multiple).toBe(true);
    expect(flags[0].type).toBe('string');
  });

  it('skips $ref nodes', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        recursive: { $ref: '#/$defs/Something' },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(1);
    expect(flags[0].path).toBe('name');
  });

  it('captures enums and descriptions', () => {
    const schema = {
      type: 'object',
      properties: {
        visibility: {
          type: 'string',
          description: 'Repo visibility',
          enum: ['private', 'public', 'internal'],
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(1);
    expect(flags[0].enumValues).toEqual(['private', 'public', 'internal']);
    expect(flags[0].description).toBe('Repo visibility');
  });

  it('handles deeply nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        a: {
          type: 'object',
          properties: {
            b: {
              type: 'object',
              properties: {
                c: { type: 'boolean' },
              },
            },
          },
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(1);
    expect(flags[0].path).toBe('a.b.c');
    expect(flags[0].type).toBe('boolean');
  });

  it('derives flags from a ComponentClaim-like provider.github structure', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string' },
        owner: { type: 'string' },
      },
      required: ['name', 'kind', 'owner'],
    };

    const flags = deriveFlags(schema);
    expect(flags).toHaveLength(3);
    for (const f of flags) {
      expect(f.required).toBe(true);
    }
  });

  it('adds .json escape hatch for anyOf with structurally incompatible branches', () => {
    const schema = {
      type: 'object',
      properties: {
        providesApis: {
          anyOf: [
            {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  version: { type: 'string' },
                },
                required: ['name', 'version'],
              },
            },
            {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  version: { type: 'string' },
                },
              },
            },
          ],
        },
      },
    };

    const flags = deriveFlags(schema);
    const jsonFlag = flags.find((f) => f.path === 'providesApis.json');
    expect(jsonFlag).toBeDefined();
    expect(jsonFlag!.type).toBe('string');
    expect(jsonFlag!.required).toBe(false);
    expect(jsonFlag!.multiple).toBe(false);
    expect(jsonFlag!.description).toContain('Raw JSON value');
  });

  it('adds .json escape hatch for oneOf with structurally incompatible branches', () => {
    const schema = {
      type: 'object',
      properties: {
        complexField: {
          oneOf: [
            {
              type: 'array',
              items: { type: 'object', properties: { id: { type: 'string' } } },
            },
            {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          ],
        },
      },
    };

    const flags = deriveFlags(schema);
    const jsonFlag = flags.find((f) => f.path === 'complexField.json');
    expect(jsonFlag).toBeDefined();
    expect(jsonFlag!.type).toBe('string');
  });

  it('derives const-discriminated variant groups', () => {
    const schema = {
      type: 'object',
      properties: {
        strategy: {
          oneOf: [
            {
              properties: {
                name: { type: 'string', const: 'legacy' },
                legacySetting: { type: 'string' },
              },
            },
            {
              properties: {
                name: { type: 'string', const: 'modern' },
                modernSetting: { type: 'string' },
              },
            },
          ],
        },
      },
    };

    expect(deriveVariantGroups(schema)).toEqual([
      {
        discriminatorPath: 'strategy.name',
        variants: {
          legacy: ['strategy.legacySetting'],
          modern: ['strategy.modernSetting'],
        },
      },
    ]);
  });

  it('excludes fields shared by every discriminated variant', () => {
    const schema = {
      type: 'object',
      properties: {
        strategy: {
          oneOf: [
            {
              properties: {
                name: { type: 'string', const: 'legacy' },
                description: { type: 'string' },
                legacySetting: { type: 'string' },
              },
            },
            {
              properties: {
                name: { type: 'string', const: 'modern' },
                description: { type: 'string' },
                modernSetting: { type: 'string' },
              },
            },
          ],
        },
      },
    };

    expect(deriveVariantGroups(schema)).toEqual([
      {
        discriminatorPath: 'strategy.name',
        variants: {
          legacy: ['strategy.legacySetting'],
          modern: ['strategy.modernSetting'],
        },
      },
    ]);
  });

  it('retains a JSON fallback alongside useful union flags', () => {
    const schema = {
      type: 'object',
      properties: {
        endpoint: {
          oneOf: [
            { type: 'object', properties: { url: { type: 'string' } } },
            { type: 'object', properties: { arn: { type: 'string' } } },
          ],
        },
      },
    };

    const flags = deriveFlags(schema);
    expect(names(flags)).toEqual([
      'endpoint.arn',
      'endpoint.json',
      'endpoint.url',
    ]);
  });

  it('derives pages.public and pages.https_enforced as boolean flags', () => {
    const flags = deriveFlags(claimSchema('ComponentClaim'));

    const publicFlag = flags.find(
      (f) => f.path === 'providers.github.pages.public',
    );
    expect(publicFlag).toBeDefined();
    expect(publicFlag!.type).toBe('boolean');
    expect(publicFlag!.required).toBe(false);
    expect(publicFlag!.multiple).toBe(false);

    const httpsFlag = flags.find(
      (f) => f.path === 'providers.github.pages.https_enforced',
    );
    expect(httpsFlag).toBeDefined();
    expect(httpsFlag!.type).toBe('boolean');
    expect(httpsFlag!.required).toBe(false);
    expect(httpsFlag!.multiple).toBe(false);
  });

  it('derives pages.source.path with enum values', () => {
    const flags = deriveFlags(claimSchema('ComponentClaim'));

    const pathFlag = flags.find(
      (f) => f.path === 'providers.github.pages.source.path',
    );
    expect(pathFlag).toBeDefined();
    expect(pathFlag!.type).toBe('string');
    expect(pathFlag!.enumValues).toEqual(['/', '/docs']);
  });

  it('marks schema-required leaves below optional ancestors as conditional', () => {
    const flags = deriveFlags(claimSchema('ComponentClaim'));

    expect(flags.find((flag) => flag.path === 'owner')?.required).toBe(true);
    expect(
      flags.find((flag) => flag.path === 'providers.github.name'),
    ).toMatchObject({ required: false, conditionalRequired: true });
    expect(
      flags.find(
        (flag) => flag.path === 'providers.github.branchStrategy.name',
      ),
    ).toMatchObject({ required: false, conditionalRequired: true });
    expect(flags.map(({ path }) => path)).toContain('annotations.json');
  });

  it('preserves nested allOf unions and complex JSON values', () => {
    const flags = deriveFlags(claimSchema('SecretsClaim'));

    expect(names(flags)).toEqual(
      expect.arrayContaining([
        'providers.external_secrets.json',
        'providers.external_secrets.externalSecrets.secrets.json',
        'providers.external_secrets.pushSecrets.json',
        'providers.external_secrets.secretStore.name',
      ]),
    );
  });

  it('requires non-derivable complex values and finds safe empty containers', () => {
    const flags = deriveFlags(claimSchema('TFWorkspaceClaim'));

    expect(
      flags.find((flag) => flag.path === 'providers.terraform.values.json'),
    ).toMatchObject({ required: true });
    expect(
      flags.find(
        (flag) => flag.path === 'providers.terraform.context.providers.json',
      ),
    ).toMatchObject({ required: true });
    expect(deriveRequiredContainers(claimSchema('DomainClaim'))).toContain(
      'providers',
    );
    expect(
      deriveRequiredContainers(claimSchema('TFWorkspaceClaim')),
    ).not.toContain('providers.terraform.context');
  });
});
