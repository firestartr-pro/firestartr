import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { captureOutput } from '@oclif/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClaimValidator } from '../src/utils/ajvValidation';
import { deriveFlags } from '../src/utils/deriveFlags';
import { buildClaimFromFlags } from '../src/utils/buildClaim';
import CreateOrgSettings from '../src/commands/create/orgsettings';

const SCHEMA_DIR = join(process.cwd(), 'schemas');

function loadSchema(kind: string): Record<string, unknown> {
  const raw = readFileSync(join(SCHEMA_DIR, `${kind}.json`), 'utf8');
  return JSON.parse(raw);
}

const validator = createClaimValidator({ schemasDir: SCHEMA_DIR });

beforeAll(() => {
  void loadSchema('OrgSettingsClaim');
});

describe('OrgSettingsClaim schema', () => {
  describe('flag derivation', () => {
    const schema = loadSchema('OrgSettingsClaim');
    const flags = deriveFlags(schema);

    it('derives flags for all org settings fields', () => {
      const paths = flags.map((f) => f.path);
      expect(paths).toContain('providers.github.name');
      expect(paths).toContain('providers.github.org');
      expect(paths).toContain('providers.github.billing_email');
      expect(paths).toContain('providers.github.company');
      expect(paths).toContain('providers.github.blog');
      expect(paths).toContain('providers.github.email');
      expect(paths).toContain('providers.github.twitter_username');
      expect(paths).toContain('providers.github.location');
      expect(paths).toContain('providers.github.description');
      expect(paths).toContain('providers.github.has_organization_projects');
      expect(paths).toContain('providers.github.default_repository_permission');
      expect(paths).toContain(
        'providers.github.secret_scanning_enabled_for_new_repositories',
      );
    });

    it('derives .json escape hatch for actions_variables', () => {
      const paths = flags.map((f) => f.path);
      expect(paths).toContain('providers.github.actions_variables.json');
    });

    it('derives a flag for providers.github.tfStateKey', () => {
      const paths = flags.map((f) => f.path);
      expect(paths).toContain('providers.github.tfStateKey');
    });

    it('does not derive org_secrets flags', () => {
      const paths = flags.map((f) => f.path);
      expect(paths).not.toContain('providers.github.org_secrets.actions.json');
      expect(paths).not.toContain(
        'providers.github.org_secrets.codespaces.json',
      );
      expect(paths).not.toContain(
        'providers.github.org_secrets.dependabot.json',
      );
    });

    it('does not derive system or owner flags', () => {
      const paths = flags.map((f) => f.path);
      expect(paths).not.toContain('system');
      expect(paths).not.toContain('owner');
    });

    it('derives enum values for default_repository_permission', () => {
      const flag = flags.find(
        (f) => f.path === 'providers.github.default_repository_permission',
      );
      expect(flag).toBeDefined();
      expect(flag!.enumValues).toEqual(['read', 'write', 'admin', 'none']);
    });

    it('derives boolean type for org settings flags', () => {
      const flag = flags.find(
        (f) =>
          f.path ===
          'providers.github.secret_scanning_enabled_for_new_repositories',
      );
      expect(flag).toBeDefined();
      expect(flag!.type).toBe('boolean');
    });
  });

  describe('claim building', () => {
    const schema = loadSchema('OrgSettingsClaim');
    const flags = deriveFlags(schema);

    it('builds a minimal OrgSettingsClaim from required flags', () => {
      const claim = buildClaimFromFlags(
        {
          name: 'my-org-settings',
          kind: 'OrgSettingsClaim',
          'providers.github.name': 'my-org-settings',
          'providers.github.org': 'my-org',
          'providers.github.billing_email': 'billing@example.com',
        },
        flags,
        ['providers'],
      );

      expect(claim).toEqual({
        name: 'my-org-settings',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'my-org-settings',
            org: 'my-org',
            billing_email: 'billing@example.com',
          },
        },
      });
    });

    it('builds a full OrgSettingsClaim with all settings', () => {
      const claim = buildClaimFromFlags(
        {
          name: 'full-org-settings',
          kind: 'OrgSettingsClaim',
          'providers.github.name': 'full-org-settings',
          'providers.github.org': 'my-org',
          'providers.github.billing_email': 'billing@example.com',
          'providers.github.company': 'Acme Corp',
          'providers.github.blog': 'https://acme.com',
          'providers.github.email': 'admin@acme.com',
          'providers.github.twitter_username': 'acme',
          'providers.github.location': 'NYC, US',
          'providers.github.description': 'Acme Corp GitHub org',
          'providers.github.has_organization_projects': true,
          'providers.github.has_repository_projects': false,
          'providers.github.default_repository_permission': 'write',
          'providers.github.members_can_create_repositories': true,
          'providers.github.secret_scanning_enabled_for_new_repositories': true,
          'providers.github.dependabot_alerts_enabled_for_new_repositories':
            true,
        },
        flags,
        ['providers'],
      );

      expect(claim).toEqual({
        name: 'full-org-settings',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'full-org-settings',
            org: 'my-org',
            billing_email: 'billing@example.com',
            company: 'Acme Corp',
            blog: 'https://acme.com',
            email: 'admin@acme.com',
            twitter_username: 'acme',
            location: 'NYC, US',
            description: 'Acme Corp GitHub org',
            has_organization_projects: true,
            has_repository_projects: false,
            default_repository_permission: 'write',
            members_can_create_repositories: true,
            secret_scanning_enabled_for_new_repositories: true,
            dependabot_alerts_enabled_for_new_repositories: true,
          },
        },
      });
    });

    it('builds an OrgSettingsClaim with actions_variables via .json flag', () => {
      const claim = buildClaimFromFlags(
        {
          name: 'vars-org-settings',
          kind: 'OrgSettingsClaim',
          'providers.github.name': 'vars-org-settings',
          'providers.github.org': 'my-org',
          'providers.github.billing_email': 'billing@example.com',
          'providers.github.actions_variables.json':
            '[{"name":"MY_VAR","value":"my-value","visibility":"all"}]',
        },
        flags,
        ['providers'],
      );

      expect(claim).toEqual({
        name: 'vars-org-settings',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'vars-org-settings',
            org: 'my-org',
            billing_email: 'billing@example.com',
            actions_variables: [
              { name: 'MY_VAR', value: 'my-value', visibility: 'all' },
            ],
          },
        },
      });
    });
  });

  describe('AJV validation', () => {
    it('fails for system or owner because they are not in the renderer envelope', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        system: 'system:payments',
        owner: 'group:platform',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for a top-level name that the renderer would reject', async () => {
      const claim = {
        name: 'Bad_Name',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('passes for a valid providers.github.tfStateKey', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            tfStateKey: '123e4567-e89b-42d3-a456-426614174000',
            billing_email: 'test@example.com',
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(true);
    });

    it('fails for a providers.github.org that the renderer would reject', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'My-Org',
            billing_email: 'test@example.com',
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for invalid default_repository_permission enum', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            default_repository_permission: 'superadmin',
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for duplicate actions_variables names', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              { name: 'FOO', value: 'one', visibility: 'all' },
              { name: 'FOO', value: 'two', visibility: 'private' },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for actions_variables name that the renderer would reject', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              { name: 'MY-VAR', value: 'val', visibility: 'all' },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for invalid visibility enum in actions_variables', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              { name: 'VAR', value: 'val', visibility: 'world' },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for selected_repositories that are not component refs', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              {
                name: 'VAR',
                value: 'val',
                visibility: 'selected',
                selected_repositories: ['foo'],
              },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for selected_repositories when visibility is not selected', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              {
                name: 'VAR',
                value: 'val',
                visibility: 'all',
                selected_repositories: ['component:my-component'],
              },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('passes for actions_variables with selected visibility and repos', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              {
                name: 'VAR',
                value: 'val',
                visibility: 'selected',
                selected_repositories: ['component:my-component'],
              },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(true);
    });

    it('fails for org_secrets because they are not part of this schema', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            org_secrets: {
              actions: [
                {
                  name: 'SEC',
                  value: 'ref:secretsclaim:sec:key',
                  visibility: 'all',
                },
              ],
            },
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });

    it('fails for additionalProperties in actions_variables items', async () => {
      const claim = {
        name: 'test',
        kind: 'OrgSettingsClaim',
        providers: {
          github: {
            name: 'test',
            org: 'my-org',
            billing_email: 'test@example.com',
            actions_variables: [
              { name: 'VAR', value: 'val', unknownField: 'oops' },
            ],
          },
        },
      };
      const result = await validator.validate(claim, 'OrgSettingsClaim');
      expect(result.valid).toBe(false);
    });
  });

});

