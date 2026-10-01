import { readFileSync } from 'fs';
import { join } from 'path';
import YAML from 'yaml';
import { describe, it, expect } from '@jest/globals';
import { serializeClaim, sortClaimKeys } from '../src/claims/keyOrdering';

const FIXTURES = join(__dirname, 'fixtures', 'valid');

function loadFixture(name: string): Record<string, unknown> {
  const raw = readFileSync(join(FIXTURES, name), 'utf8');
  return YAML.parse(raw) as Record<string, unknown>;
}

describe('sortClaimKeys', () => {
  it('sorts envelope keys in defined order', () => {
    const claim = {
      providers: { github: {} },
      name: 'test',
      version: 'v1',
      kind: 'ComponentClaim',
      annotations: { 'firestartr.dev/foo': 'bar' },
    };

    const sorted = sortClaimKeys(claim);
    expect(Object.keys(sorted)).toEqual([
      'kind',
      'version',
      'name',
      'annotations',
      'providers',
    ]);
  });

  it('skips absent envelope fields', () => {
    const claim = {
      name: 'test',
      providers: {},
      kind: 'ComponentClaim',
    };

    const sorted = sortClaimKeys(claim);
    expect(Object.keys(sorted)).toEqual(['kind', 'name', 'providers']);
  });

  it('sorts unknown envelope keys alphabetically after defined ones', () => {
    const claim = {
      zebra: 1,
      kind: 'ComponentClaim',
      apple: 2,
      name: 'test',
    };

    const sorted = sortClaimKeys(claim);
    expect(Object.keys(sorted)).toEqual(['kind', 'name', 'apple', 'zebra']);
  });

  it('sorts annotations alphabetically', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      annotations: {
        'firestartr.dev/z': 'z-val',
        'firestartr.dev/a': 'a-val',
        'firestartr.dev/m': 'm-val',
      },
    };

    const sorted = sortClaimKeys(claim);
    expect(Object.keys(sorted.annotations as object)).toEqual([
      'firestartr.dev/a',
      'firestartr.dev/m',
      'firestartr.dev/z',
    ]);
  });
});

describe('providers ordering', () => {
  it('sorts providers block in defined order', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      providers: {
        catalog: {},
        terraform: { name: 'tf' },
        github: { name: 'gh' },
        external_secrets: { name: 'es' },
        argocd: { name: 'argocd' },
      },
    };

    const sorted = sortClaimKeys(claim);
    expect(Object.keys(sorted.providers as object)).toEqual([
      'github',
      'terraform',
      'argocd',
      'external_secrets',
      'catalog',
    ]);
  });

  it('skips absent provider keys', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      providers: {
        catalog: {},
        github: { name: 'gh' },
      },
    };

    const sorted = sortClaimKeys(claim);
    expect(Object.keys(sorted.providers as object)).toEqual([
      'github',
      'catalog',
    ]);
  });

  it('sorts immediate keys inside provider objects per provider map', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      providers: {
        github: {
          topics: ['a'],
          visibility: 'private',
          org: 'my-org',
          name: 'my-repo',
          archiveOnDestroy: false,
        },
      },
    };

    const sorted = sortClaimKeys(claim);
    const gh = (sorted.providers as Record<string, unknown>)
      .github as Record<string, unknown>;
    expect(Object.keys(gh)).toEqual([
      'name',
      'org',
      'visibility',
      'archiveOnDestroy',
      'topics',
    ]);
  });
});

