import fs from 'node:fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import fjp from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

import common from 'catalog_common';

import log from '../logger';

const DEFAULT_BASE_CLAIMS_PATH = path.join(
  __dirname,
  '../../__tests__/fixtures/base_claims',
);
const baseCrs = path.join(__dirname, '../../__tests__/fixtures/base_crs');

export type JsonPrimitive = string | number | boolean | null;

export type JsonObject = {
  [key: string]: JsonValue;
};

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonDocument = JsonObject | JsonValue[];

export type JsonPatchOperation = Operation;

export type CreateTestContextOptions = {
  paths?: string[];
  onlyFiles?: string[];
  baseClaimsPath?: string;
};

export interface TestContext {
  getClaimsDir: () => string;
  getBaseCrsDir: () => string;
  getCatalogOutDir: () => string;
  getResourcesOutDir: () => string;
  getInitializersDir: () => string;
  getPreviousCRsDir: () => string;
  getSourcePath: (item: string) => Promise<string>;
  duplicateFile: (file: string, copyName: string) => Promise<void>;
  /** Copies a fixture file (by stem name) from base_claims into the temp dir. */
  addFile: (file: string) => Promise<void>;
  restart: () => Promise<TestContext>;
  destroy: () => Promise<void>;
  applyPatches: (file: string, patches: JsonPatchOperation[]) => Promise<void>;
  getFilePath: (file: string) => Promise<string>;
  getFile: (file: string) => Promise<string>;
  removeFile: (file: string) => Promise<void>;
  getRenderedCRPath: (
    kind: string,
    name: string,
    basePath?: string,
  ) => Promise<string | undefined>;
  getRenderedCR: (
    kind: string,
    name: string,
    basePath?: string,
  ) => Promise<string | undefined>;
  getRenderedCatalogCR: (
    kind: string,
    name: string,
  ) => Promise<string | undefined>;
  fromYaml: (data: string) => JsonDocument;
  applyPatchToPreviousCR: (
    kind: string,
    name: string,
    op: JsonPatchOperation,
    basePath?: string,
  ) => Promise<void>;
  testRenderedCR: (
    kind: string,
    name: string,
    op: JsonPatchOperation,
    basePath?: string,
  ) => Promise<boolean>;
  createInitializers: (initializers: JsonDocument) => void;
}

export async function createTestContext(
  opts: CreateTestContextOptions,
): Promise<TestContext> {
  const baseClaimsPath = opts.baseClaimsPath ?? DEFAULT_BASE_CLAIMS_PATH;
  let sourcePaths: string[] = [];

  if (opts.paths) {
    sourcePaths = await prepareSourcePaths(opts.paths, baseClaimsPath);
  } else if (opts.onlyFiles) {
    sourcePaths = await prepareFilesPaths(opts.onlyFiles, baseClaimsPath);
  } else {
    sourcePaths = [baseClaimsPath];
  }

  return createTestDir(sourcePaths, baseClaimsPath);
}