describe('create orgsettings command', () => {
  const ROOT = process.cwd();

  afterEach(() => {
    process.exitCode = 0;
  });

  it('parses flags and prints a valid OrgSettingsClaim', async () => {
    const args = CreateOrgSettings.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    const { result, stdout, error } = await captureOutput(async () => {
      await CreateOrgSettings.run(args, { root: ROOT });
      return 0;
    });

    expect(error).toBeUndefined();
    expect(result).toBe(0);
    expect(stdout).toContain('kind: OrgSettingsClaim');
    expect(stdout).toContain('name: example');
    expect(stdout).toContain('org: example');
    expect(stdout).toContain('billing_email: example');
  });

  it('accepts actions_variables via the .json escape hatch', async () => {
    const { result, stdout, error } = await captureOutput(async () => {
      await CreateOrgSettings.run(
        [
          '--name',
          'vars-org-settings',
          '--providers.github.name',
          'vars-org-settings',
          '--providers.github.org',
          'my-org',
          '--providers.github.billing_email',
          'billing@example.com',
          '--providers.github.actions_variables.json',
          '[{"name":"MY_VAR","value":"my-value","visibility":"all"}]',
        ],
        { root: ROOT },
      );
      return 0;
    });

    expect(error).toBeUndefined();
    expect(result).toBe(0);
    expect(stdout).toContain('kind: OrgSettingsClaim');
    expect(stdout).toContain('name: vars-org-settings');
    expect(stdout).toContain('name: MY_VAR');
    expect(stdout).toContain('value: my-value');
    expect(stdout).toContain('visibility: all');
  });

  it('rejects an explicit --path', async () => {
    const args = CreateOrgSettings.examples[0]
      .replace('<%= config.bin %> <%= command.id %> ', '')
      .split(' ');
    args.push('--path', 'claims/orgSettings/example.yaml');

    const { error } = await captureOutput(() =>
      CreateOrgSettings.run(args, { root: ROOT }),
    );

    expect(error?.message).toContain(
      '--path is only supported for TFWorkspaceClaim and SecretsClaim',
    );
  });

  it.each([
    [
      '[{"name":"MY-VAR","value":"val","visibility":"all"}]',
      'an invalid actions_variables name',
    ],
    [
      '[{"name":"FOO","value":"one","visibility":"all"},{"name":"FOO","value":"two","visibility":"private"}]',
      'duplicate actions_variables names',
    ],
  ])('rejects %s (%s) through the command', async (actionsVariables) => {
    const { error } = await captureOutput(() =>
      CreateOrgSettings.run(
        [
          '--name',
          'bad-vars',
          '--providers.github.name',
          'bad-vars',
          '--providers.github.org',
          'my-org',
          '--providers.github.billing_email',
          'billing@example.com',
          '--providers.github.actions_variables.json',
          actionsVariables,
        ],
        { root: ROOT },
      ),
    );

    expect(error).toBeDefined();
  });
});
