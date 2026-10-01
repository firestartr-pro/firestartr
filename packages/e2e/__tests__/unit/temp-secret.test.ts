import fs from 'node:fs/promises';
import common from 'catalog_common';
import { createTempOpaqueSecret } from '../..';

import type { E2EApi } from '../../src/types';

function createClient(namespace = 'demo-ns'): {
  client: E2EApi;
  applyCr: jest.Mock;
  deleteCr: jest.Mock;
  getNamespace: jest.Mock;
} {
  const applyCr = jest.fn().mockResolvedValue(undefined);
  const deleteCr = jest.fn().mockResolvedValue(undefined);
  const getNamespace = jest.fn().mockReturnValue(namespace);

  return {
    client: {
      k8s: {
        applyCr,
        deleteCr,
        getNamespace,
      },
    } as unknown as E2EApi,
    applyCr,
    deleteCr,
    getNamespace,
  };
}

describe('createTempOpaqueSecret', () => {
  it('creates a temporary secret manifest using the client namespace', async () => {
    const { client, getNamespace } = createClient();
    const secret = await createTempOpaqueSecret(client, {
      name: 'demo-secret',
      key: 'webhook-secret',
      value: 'super-value',
    });

    try {
      const manifest = common.io.fromYaml(
        await fs.readFile(secret.manifestPath, 'utf-8'),
      ) as Record<string, unknown>;

      expect(getNamespace).toHaveBeenCalledTimes(1);
      expect(secret.claimSecretRef).toBe(
        'ref:secretsclaim:demo-secret:webhook-secret',
      );
      expect(manifest).toEqual({
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: 'demo-secret',
          namespace: 'demo-ns',
        },
        type: 'Opaque',
        stringData: {
          'webhook-secret': 'super-value',
        },
      });
    } finally {
      await secret.cleanup();
    }
  });

  it('applies, deletes, and cleans up the generated manifest', async () => {
    const { client, applyCr, deleteCr } = createClient();
    const secret = await createTempOpaqueSecret(client, {
      name: 'demo-secret',
      key: 'webhook-secret',
    });

    await secret.apply();
    expect(applyCr).toHaveBeenCalledWith(secret.manifestPath);

    await secret.dispose(42);
    expect(deleteCr).toHaveBeenCalledWith(secret.manifestPath, 42);
    await expect(fs.access(secret.outputPath)).rejects.toThrow();
  });

  it('requires non-empty name, key, and namespace', async () => {
    const { client } = createClient('   ');

    await expect(
      createTempOpaqueSecret(client, {
        name: ' ',
        key: 'webhook-secret',
      }),
    ).rejects.toThrow('Secret name is required');

    await expect(
      createTempOpaqueSecret(client, {
        name: 'demo-secret',
        key: ' ',
      }),
    ).rejects.toThrow('Secret key is required');

    await expect(
      createTempOpaqueSecret(client, {
        name: 'demo-secret',
        key: 'webhook-secret',
      }),
    ).rejects.toThrow('Secret namespace is required');
  });
});
