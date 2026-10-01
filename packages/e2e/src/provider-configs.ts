import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import common from 'catalog_common';
import { TF_BACKEND_PROVIDER_NAME, TF_PROVIDER_NAME } from './test-constants';

function parseBackendConfig(
  fileName: string,
  sourcePath: string,
  config: unknown,
) {
  if (typeof config !== 'string' || config.length < 1) {
    throw new Error(
      `Expected ${fileName} to contain a non-empty string spec.config in ${sourcePath}`,
    );
  }

  try {
    return JSON.parse(config) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Failed to parse spec.config JSON in ${sourcePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function prepareProviderConfigManifests(
  sourceDir: string,
  namespace: string,
): Promise<string> {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'e2e-provider-configs-'),
  );

  for (const fileName of ['kubernetes-backend.yaml', 'kubernetes.yaml']) {
    const sourcePath = path.join(sourceDir, fileName);
    const targetPath = path.join(tempDir, fileName);
    const content = await fs.readFile(sourcePath, 'utf-8');
    const manifest = common.io.fromYaml(content) as Record<string, unknown>;
    const metadata =
      typeof manifest.metadata === 'object' && manifest.metadata !== null
        ? (manifest.metadata as Record<string, unknown>)
        : {};

    const manifestName =
      fileName === 'kubernetes-backend.yaml'
        ? TF_BACKEND_PROVIDER_NAME
        : TF_PROVIDER_NAME;

    const spec =
      typeof manifest.spec === 'object' && manifest.spec !== null
        ? (manifest.spec as Record<string, unknown>)
        : {};

    if (fileName === 'kubernetes-backend.yaml') {
      const backendConfig = parseBackendConfig(
        fileName,
        sourcePath,
        spec.config,
      );
      spec.config = JSON.stringify({
        ...backendConfig,
        namespace,
      });
    }

    manifest.metadata = {
      ...metadata,
      name: manifestName,
      namespace,
    };
    manifest.spec = spec;

    await fs.writeFile(targetPath, common.io.toYaml(manifest), 'utf-8');
  }

  return tempDir;
}
