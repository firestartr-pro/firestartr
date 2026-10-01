import { initSystemFS } from '../src';

import path from 'path';

import { EntityGHRepositorySecretsSection } from '../src/entities/ghrepositorysecretssection';

import crypto from 'crypto';

jest.mock('github');
import github from 'github';

const mockEncryptRepoSecret = github.encryption.encryptRepoSecret as jest.Mock;

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

describe('GHRepositorySecretsSection entity', () => {
  let entity: EntityGHRepositorySecretsSection;

  beforeEach(async () => {
    entity = await initSystemFS(
      path.join(__dirname, 'fixtures/grss/cr.yaml'),
      path.join(__dirname, 'fixtures/grss/deps.yaml'),
    ) as EntityGHRepositorySecretsSection;
  });

  it('is able to render its values', async () => {
    expect(entity instanceof EntityGHRepositorySecretsSection).toBe(true);
  });

  it('emits sha256 hashes alongside encrypted values in the config', async () => {
    mockEncryptRepoSecret.mockResolvedValue({
      key_id: 'test-key-id',
      encrypted_value: 'test-encrypted-value',
    });

    await entity.loadResources('apply');

    const doc = entity.document;
    const config = doc.config;

    // All three secrets are emitted
    expect(config.actions.SECRET_A).toBe('test-encrypted-value');
    expect(config.actions.SECRET_B).toBe('test-encrypted-value');
    expect(config.codespaces.SECRET_C).toBe('test-encrypted-value');
    expect(config.dependabot).toEqual({});

    // sha256 hashes match the fixture plaintext values
    // Secret key 'a' → 'secret_a', key 'b' → 'secret_b', key 'c' → 'secret_c'
    expect(config.actions_sha256.SECRET_A).toBe(sha256('secret_a'));
    expect(config.actions_sha256.SECRET_B).toBe(sha256('secret_b'));
    expect(config.codespaces_sha256.SECRET_C).toBe(sha256('secret_c'));

    // All sha256 values are valid 64-char lowercase hex strings
    const hex64 = /^[a-f0-9]{64}$/;
    for (const sha of Object.values(config.actions_sha256) as string[]) {
      expect(sha).toMatch(hex64);
    }
    for (const sha of Object.values(config.codespaces_sha256) as string[]) {
      expect(sha).toMatch(hex64);
    }

    // dependabot has no secrets, so sha256 map is empty
    expect(config.dependabot_sha256).toEqual({});
  });
});
