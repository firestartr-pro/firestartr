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
  /** Primary key of the Secret. Required unless `extraValues` is provided. */
  key?: string;
  value?: string;
  /**
   * Additional keys written to the same Secret, for scenarios that need one
   * SecretsClaim to expose several values (for example several org secrets).
   */
  extraValues?: Record<string, string>;
  namespace?: string;
}

export interface TempOpaqueSecret {
  name: string;
  /** Primary key (first key) of the Secret. */
  key: string;
  /** Primary value (value of `key`). */
  value: string;
  /** Every key/value written to the Secret. */
  values: Record<string, string>;
  namespace: string;
  claimSecretRef: string;
  /** `ref:secretsclaim:<name>:<key>` for any key of this Secret. */
  claimSecretRefForKey: (key: string) => string;
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
  const primaryKey = options.key
    ? requireTrimmedValue(options.key, 'Secret key')
    : undefined;
  const extraValues = options.extraValues ?? {};

  if (!primaryKey && Object.keys(extraValues).length === 0) {
    throw new Error('Secret key is required');
  }

  if (primaryKey && primaryKey in extraValues) {
    throw new Error(`Secret '${name}' declares key '${primaryKey}' twice`);
  }

  const namespace = requireTrimmedValue(
    options.namespace ?? client.k8s.getNamespace(),
    'Secret namespace',
  );
  const values: Record<string, string> = {
    ...(primaryKey
      ? { [primaryKey]: options.value ?? DEFAULT_SECRET_VALUE }
      : {}),
    ...extraValues,
  };
  const key = primaryKey ?? Object.keys(values)[0]!;
  const value = values[key]!;
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
      stringData: values,
    }),
    'utf-8',
  );

  const claimSecretRefForKey = (secretKey: string): string => {
    if (!(secretKey in values)) {
      throw new Error(`Secret '${name}' has no key '${secretKey}'`);
    }

    return buildClaimSecretRef(name, secretKey);
  };

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
    values,
    namespace,
    claimSecretRef: claimSecretRefForKey(key),
    claimSecretRefForKey,
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
