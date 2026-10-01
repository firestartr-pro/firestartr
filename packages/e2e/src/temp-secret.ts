import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import common from 'catalog_common';

import type { E2EApi } from './types';

const DEFAULT_SECRET_VALUE = 'supersecret123';
const TEMP_SECRET_FILE_NAME = 'secret.yaml';

function buildClaimSecretRef(name: string, key: string): string {
  return `ref:secretsclaim:${name}:${key}`;
}

export interface CreateTempOpaqueSecretOptions {
  name: string;
  key: string;
  value?: string;
  namespace?: string;
}

export interface TempOpaqueSecret {
  name: string;
  key: string;
  value: string;
  namespace: string;
  claimSecretRef: string;
  manifestPath: string;
  outputPath: string;
  apply: () => Promise<void>;
  deleteFromCluster: (timeoutSeconds?: number) => Promise<void>;
  cleanup: () => Promise<void>;
  dispose: (timeoutSeconds?: number) => Promise<void>;
}

function requireTrimmedValue(value: string, label: string): string {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error(`${label} is required`);
  }

  return normalizedValue;
}

export async function createTempOpaqueSecret(
  client: E2EApi,
  options: CreateTempOpaqueSecretOptions,
): Promise<TempOpaqueSecret> {
  const name = requireTrimmedValue(options.name, 'Secret name');
  const key = requireTrimmedValue(options.key, 'Secret key');
  const namespace = requireTrimmedValue(
    options.namespace ?? client.k8s.getNamespace(),
    'Secret namespace',
  );
  const value = options.value ?? DEFAULT_SECRET_VALUE;
  const outputPath = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-secret-'));
  const manifestPath = path.join(outputPath, TEMP_SECRET_FILE_NAME);

  await fs.writeFile(
    manifestPath,
    common.io.toYaml({
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name,
        namespace,
      },
      type: 'Opaque',
      stringData: {
        [key]: value,
      },
    }),
    'utf-8',
  );

  const cleanup = async (): Promise<void> => {
    await fs.rm(outputPath, { recursive: true, force: true });
  };

  const deleteFromCluster = async (timeoutSeconds?: number): Promise<void> => {
    await client.k8s.deleteCr(manifestPath, timeoutSeconds);
  };

  return {
    name,
    key,
    value,
    namespace,
    claimSecretRef: buildClaimSecretRef(name, key),
    manifestPath,
    outputPath,
    async apply(): Promise<void> {
      await client.k8s.applyCr(manifestPath);
    },
    deleteFromCluster,
    cleanup,
    async dispose(timeoutSeconds?: number): Promise<void> {
      try {
        await deleteFromCluster(timeoutSeconds);
      } finally {
        await cleanup();
      }
    },
  };
}
