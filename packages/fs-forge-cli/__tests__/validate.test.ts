import { describe, it, expect, beforeAll } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClaimValidator } from '../src/utils/ajvValidation';
import YAML from 'yaml';

const SCHEMAS_DIR = join(process.cwd(), 'schemas');

const SCHEMA_KINDS = [
  'ComponentClaim',
  'GroupClaim',
  'UserClaim',
  'SystemClaim',
  'DomainClaim',
  'TFWorkspaceClaim',
  'SecretsClaim',
  'OrgWebhookClaim',
  'ArgoDeployClaim',
  'OrgSettingsClaim',
] as const;

function loadSchema(kind: string): Record<string, unknown> {
  const raw = readFileSync(join(SCHEMAS_DIR, `${kind}.json`), 'utf8');
  return JSON.parse(raw);
}

function loadYaml(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf8');
  return YAML.parse(raw) as Record<string, unknown>;
}

const validator = createClaimValidator({ schemasDir: SCHEMAS_DIR });

beforeAll(() => {
  for (const kind of SCHEMA_KINDS) void loadSchema(kind);
});

describe('createClaimValidator', () => {
  describe('valid claims', () => {
    const fixtureDir = join(process.cwd(), '__tests__', 'fixtures', 'valid');
    const validCases: Array<[string, string]> = [
      ['ComponentClaim', 'component.yaml'],
      ['GroupClaim', 'group.yaml'],
      ['UserClaim', 'user.yaml'],
      ['SystemClaim', 'system.yaml'],
      ['DomainClaim', 'domain.yaml'],
      ['TFWorkspaceClaim', 'tfworkspace.yaml'],
      ['SecretsClaim', 'secrets.yaml'],
      ['OrgWebhookClaim', 'orgwebhook.yaml'],
      ['ArgoDeployClaim', 'argodeploy.yaml'],
      ['OrgSettingsClaim', 'orgsettings.yaml'],
      ['OrgSettingsClaim', 'orgsettings-minimal.yaml'],
    ];

    for (const [kind, file] of validCases) {
      it(`passes for a valid ${kind}`, async () => {
        const claim = loadYaml(join(fixtureDir, file));
        const result = await validator.validate(claim, kind);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    }
  });

  describe('invalid claims', () => {
    const invalidCases: Array<[string, string, string]> = [
      ['ComponentClaim (missing owner)', 'invalid/component-missing-owner.yaml', 'ComponentClaim'],
      ['GroupClaim (missing privacy)', 'invalid/group-missing-privacy.yaml', 'GroupClaim'],
      ['UserClaim (missing role)', 'invalid/user-missing-role.yaml', 'UserClaim'],
      ['TFWorkspaceClaim (missing context)', 'invalid/tfworkspace-missing-context.yaml', 'TFWorkspaceClaim'],
      ['OrgSettingsClaim (missing billing_email)', 'invalid/orgsettings-missing-billing-email.yaml', 'OrgSettingsClaim'],
    ];

    for (const [label, fixturePath, expectedKind] of invalidCases) {
      it(`fails for ${label}`, async () => {
        const claim = loadYaml(join(process.cwd(), '__tests__', 'fixtures', fixturePath));
        const result = await validator.validate(claim, expectedKind);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    }
  });

  describe('edge cases', () => {
    it('returns invalid for a claim missing required fields', async () => {
      const claim = { name: 'my-component' };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns invalid for a claim with wrong field types', async () => {
      const claim = {
        name: 'my-component',
        kind: 'ComponentClaim',
        owner: 'group:my-team',
        providers: {
          github: {
            name: 'my-repo',
            org: 'my-org',
            visibility: 'private',
            branchStrategy: { name: 'gitflow' },
            sync: { enabled: 'not-a-boolean' },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
    });

    it('reports descriptive error messages', async () => {
      const claim = {};

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
      for (const err of result.errors) {
        expect(typeof err).toBe('string');
        expect(err.length).toBeGreaterThan(0);
      }
    });

    it('validates enum constraints', async () => {
      const claim = {
        name: 'my-component',
        kind: 'ComponentClaim',
        owner: 'group:my-team',
        providers: {
          github: {
            name: 'my-repo',
            org: 'my-org',
            visibility: 'invalid-visibility',
            branchStrategy: { name: 'gitflow' },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
    });

    it('validates nested required fields in allOf branches', async () => {
      const claim = {
        name: 'my-component',
        kind: 'ComponentClaim',
        owner: 'group:my-team',
        providers: {
          github: {
            name: 'my-repo',
            org: 'my-org',
            visibility: 'private',
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
    });

    it('validates a fully featured ComponentClaim', async () => {
      const claim = {
        name: 'api-gateway',
        kind: 'ComponentClaim',
        description: 'API Gateway component',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'api-gateway',
            org: 'my-org',
            visibility: 'internal',
            branchStrategy: { name: 'main-trunk', defaultBranch: 'main' },
            sync: { enabled: true, period: '24h' },
            technology: { stack: 'node', version: '20' },
            topics: ['api', 'gateway'],
            pages: { buildType: 'workflow' },
            allowMergeCommit: true,
            deleteBranchOnMerge: true,
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(true);
    });

    it('validates multiple flags produce correct structure', async () => {
      const claim = {
        name: 'multi-topic',
        kind: 'ComponentClaim',
        owner: 'group:dev',
        providers: {
          github: {
            name: 'multi-topic',
            org: 'my-org',
            visibility: 'public',
            branchStrategy: { name: 'gitflow' },
            topics: ['topic-a', 'topic-b', 'topic-c'],
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(true);
    });

    it('validates pages.public boolean passthrough', async () => {
      const claim = {
        name: 'pages-public',
        kind: 'ComponentClaim',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'pages-public',
            org: 'my-org',
            visibility: 'public',
            branchStrategy: { name: 'main-trunk' },
            pages: { buildType: 'workflow', public: true },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(true);
    });

    it('validates pages.https_enforced with cname', async () => {
      const claim = {
        name: 'pages-https',
        kind: 'ComponentClaim',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'pages-https',
            org: 'my-org',
            visibility: 'public',
            branchStrategy: { name: 'main-trunk' },
            pages: {
              buildType: 'legacy',
              cname: 'docs.example.com',
              https_enforced: true,
              source: { branch: 'main', path: '/' },
            },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(true);
    });

    it('rejects pages.https_enforced without cname', async () => {
      const claim = {
        name: 'pages-https-bad',
        kind: 'ComponentClaim',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'pages-https-bad',
            org: 'my-org',
            visibility: 'public',
            branchStrategy: { name: 'main-trunk' },
            pages: { buildType: 'legacy', https_enforced: true },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('cname'))).toBe(true);
    });

    it('validates pages.source.path enum /docs', async () => {
      const claim = {
        name: 'pages-docs',
        kind: 'ComponentClaim',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'pages-docs',
            org: 'my-org',
            visibility: 'public',
            branchStrategy: { name: 'main-trunk' },
            pages: {
              buildType: 'legacy',
              source: { branch: 'main', path: '/docs' },
            },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(true);
    });

    it('rejects pages.source.path with invalid value', async () => {
      const claim = {
        name: 'pages-bad-path',
        kind: 'ComponentClaim',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'pages-bad-path',
            org: 'my-org',
            visibility: 'public',
            branchStrategy: { name: 'main-trunk' },
            pages: {
              buildType: 'legacy',
              source: { branch: 'main', path: '/invalid' },
            },
          },
        },
      };

      const result = await validator.validate(claim, 'ComponentClaim');
      expect(result.valid).toBe(false);
    });
  });
});