async function createTestDir(
  sourcePaths: string[],
  baseClaimsPath: string,
  tempDir = '',
): Promise<TestContext> {
  if (!tempDir) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'temp-'));
  }

  await fs.mkdir(tempDir, { recursive: true });

  const catalogOutDir = await fs.mkdtemp(path.join(os.tmpdir(), '.catalog-'));
  const resourcesOutDir = await fs.mkdtemp(
    path.join(os.tmpdir(), '.resources-'),
  );
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), '.config-'));
  const previousCRsDir = await fs.mkdtemp(
    path.join(os.tmpdir(), '.previous-crs-'),
  );

  await fs.mkdir(path.join(configDir, 'initializers'));
  await fs.cp(baseCrs, previousCRsDir, { recursive: true });

  try {
    for (const sourcePath of sourcePaths) {
      const fileName = path.basename(sourcePath);
      const destPath = path.join(tempDir, fileName);

      // Check if the source path is a directory or file
      const stats = await fs.stat(sourcePath);

      if (stats.isDirectory()) {
        // Recursively copy directory
        await fs.cp(sourcePath, destPath, { recursive: true });
      } else {
        // Copy file
        await fs.copyFile(sourcePath, destPath);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detailedMessage = `Failed to prepare test fixtures in temporary directory: ${message}`;
    console.error(detailedMessage);
    throw new Error(detailedMessage);
  }

  return {
    getClaimsDir: () => tempDir,

    getBaseCrsDir: () => {
      return path.join(__dirname, '../../__tests__/fixtures/base_crs');
    },

    getCatalogOutDir: () => catalogOutDir,

    getResourcesOutDir: () => resourcesOutDir,

    getInitializersDir: () => path.join(configDir, 'initializers'),

    getPreviousCRsDir: () => previousCRsDir,

    getSourcePath: async function (item: string) {
      return path.join(tempDir, item);
    },

    duplicateFile: async function (file: string, copyName: string) {
      if (file === copyName) {
        throw new Error(
          `Cannot duplicate file '${file}': the copy name must differ from the original file name`,
        );
      }

      const sourceFullPath = await this.getFilePath(file);

      const copyFullPath = sourceFullPath.replace(file, copyName);

      await fs.copyFile(sourceFullPath, copyFullPath);
    },

    addFile: async function (file: string) {
      const sourcePaths = await prepareFilesPaths([file], baseClaimsPath);
      if (sourcePaths.length < 1) {
        throw new Error(
          `File not found under base claims path '${baseClaimsPath}': ${file}`,
        );
      }
      const fileName = path.basename(sourcePaths[0]);
      const destPath = path.join(tempDir, fileName);
      await fs.copyFile(sourcePaths[0], destPath);
    },

    restart: async function () {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(catalogOutDir, { recursive: true, force: true });
      await fs.rm(resourcesOutDir, { recursive: true, force: true });
      await fs.rm(previousCRsDir, { recursive: true, force: true });

      log.info(`Restarted context in ${tempDir}`);

      return await createTestDir(sourcePaths, baseClaimsPath, tempDir);
    },

    destroy: async function () {
      await fs.rm(tempDir, { recursive: true, force: true });
      await fs.rm(catalogOutDir, { recursive: true, force: true });
      await fs.rm(resourcesOutDir, { recursive: true, force: true });
      await fs.rm(configDir, { recursive: true, force: true });
      await fs.rm(previousCRsDir, { recursive: true, force: true });
    },

    applyPatches: async function (file: string, patches: JsonPatchOperation[]) {
      const filePath = await this.getFilePath(file);

      const fileContents = fsSync.readFileSync(filePath, 'utf-8');
      let claim;

      try {
        claim = this.fromYaml(fileContents);
      } catch (err: unknown) {
        const originalMessage =
          err instanceof Error ? err.message : String(err);
        throw new Error(
          `Failed to parse YAML file at ${filePath}: ${originalMessage}`,
        );
      }

      fsSync.writeFileSync(
        filePath,

        common.io.toYaml(fjp.applyPatch(claim, patches).newDocument),
      );
    },

    getFilePath: async function (file: string) {
      const filePath = await prepareFilesPaths([file], tempDir);

      if (filePath.length < 1) {
        throw new Error(`File not found: ${file} in ${tempDir}`);
      }

      return filePath[0];
    },

    getFile: async function (file: string) {
      const filePath = await prepareFilesPaths([file], tempDir);

      if (filePath.length < 1)
        throw new Error(`File not found: ${file} in ${tempDir}`);

      const data = await fs.readFile(filePath[0], { encoding: 'utf-8' });

      return data;
    },

    removeFile: async function (file: string) {
      const filePath = await prepareFilesPaths([file], tempDir);

      if (filePath.length < 1)
        throw new Error(`File not found: ${file} in ${tempDir}`);

      await fs.rm(filePath[0]);
    },

    getRenderedCRPath: async function (
      kind: string,
      name: string,
      basePath = resourcesOutDir,
    ): Promise<string | undefined> {
      try {
        const entries = await fs.readdir(basePath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.includes(kind) && entry.name.includes(name)) {
            return path.join(basePath, entry.name);
          }
        }

        return undefined;
      } catch (err) {
        throw new Error(`getRenderedCR: ${err}`);
      }
    },

    getRenderedCR: async function (
      kind: string,
      name: string,
      basePath = resourcesOutDir,
    ): Promise<string | undefined> {
      try {
        const entries = await fs.readdir(basePath, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.name.includes(kind) && entry.name.includes(name)) {
            return await fs.readFile(path.join(basePath, entry.name), {
              encoding: 'utf-8',
            });
          }
        }

        return undefined;
      } catch (err) {
        throw new Error(`getRenderedCR: ${err}`);
      }
    },

    getRenderedCatalogCR: async function (
      kind: string,
      name: string,
    ): Promise<string | undefined> {
      return this.getRenderedCR(kind, name, catalogOutDir);
    },

    fromYaml(data: string): JsonDocument {
      return common.io.fromYaml(data) as JsonDocument;
    },

    applyPatchToPreviousCR: async function (
      kind: string,
      name: string,
      op: JsonPatchOperation,
      basePath = previousCRsDir,
    ) {
      const cr = await this.getRenderedCR(kind, name, basePath);
      const crPath = await this.getRenderedCRPath(kind, name, basePath);

      if (!cr || !crPath) {
        throw new Error(
          `Rendered CR not found for ${kind}/${name} in ${basePath}`,
        );
      }

      const modifiedCr = fjp.applyOperation(
        this.fromYaml(cr),

        op,
      ).newDocument;

      fsSync.writeFileSync(
        crPath,

        common.io.toYaml(modifiedCr),
      );
    },

    testRenderedCR: async function (
      kind: string,
      name: string,
      op: JsonPatchOperation,
      basePath = resourcesOutDir,
    ) {
      const renderedCr = await this.getRenderedCR(kind, name, basePath);

      if (!renderedCr) {
        throw new Error(
          `Rendered CR not found for ${kind}/${name} in ${basePath}`,
        );
      }

      return fjp.applyOperation(
        this.fromYaml(renderedCr),

        op,
      ).test;
    },

    createInitializers(initializers: JsonDocument) {
      fsSync.writeFileSync(
        path.join(configDir, 'initializers', 'claims_defaults.yaml'),

        common.io.toYaml(initializers),
      );
    },
  };
}

