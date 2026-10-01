import { describe, expect, it, jest } from '@jest/globals';

import { ClaimsClient } from '../src/claims/client';
import { applyDefaultsFromRepo } from '../src/claims/defaults';

function createClient(overrides: Record<string, unknown> = {}) {
  return {
    getDefaultBranch: jest.fn(async () => 'main'),
    getRawFile: jest.fn(async () => null),
    listFilesRecursive: jest.fn(async () => []),
    ...overrides,
  } as unknown as ClaimsClient;
}

describe('applyDefaultsFromRepo', () => {
  it('fails when strict defaults resolution is ambiguous', async () => {
    const claim = { kind: 'ComponentClaim', name: 'svc' };
    const client = createClient({
      listFilesRecursive: jest.fn(async () => [
        'a/claims_defaults.yaml',
        'b/claims_defaults.yaml',
      ]),
    });

    await expect(
      applyDefaultsFromRepo(client, claim, 'strict'),
    ).rejects.toThrow(
      'Multiple claims_defaults.yaml files found: a/claims_defaults.yaml, b/claims_defaults.yaml',
    );
  });

  it('warns and returns an unchanged copy for tolerant ambiguity', async () => {
    const claim = { kind: 'ComponentClaim', name: 'svc' };
    const client = createClient({
      listFilesRecursive: jest.fn(async () => [
        'a/claims_defaults.yaml',
        'b/claims_defaults.yaml',
      ]),
    });
    const stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    const result = await applyDefaultsFromRepo(client, claim, 'tolerant');

    expect(result).toEqual(claim);
    expect(result).not.toBe(claim);
    expect(stderr).toHaveBeenCalledWith(
      'Warning: Skipping defaults: Multiple claims_defaults.yaml files found: ' +
        'a/claims_defaults.yaml, b/claims_defaults.yaml; cannot determine which to use\n',
    );
    stderr.mockRestore();
  });

  it('loads and applies the conventional Defaults file without fallback traversal', async () => {
    const listFilesRecursive = jest.fn(async () => [
      'other/claims_defaults.yaml',
    ]);
    const client = createClient({
      getRawFile: jest.fn(async (path: string) =>
        path === 'claims/claims_defaults.yaml'
          ? 'ComponentClaim:\n  platformOwner: group:default\n'
          : null,
      ),
      listFilesRecursive,
    });

    await expect(
      applyDefaultsFromRepo(
        client,
        { kind: 'ComponentClaim', name: 'svc' },
        'strict',
      ),
    ).resolves.toEqual({
      kind: 'ComponentClaim',
      name: 'svc',
      platformOwner: 'group:default',
    });
    expect(listFilesRecursive).not.toHaveBeenCalled();
  });

  it('loads and applies a unique fallback Defaults file', async () => {
    const client = createClient({
      getRawFile: jest.fn(async (path: string) =>
        path === 'config/claims_defaults.yaml'
          ? 'ComponentClaim:\n  platformOwner: group:default\n'
          : null,
      ),
      listFilesRecursive: jest.fn(async () => [
        'claims/components/svc.yaml',
        'config/claims_defaults.yaml',
      ]),
    });

    await expect(
      applyDefaultsFromRepo(
        client,
        { kind: 'ComponentClaim', name: 'svc' },
        'strict',
      ),
    ).resolves.toEqual({
      kind: 'ComponentClaim',
      name: 'svc',
      platformOwner: 'group:default',
    });
  });

  it('returns an unchanged copy when no Defaults file exists', async () => {
    const claim = { kind: 'ComponentClaim', name: 'svc' };

    const result = await applyDefaultsFromRepo(
      createClient(),
      claim,
      'strict',
    );

    expect(result).toEqual(claim);
    expect(result).not.toBe(claim);
  });

  it.each(['strict', 'tolerant'] as const)(
    'rejects malformed Defaults YAML in %s mode',
    async (mode) => {
      const client = createClient({
        getRawFile: jest.fn(async () => 'ComponentClaim: [unterminated'),
      });

      await expect(
        applyDefaultsFromRepo(
          client,
          { kind: 'ComponentClaim', name: 'svc' },
          mode,
        ),
      ).rejects.toThrow();
    },
  );

  it.each(['strict', 'tolerant'] as const)(
    'rejects a non-object Defaults document in %s mode',
    async (mode) => {
      const client = createClient({
        getRawFile: jest.fn(async () => '- not\n- an\n- object\n'),
      });

      await expect(
        applyDefaultsFromRepo(
          client,
          { kind: 'ComponentClaim', name: 'svc' },
          mode,
        ),
      ).rejects.toThrow(
        'claims_defaults.yaml does not contain a YAML object',
      );
    },
  );

  it.each(['strict', 'tolerant'] as const)(
    'preserves repo access failures in %s mode',
    async (mode) => {
      const client = createClient({
        getRawFile: jest.fn(async () => {
          throw new Error('GitHub API exploded');
        }),
      });

      await expect(
        applyDefaultsFromRepo(
          client,
          { kind: 'ComponentClaim', name: 'svc' },
          mode,
        ),
      ).rejects.toThrow('GitHub API exploded');
    },
  );

  it('reuses a successful resolution for one Claims client', async () => {
    const getRawFile = jest.fn(
      async () => 'ComponentClaim:\n  platformOwner: group:default\n',
    );
    const client = createClient({ getRawFile });
    const claim = { kind: 'ComponentClaim', name: 'svc' };

    await applyDefaultsFromRepo(client, claim, 'strict');
    await applyDefaultsFromRepo(client, claim, 'strict');

    expect(getRawFile).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected resolution for one Claims client', async () => {
    const getRawFile = jest
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValue(
        'ComponentClaim:\n  platformOwner: group:default\n',
      );
    const client = createClient({ getRawFile });
    const claim = { kind: 'ComponentClaim', name: 'svc' };

    await expect(
      applyDefaultsFromRepo(client, claim, 'strict'),
    ).rejects.toThrow('transient failure');
    await expect(
      applyDefaultsFromRepo(client, claim, 'strict'),
    ).resolves.toMatchObject({ platformOwner: 'group:default' });
    expect(getRawFile).toHaveBeenCalledTimes(2);
  });
});
