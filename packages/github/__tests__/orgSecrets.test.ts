import crypto from 'crypto';

import {
  getOrgPublicKey,
  encryptOrgSecret,
  getOrgSecret,
} from '../src/orgSecrets';

function generateTestPublicKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

describe('orgSecrets', () => {
  describe('getOrgPublicKey', () => {
    it('dispatches to the correct section endpoint', async () => {
      const mockOctokit = {
        rest: {
          actions: {
            getOrgPublicKey: jest.fn().mockResolvedValue({
              data: { key_id: '1', key: 'abc123' },
            }),
          },
          codespaces: {
            getOrgPublicKey: jest.fn().mockResolvedValue({
              data: { key_id: '2', key: 'def456' },
            }),
          },
          dependabot: {
            getOrgPublicKey: jest.fn().mockResolvedValue({
              data: { key_id: '3', key: 'ghi789' },
            }),
          },
        },
      };

      const actionsResult = await getOrgPublicKey(
        'test-org',
        'actions',
        mockOctokit,
      );
      expect(actionsResult).toEqual({ key_id: '1', key: 'abc123' });
      expect(mockOctokit.rest.actions.getOrgPublicKey).toHaveBeenCalledWith({
        org: 'test-org',
      });

      const codespacesResult = await getOrgPublicKey(
        'test-org',
        'codespaces',
        mockOctokit,
      );
      expect(codespacesResult).toEqual({ key_id: '2', key: 'def456' });

      const dependabotResult = await getOrgPublicKey(
        'test-org',
        'dependabot',
        mockOctokit,
      );
      expect(dependabotResult).toEqual({ key_id: '3', key: 'ghi789' });
    });
  });

  describe('encryptOrgSecret', () => {
    it('encrypts plaintext with pre-fetched key', async () => {
      const validKey = generateTestPublicKey();
      const result = await encryptOrgSecret(
        'test-org',
        'actions',
        'my-secret-value',
        { key_id: 'test-key-id', key: validKey },
      );

      expect(result).toHaveProperty('key_id', 'test-key-id');
      expect(result).toHaveProperty('encrypted_value');
      expect(typeof result.encrypted_value).toBe('string');
      expect(result.encrypted_value.length).toBeGreaterThan(0);
    });

    it('produces different ciphertext for same plaintext (nonce randomization)', async () => {
      const validKey = generateTestPublicKey();
      const preFetchedKey = { key_id: 'key1', key: validKey };

      const result1 = await encryptOrgSecret(
        'test-org',
        'actions',
        'same-value',
        preFetchedKey,
      );
      const result2 = await encryptOrgSecret(
        'test-org',
        'actions',
        'same-value',
        preFetchedKey,
      );

      expect(result1.encrypted_value).not.toBe(result2.encrypted_value);
      expect(result1.key_id).toBe(result2.key_id);
    });

    it('fetches key from API when preFetchedKey is not provided', async () => {
      const validKey = generateTestPublicKey();
      const mockOctokit = {
        rest: {
          actions: {
            getOrgPublicKey: jest.fn().mockResolvedValue({
              data: { key_id: 'api-key', key: validKey },
            }),
          },
        },
      };

      const result = await encryptOrgSecret(
        'test-org',
        'actions',
        'secret',
        undefined,
        mockOctokit,
      );

      expect(result.key_id).toBe('api-key');
      expect(mockOctokit.rest.actions.getOrgPublicKey).toHaveBeenCalledWith({
        org: 'test-org',
      });
    });
  });

  describe('getOrgSecret', () => {
    it('returns secret metadata when found', async () => {
      const mockOctokit = {
        rest: {
          actions: {
            getOrgSecret: jest.fn().mockResolvedValue({
              data: { name: 'MY_SECRET', visibility: 'all' },
            }),
          },
        },
      };

      const result = await getOrgSecret(
        'test-org',
        'actions',
        'MY_SECRET',
        mockOctokit,
      );

      expect(result).toEqual({ name: 'MY_SECRET', visibility: 'all' });
      expect(mockOctokit.rest.actions.getOrgSecret).toHaveBeenCalledWith({
        org: 'test-org',
        secret_name: 'MY_SECRET',
      });
    });

    it('returns null when secret not found (404)', async () => {
      const mockOctokit = {
        rest: {
          actions: {
            getOrgSecret: jest.fn().mockRejectedValue(
              Object.assign(new Error('Not Found'), { status: 404 }),
            ),
          },
        },
      };

      const result = await getOrgSecret(
        'test-org',
        'actions',
        'MISSING',
        mockOctokit,
      );

      expect(result).toBeNull();
    });

    it('throws on non-404 errors', async () => {
      const mockOctokit = {
        rest: {
          actions: {
            getOrgSecret: jest.fn().mockRejectedValue(
              Object.assign(new Error('Forbidden'), { status: 403 }),
            ),
          },
        },
      };

      await expect(
        getOrgSecret('test-org', 'actions', 'FORBIDDEN', mockOctokit),
      ).rejects.toThrow('Forbidden');
    });

    it('dispatches to correct section endpoint', async () => {
      const mockOctokit = {
        rest: {
          codespaces: {
            getOrgSecret: jest.fn().mockResolvedValue({
              data: { name: 'CS_SECRET' },
            }),
          },
          dependabot: {
            getOrgSecret: jest.fn().mockResolvedValue({
              data: { name: 'DB_SECRET' },
            }),
          },
        },
      };

      await getOrgSecret('test-org', 'codespaces', 'CS_SECRET', mockOctokit);
      expect(mockOctokit.rest.codespaces.getOrgSecret).toHaveBeenCalledWith({
        org: 'test-org',
        secret_name: 'CS_SECRET',
      });

      await getOrgSecret('test-org', 'dependabot', 'DB_SECRET', mockOctokit);
      expect(mockOctokit.rest.dependabot.getOrgSecret).toHaveBeenCalledWith({
        org: 'test-org',
        secret_name: 'DB_SECRET',
      });
    });
  });
});
