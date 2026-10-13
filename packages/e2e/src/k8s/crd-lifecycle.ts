import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as k8s from '@kubernetes/client-node';
import common from 'catalog_common';
import {
  createRetryableError,
  isRetryableError,
  pollUntil,
} from '../utils/async-control';
import { getStatusCode, type StatusCodeError } from '../errors/status-code';
import { expandManifestList, readManifestFile } from './manifests';

import type { K8sResource, KubeConfigProvider } from './types';

const CRD_MANIFEST_BASE_URL =
  'https://raw.githubusercontent.com/firestartr-pro/docs/refs/heads/main/site/raw/core/crds';
const CRD_MANIFEST_FILENAME = 'index.yaml';
const IN_BRANCH_CRDS_PATH = path.resolve(__dirname, '../../../k8s/src/crds');
const CRD_KIND = 'CustomResourceDefinition';
const FIRESTARTR_CRD_GROUP = 'firestartr.dev';
const DEFAULT_CRD_OPERATION_TIMEOUT_MS = 300000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const YAML_EXTENSIONS = ['.yaml', '.yml'];

type ApplyCrManifest = (inputPath: string) => Promise<void>;

type CrdApplyOptions = {
  getKubeConfig: KubeConfigProvider;
  applyCr: ApplyCrManifest;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCrdNames(crdNames: string[]): string[] {
  return [...new Set(crdNames.filter((name) => name.trim().length > 0))].sort(
    (a, b) => a.localeCompare(b),
  );
}

function getCrdGroup(resource: K8sResource): string | undefined {
  if (!isRecord(resource.spec)) return undefined;
  const group = resource.spec.group;
  return typeof group === 'string' ? group : undefined;
}

function buildCrdManifestUrl(version: string): string {
  return `${CRD_MANIFEST_BASE_URL}/${version}/${CRD_MANIFEST_FILENAME}`;
}

async function collectFirestartrCrdNames(inputPath: string): Promise<string[]> {
  const files = common.io.getFileListRecursively(
    inputPath,
    [],
    YAML_EXTENSIONS,
  );
  const names = new Set<string>();

  for (const file of files) {
    const parsed = await readManifestFile(file);
    const objects = expandManifestList(parsed);

    for (const resource of objects) {
      if (resource.kind !== CRD_KIND) continue;
      if (getCrdGroup(resource) !== FIRESTARTR_CRD_GROUP) continue;

      const name = resource.metadata?.name?.trim();
      if (name) {
        names.add(name);
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

async function waitForCrdEstablished(
  api: k8s.ApiextensionsV1Api,
  crdName: string,
  timeoutMs: number,
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        const response = await api.readCustomResourceDefinition({
          name: crdName,
        });
        const conditions = response.status?.conditions ?? [];
        const established = conditions.find(
          (condition) =>
            condition.type === 'Established' &&
            String(condition.status) === 'True',
        );

        return Boolean(established);
      } catch (err) {
        const statusCode = getStatusCode(err as StatusCodeError);
        if (
          statusCode !== undefined &&
          statusCode < 500 &&
          statusCode !== 404
        ) {
          throw new Error(
            `Failed to check established condition for CRD ${crdName}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        throw createRetryableError(err);
      }
    },
    {
      timeoutMs,
      intervalMs: DEFAULT_POLL_INTERVAL_MS,
      isDone: (established) => established,
      shouldRetryError: isRetryableError,
      createTimeoutError: () =>
        new Error(
          `Timed out waiting for CRD ${crdName} to become Established after ${timeoutMs}ms`,
        ),
    },
  );
}

async function waitForCrdsEstablished(
  getKubeConfig: KubeConfigProvider,
  crdNames: string[],
  timeoutMs: number,
): Promise<void> {
  const names = normalizeCrdNames(crdNames);
  if (names.length < 1) {
    return;
  }

  const api = getKubeConfig().makeApiClient(k8s.ApiextensionsV1Api);

  for (const crdName of names) {
    await waitForCrdEstablished(api, crdName, timeoutMs);
  }
}

export async function applyVersionedFirestartrCrds(
  options: CrdApplyOptions & { version: string },
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CRD_OPERATION_TIMEOUT_MS;
  const normalizedVersion = options.version.trim();
  if (!normalizedVersion) {
    throw new Error('CRD version must be a non-empty string.');
  }

  const manifestUrl = buildCrdManifestUrl(normalizedVersion);
  common.logger.info(`Applying Firestartr CRDs version=${normalizedVersion}`);
  let response: Response;

  try {
    response = await fetch(manifestUrl);
  } catch (err) {
    throw new Error(
      `Failed to fetch CRD manifest ${manifestUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `CRD manifest URL not found for version '${normalizedVersion}': ${manifestUrl} (status ${response.status})`,
    );
  }

  const manifestContent = await response.text();
  if (!manifestContent.trim()) {
    throw new Error(
      `CRD manifest for version '${normalizedVersion}' is empty: ${manifestUrl}`,
    );
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-crds-version-'));
  const tempFileVersion = normalizedVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
  const manifestPath = path.join(tempDir, `${tempFileVersion}-index.yaml`);

  try {
    await fs.writeFile(manifestPath, manifestContent, 'utf-8');

    const crdNames = await collectFirestartrCrdNames(manifestPath);
    if (crdNames.length < 1) {
      throw new Error(
        `No Firestartr CRDs found in manifest for version '${normalizedVersion}': ${manifestUrl}`,
      );
    }

    await options.applyCr(manifestPath);
    await waitForCrdsEstablished(options.getKubeConfig, crdNames, timeoutMs);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function applyInBranchFirestartrCrds(
  options: CrdApplyOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CRD_OPERATION_TIMEOUT_MS;
  common.logger.info('Applying Firestartr CRDs version=main');
  const crdNames = await collectFirestartrCrdNames(IN_BRANCH_CRDS_PATH);
  if (crdNames.length < 1) {
    throw new Error('No Firestartr CRDs found in in-branch CRD manifests.');
  }

  await options.applyCr(IN_BRANCH_CRDS_PATH);
  await waitForCrdsEstablished(options.getKubeConfig, crdNames, timeoutMs);
}
