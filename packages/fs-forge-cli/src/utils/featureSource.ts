import { readFile } from 'fs/promises';
import { basename, dirname, resolve, sep } from 'path';

export const DEFAULT_FEATURE_SOURCE =
  'https://raw.githubusercontent.com/firestartr-pro/docs/main/site/raw/features';

const REQUEST_TIMEOUT_MS = 10_000;

export interface FeatureFile {
  name: string;
  url: string;
}

export interface Feature {
  name: string;
  version: string;
  files: FeatureFile[];
}

export interface FeatureIndex {
  features: Feature[];
}

export interface FeatureVersion {
  version: string;
  date: string;
  url: string;
}

export interface FeatureSource {
  readFeatureIndex(): Promise<FeatureIndex>;
  readFeatureVersions(name: string): Promise<FeatureVersion[]>;
  readFeatureSchema(
    name: string,
    version: string,
  ): Promise<Record<string, unknown>>;
  readFeatureDocument(
    name: string,
    filename: 'README.md' | 'CHANGELOG.md',
  ): Promise<string>;
}

interface LocalSourceRoot {
  kind: 'local';
  root: string;
}

interface HttpSourceRoot {
  kind: 'http';
  root: URL;
  index: URL;
}

type SourceRoot = LocalSourceRoot | HttpSourceRoot;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFeatureFile(value: unknown): value is FeatureFile {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.url === 'string'
  );
}

function isFeature(value: unknown): value is Feature {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    Array.isArray(value.files) &&
    value.files.every(isFeatureFile)
  );
}

function isFeatureVersion(value: unknown): value is FeatureVersion {
  return (
    isRecord(value) &&
    typeof value.version === 'string' &&
    typeof value.date === 'string' &&
    typeof value.url === 'string'
  );
}

function isHttpSource(source: string): boolean {
  return /^https?:\/\//.test(source);
}

function normalizeSource(source: string): SourceRoot {
  if (isHttpSource(source)) {
    const sourceUrl = new URL(source);
    const isIndex = sourceUrl.pathname.endsWith('/index.json');
    const root = isIndex ? new URL('.', sourceUrl) : new URL(sourceUrl);
    if (!isIndex && !root.pathname.endsWith('/')) {
      root.pathname += '/';
    }
    root.search = '';
    root.hash = '';
    return {
      kind: 'http',
      root,
      index: isIndex ? sourceUrl : new URL('index.json', root),
    };
  }

  return {
    kind: 'local',
    root: resolve(basename(source) === 'index.json' ? dirname(source) : source),
  };
}

function validateSegment(value: string, label: string): string {
  if (
    value === '.' ||
    value === '..' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
  ) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

function sourceLocation(root: SourceRoot, relativePath: string): string {
  if (root.kind === 'http') {
    const location =
      relativePath === 'index.json'
        ? root.index
        : new URL(relativePath, root.root);
    if (
      location.origin !== root.root.origin ||
      !location.pathname.startsWith(root.root.pathname)
    ) {
      throw new Error(`Path escapes feature source: ${relativePath}`);
    }
    return location.toString();
  }

  const location = resolve(root.root, relativePath);
  const rootPrefix = root.root.endsWith(sep) ? root.root : `${root.root}${sep}`;
  if (location !== root.root && !location.startsWith(rootPrefix)) {
    throw new Error(`Path escapes feature source: ${relativePath}`);
  }
  return location;
}

async function readSource(
  root: SourceRoot,
  relativePath: string,
): Promise<string> {
  const location = sourceLocation(root, relativePath);
  try {
    if (root.kind === 'http') {
      const response = await fetch(location, {
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    }
    return await readFile(location, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read feature source ${location}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readJson(
  root: SourceRoot,
  relativePath: string,
): Promise<unknown> {
  const content = await readSource(root, relativePath);
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Malformed JSON in ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function createFeatureSource(source: string): FeatureSource {
  const root = normalizeSource(source);

  async function readFeatureIndex(): Promise<FeatureIndex> {
    const index = await readJson(root, 'index.json');
    if (
      !isRecord(index) ||
      !Array.isArray(index.features) ||
      !index.features.every(isFeature)
    ) {
      throw new Error('Malformed feature index: expected a features array');
    }
    return { features: index.features };
  }

  async function readFeatureVersions(name: string): Promise<FeatureVersion[]> {
    const featureName = validateSegment(name, 'feature name');
    const versions = await readJson(root, `${featureName}/versions.json`);
    if (!Array.isArray(versions) || !versions.every(isFeatureVersion)) {
      throw new Error(`Malformed version history for feature ${featureName}`);
    }
    return versions;
  }

  async function readFeatureSchema(
    name: string,
    version: string,
  ): Promise<Record<string, unknown>> {
    const featureName = validateSegment(name, 'feature name');
    const featureVersion = validateSegment(version, 'feature version');
    const versionEntry = (await readFeatureVersions(featureName)).find(
      (entry) => entry.version === featureVersion,
    );
    if (!versionEntry) {
      throw new Error(
        `Unknown version for feature ${featureName}: ${featureVersion}`,
      );
    }
    if (root.kind === 'local' && isHttpSource(versionEntry.url)) {
      throw new Error('Local feature sources require relative schema URLs');
    }
    const schema = await readJson(root, versionEntry.url);
    if (!isRecord(schema)) {
      throw new Error(
        `Malformed schema for feature ${featureName}@${featureVersion}`,
      );
    }
    return schema;
  }

  async function readFeatureDocument(
    name: string,
    filename: 'README.md' | 'CHANGELOG.md',
  ): Promise<string> {
    const featureName = validateSegment(name, 'feature name');
    const index = await readFeatureIndex();
    const feature = index.features.find((entry) => entry.name === featureName);
    const file = feature?.files.find((entry) => entry.name === filename);
    return readSource(root, file?.url ?? `${featureName}/${filename}`);
  }

  return {
    readFeatureIndex,
    readFeatureVersions,
    readFeatureSchema,
    readFeatureDocument,
  };
}