describe('features sorting', () => {
  it('sorts features array by name', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      features: [
        { name: 'beta', args: { x: 1 } },
        { name: 'alpha', args: { y: 2 } },
        { name: 'gamma', args: { z: 3 } },
      ],
    };

    const sorted = sortClaimKeys(claim);
    const features = sorted.features as Array<{ name: string }>;
    expect(features.map((f) => f.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('preserves feature args as-is', () => {
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      features: [
        { name: 'b', args: { nested: { z: 1, a: 2 } } },
        { name: 'a', args: { deep: [3, 1, 2] } },
      ],
    };

    const sorted = sortClaimKeys(claim);
    const features = sorted.features as Array<{
      name: string;
      args: Record<string, unknown>;
    }>;
    expect(features[0].args).toEqual({ deep: [3, 1, 2] });
    expect(features[1].args).toEqual({ nested: { z: 1, a: 2 } });
  });
});

describe('serializeClaim', () => {
  it('produces valid YAML with correct key order', () => {
    const claim = {
      providers: { github: { visibility: 'private', org: 'my-org', name: 'r' } },
      name: 'my-svc',
      version: 'v1',
      kind: 'ComponentClaim',
      annotations: { 'firestartr.dev/owner': 'team-a' },
    };

    const yaml = serializeClaim(claim);
    const lines = yaml.split('\n');

    expect(lines[0]).toMatch(/^kind: ComponentClaim$/);
    expect(lines[1]).toMatch(/^version: v1$/);
    expect(lines[2]).toMatch(/^name: my-svc$/);
    expect(lines[3]).toMatch(/^annotations:/);
    expect(lines[4]).toMatch(/firestartr\.dev\/owner:/);
    expect(lines[5]).toMatch(/^providers:/);
  });

  it('uses lineWidth 120', () => {
    const longValue = 'x'.repeat(100);
    const claim = {
      kind: 'ComponentClaim',
      name: 'test',
      annotations: { key: longValue },
    };

    const yaml = serializeClaim(claim);
    const lines = yaml.split('\n');
    const annotationLine = lines.find((l) => l.includes(longValue));
    expect(annotationLine).toBeDefined();
  });

  it('returns empty object for empty input', () => {
    const yaml = serializeClaim({});
    expect(yaml).toMatch(/^{}\n$/);
  });
});

describe('fixture-based key ordering per claim kind', () => {
  const FIXTURE_CASES: Array<{
    file: string;
    kind: string;
    providerKey?: string;
    providerSubKeys?: string[];
  }> = [
    {
      file: 'component.yaml',
      kind: 'ComponentClaim',
      providerKey: 'github',
      providerSubKeys: ['name', 'org', 'visibility', 'branchStrategy'],
    },
    {
      file: 'group.yaml',
      kind: 'GroupClaim',
      providerKey: 'github',
      providerSubKeys: ['name', 'org', 'privacy'],
    },
    {
      file: 'user.yaml',
      kind: 'UserClaim',
      providerKey: 'github',
      providerSubKeys: ['name', 'org', 'role'],
    },
    {
      file: 'system.yaml',
      kind: 'SystemClaim',
      providerKey: 'catalog',
    },
    {
      file: 'domain.yaml',
      kind: 'DomainClaim',
      providerKey: 'catalog',
    },
    {
      file: 'tfworkspace.yaml',
      kind: 'TFWorkspaceClaim',
      providerKey: 'terraform',
      providerSubKeys: ['name', 'source', 'values', 'context'],
    },
    {
      file: 'secrets.yaml',
      kind: 'SecretsClaim',
      providerKey: 'external_secrets',
      providerSubKeys: ['name', 'secretStore', 'pushSecrets'],
    },
    {
      file: 'argodeploy.yaml',
      kind: 'ArgoDeployClaim',
      providerKey: 'argocd',
      providerSubKeys: ['name', 'chart'],
    },
    {
      file: 'orgwebhook.yaml',
      kind: 'OrgWebhookClaim',
      providerKey: 'github',
      providerSubKeys: ['name'],
    },
  ];

  for (const { file, kind, providerKey, providerSubKeys } of FIXTURE_CASES) {
    it(`${kind} (${file}): envelope keys start with kind then name`, () => {
      const claim = loadFixture(file);
      const sorted = sortClaimKeys(claim);

      expect(sorted.kind).toBe(kind);
      const keys = Object.keys(sorted);
      expect(keys[0]).toBe('kind');
      expect(keys[1]).toBe('name');
    });

    if (providerKey) {
      it(`${kind} (${file}): providers.${providerKey} is first provider`, () => {
        const claim = loadFixture(file);
        const sorted = sortClaimKeys(claim);
        const providers = sorted.providers as Record<string, unknown>;

        expect(Object.keys(providers)[0]).toBe(providerKey);
      });
    }

    if (providerSubKeys && providerKey) {
      it(`${kind} (${file}): providers.${providerKey} sub-keys in defined order`, () => {
        const claim = loadFixture(file);
        const sorted = sortClaimKeys(claim);
        const providers = sorted.providers as Record<string, unknown>;
        const provider = providers[providerKey] as Record<string, unknown>;
        const subKeys = Object.keys(provider);

        for (let i = 0; i < providerSubKeys.length; i++) {
          expect(subKeys[i]).toBe(providerSubKeys[i]);
        }
      });
    }

    it(`${kind} (${file}): serializes to valid YAML`, () => {
      const claim = loadFixture(file);
      const yaml = serializeClaim(claim);
      const parsed = YAML.parse(yaml) as Record<string, unknown>;

      expect(parsed.kind).toBe(kind);
      expect(parsed.name).toBeDefined();
    });
  }
});
