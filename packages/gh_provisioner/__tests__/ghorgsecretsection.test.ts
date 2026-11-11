import { initSystemFS } from '../src';

import path from 'path';

import { EntityGHOrgSecretSection } from '../src/entities/ghorgsecretsection';

jest.mock('github', () => ({
  __esModule: true,
  default: {
    encryption: {
      getOrgPublicKey: jest.fn(),
      encryptOrgSecret: jest.fn(),
      getOrgSecret: jest.fn(),
    },
  },
}));

import github from 'github';

const mockGetOrgPublicKey = github.encryption.getOrgPublicKey as jest.Mock;
const mockEncryptOrgSecret = github.encryption.encryptOrgSecret as jest.Mock;
const mockGetOrgSecret = github.encryption.getOrgSecret as jest.Mock;

describe('EntityGHOrgSecretSection entity', () => {
  let entity: EntityGHOrgSecretSection;

  function setupResolveSelfOutputs(value: any) {
    (entity.cr as any).fResolveSelfOutputs = jest.fn().mockReturnValue(value);
  }

  beforeEach(async () => {
    mockGetOrgPublicKey.mockReset();
    mockEncryptOrgSecret.mockReset();
    mockGetOrgSecret.mockReset();

    mockGetOrgPublicKey.mockResolvedValue({
      key_id: 'test-key-id',
      key: 'test-key-base64',
    });

    mockEncryptOrgSecret.mockImplementation(
      async (_org: string, _section: string, plaintext: string) => ({
        key_id: 'test-key-id',
        encrypted_value: `encrypted_${plaintext}`,
      }),
    );

    entity = (await initSystemFS(
      path.join(__dirname, 'fixtures/ghorgsecretsection/cr.yaml'),
      path.join(__dirname, 'fixtures/ghorgsecretsection/deps.yaml'),
    )) as EntityGHOrgSecretSection;
  });

  describe('config generation', () => {
    it('builds config with encrypted values and SHA-256 hashes for all sections', async () => {
      await entity.loadResources('plan');

      const doc = entity.document;

      expect(doc.config.org).toBe('firestartr-test');

      expect(doc.config.actions.SECRET_A).toEqual({
        value: 'encrypted_secret_a',
        visibility: 'all',
      });
      expect(doc.config.actions.SECRET_B).toEqual({
        value: 'encrypted_secret_b',
        visibility: 'selected',
        selected_repositories: ['firestartr-test/component-a'],
      });
      expect(doc.config.codespaces.SECRET_C).toEqual({
        value: 'encrypted_secret_c',
        visibility: 'all',
      });
      expect(doc.config.dependabot).toEqual({});

      expect(doc.config.actions_sha256.SECRET_A).toMatch(/^[a-f0-9]{64}$/);
      expect(doc.config.actions_sha256.SECRET_B).toMatch(/^[a-f0-9]{64}$/);
      expect(doc.config.codespaces_sha256.SECRET_C).toMatch(/^[a-f0-9]{64}$/);
      expect(doc.config.dependabot_sha256).toEqual({});
    });

    it('fetches public key once per non-empty section', async () => {
      await entity.loadResources('plan');

      expect(mockGetOrgPublicKey).toHaveBeenCalledTimes(2);
      expect(mockGetOrgPublicKey).toHaveBeenCalledWith(
        'firestartr-test',
        'actions',
      );
      expect(mockGetOrgPublicKey).toHaveBeenCalledWith(
        'firestartr-test',
        'codespaces',
      );
    });

    it('encrypts each secret with the pre-fetched key', async () => {
      await entity.loadResources('plan');

      expect(mockEncryptOrgSecret).toHaveBeenCalledTimes(3);

      expect(mockEncryptOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'actions',
        'secret_a',
        { key_id: 'test-key-id', key: 'test-key-base64' },
      );
      expect(mockEncryptOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'actions',
        'secret_b',
        { key_id: 'test-key-id', key: 'test-key-base64' },
      );
      expect(mockEncryptOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'codespaces',
        'secret_c',
        { key_id: 'test-key-id', key: 'test-key-base64' },
      );
    });

    it('produces empty config when all sections are empty', async () => {
      entity.cr.spec.secrets = {
        actions: [],
        codespaces: [],
        dependabot: [],
      };

      await entity.loadResources('plan');

      const doc = entity.document;
      expect(doc.config.actions).toEqual({});
      expect(doc.config.codespaces).toEqual({});
      expect(doc.config.dependabot).toEqual({});
    });

    it('rejects AVOID_PROVIDER_SECRET_ENCRYPTION for declared org secrets', async () => {
      const original = process.env['AVOID_PROVIDER_SECRET_ENCRYPTION'];
      process.env['AVOID_PROVIDER_SECRET_ENCRYPTION'] = '1';

      try {
        await expect(entity.loadResources('plan')).rejects.toThrow(
          /AVOID_PROVIDER_SECRET_ENCRYPTION is not supported for org secrets/,
        );
        expect(mockGetOrgPublicKey).not.toHaveBeenCalled();
        expect(mockEncryptOrgSecret).not.toHaveBeenCalled();
      } finally {
        if (original === undefined) {
          delete process.env['AVOID_PROVIDER_SECRET_ENCRYPTION'];
        } else {
          process.env['AVOID_PROVIDER_SECRET_ENCRYPTION'] = original;
        }
      }
    });
  });

  describe('adoption logic', () => {
    it('drops the fingerprint of an adopted secret so the next reconcile rewrites its value', async () => {
      setupResolveSelfOutputs(undefined);
      mockGetOrgSecret.mockImplementation(
        async (_org: string, _section: string, name: string) =>
          name === 'SECRET_A' ? { name } : null,
      );

      await entity.loadResources('apply');

      expect(entity.document.config.actions.SECRET_A).toEqual({
        value: 'encrypted_secret_a',
        visibility: 'all',
      });
      expect(entity.document.config.actions_sha256.SECRET_A).toBeUndefined();
      expect(entity.document.config.actions_sha256.SECRET_B).toMatch(
        /^[a-f0-9]{64}$/,
      );
    });

    it('adopts all declared secrets found on GitHub when no managed secret names are reported (first reconciliation)', async () => {
      setupResolveSelfOutputs(undefined);
      mockGetOrgSecret.mockImplementation(
        async (_org: string, _section: string, name: string) => {
          if (name === 'SECRET_A' || name === 'SECRET_C') return { name };
          return null;
        },
      );

      await entity.loadResources('apply');

      expect(mockGetOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'actions',
        'SECRET_A',
      );
      expect(mockGetOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'actions',
        'SECRET_B',
      );
      expect(mockGetOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'codespaces',
        'SECRET_C',
      );

      expect(entity.importDocument).toStrictEqual({
        imports: [
          {
            to: 'github_actions_organization_secret.this["SECRET_A"]',
            id: 'SECRET_A',
          },
          {
            to: 'github_codespaces_organization_secret.this["SECRET_C"]',
            id: 'SECRET_C',
          },
        ],
      });
    });

    it('imports only the secret resource for a selected-visibility secret', async () => {
      setupResolveSelfOutputs(undefined);
      mockGetOrgSecret.mockImplementation(
        async (_org: string, _section: string, name: string) => {
          if (name === 'SECRET_B') return { name };
          return null;
        },
      );

      await entity.loadResources('apply');

      expect(entity.importDocument).toStrictEqual({
        imports: [
          {
            to: 'github_actions_organization_secret.this["SECRET_B"]',
            id: 'SECRET_B',
          },
        ],
      });

      const importTargets = entity.importDocument.imports.map(
        (entry: { to: string }) => entry.to,
      );
      expect(importTargets).toStrictEqual([
        'github_actions_organization_secret.this["SECRET_B"]',
      ]);
      expect(
        importTargets.some((target: string) =>
          target.includes('_organization_secret_repositories'),
        ),
      ).toBe(false);
    });

    it('imports a new-to-module secret found on GitHub', async () => {
      setupResolveSelfOutputs(['SECRET_A']);
      mockGetOrgSecret.mockImplementation(
        async (_org: string, _section: string, name: string) => {
          if (name === 'SECRET_B') return { name };
          return null;
        },
      );

      await entity.loadResources('apply');

      expect(mockGetOrgSecret).toHaveBeenCalledWith(
        'firestartr-test',
        'actions',
        'SECRET_B',
      );
      expect(entity.importDocument).toStrictEqual({
        imports: [
          {
            to: 'github_actions_organization_secret.this["SECRET_B"]',
            id: 'SECRET_B',
          },
        ],
      });
    });

    it('skips adoption when API returns 403', async () => {
      setupResolveSelfOutputs(['SECRET_A']);
      mockGetOrgSecret.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { status: 403 }),
      );

      await entity.loadResources('apply');

      expect(entity.importDocument).toStrictEqual({ imports: [] });
    });

    it('skips adoption when all secrets are already managed', async () => {
      mockGetOrgSecret.mockResolvedValue(null);
      setupResolveSelfOutputs(['SECRET_A', 'SECRET_B', 'SECRET_C']);

      await entity.loadResources('apply');

      expect(mockGetOrgSecret).not.toHaveBeenCalled();
      expect(entity.importDocument).toStrictEqual({ imports: [] });
    });

    it('does not run adoption on plan', async () => {
      setupResolveSelfOutputs(undefined);

      await entity.loadResources('plan');

      expect(mockGetOrgSecret).not.toHaveBeenCalled();
      expect(entity.importDocument).toStrictEqual({ imports: [] });
    });

    it('does not resolve or encrypt secrets on destroy', async () => {
      await expect(entity.loadResources('destroy')).resolves.toBeUndefined();

      expect(mockGetOrgPublicKey).not.toHaveBeenCalled();
      expect(mockEncryptOrgSecret).not.toHaveBeenCalled();
      expect(mockGetOrgSecret).not.toHaveBeenCalled();
    });
  });

  describe('postProvision and loadAddressesToImport', () => {
    it('postProvision is a no-op', async () => {
      await expect(entity.postProvision('apply')).resolves.toBeUndefined();
    });

    it('loadAddressesToImport is a no-op', async () => {
      await expect(entity.loadAddressesToImport()).resolves.toBeUndefined();
    });
  });
});