async function prepareSourcePaths(
  paths: string[],
  baseClaimsPath: string,
): Promise<string[]> {
  const sourcePaths: string[] = [];

  for (const onePath of paths) {
    sourcePaths.push(path.join(baseClaimsPath, onePath));
  }

  for (const sourcePath of sourcePaths) {
    try {
      await fs.access(sourcePath);
    } catch (err) {
      throw new Error(`Source path does not exist: ${sourcePath}`);
    }
  }

  return sourcePaths;
}

async function prepareFilesPaths(
  onlyFiles: string[],
  startPath = DEFAULT_BASE_CLAIMS_PATH,
): Promise<string[]> {
  const sourcePaths: string[] = [];

  try {
    await fs.access(startPath);
    await walkDir(startPath, sourcePaths, onlyFiles);

    return sourcePaths;
  } catch (error) {
    console.error(`Error listing files in ${startPath}:`, error);
    throw error;
  }
}

// Recursively walk the directory
async function walkDir(
  currentPath: string,
  sourcePaths: string[],
  onlyFiles: string[],
): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      await walkDir(fullPath, sourcePaths, onlyFiles);
    } else if (entry.isFile()) {
      const fileNameWithoutExt = path.parse(entry.name).name;
      if (onlyFiles.includes(fileNameWithoutExt)) {
        sourcePaths.push(fullPath);
      }
    }
  }
}
