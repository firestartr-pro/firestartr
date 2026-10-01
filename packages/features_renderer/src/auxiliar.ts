// src/auxiliar.ts
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import common from 'catalog_common';
import { slurpFile } from './common';
import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

/* ---------- Types ---------- */

export interface ConfigFile {
  dest: string;
  src: string;
  user_managed?: boolean;
  upgradable?: boolean;
  target_branch?: string;
}

export interface FeatureConfig {
  files?: ConfigFile[];
  claimPatches?: unknown[];
}

export interface ExpectedFile {
  localPath: string;
  repoPath: string;
  targetBranch: string;
  userManaged: boolean;
}

export interface Traceability {
  owner?: string;
  repo?: string;
  name?: string;
  version?: string;
  ref?: string;
  url?: string;
  sha?: string;
  tags?: string[];
}

export interface ExpectedOutput {
  files: ExpectedFile[];
  claimPatches: unknown[];
  traceability?: Traceability;
}

export interface RenderTest {
  name: string;
  cr?: string;
  claim?: string;
  args?: Record<string, unknown>;
}

export interface RenderTestsFile {
  tests: RenderTest[];
}

export interface RenderContext {
  /** Absolute path to the temp dir */
  getContextPath: () => string;
  /** Join a relative path inside the temp dir */
  join: (...p: string[]) => string;
  /** Read a file (raw / JSON / YAML) from the temp dir */
  getFile: <T = unknown>(
    relPath: string,
    opts?: { yaml?: boolean; json?: boolean },
  ) => Promise<T | string>;
  /** Absolute path of a file in the temp dir (no existence check) */
  getFilePath: (relPath: string) => string;
  /** Write a file (ensures parent dirs) */
  setFile: (
    relPath: string,
    contents: string | Buffer | NodeJS.ArrayBufferView,
  ) => Promise<void>;
  /** Whether a path exists in the temp dir */
  exists: (relPath: string) => Promise<boolean>;
  /** Convenience: read output.json from the temp dir */
  getOutputJson: <T = unknown>() => Promise<T>;
  /** List entries (name + isDir) in a subdirectory */
  list: (relPath?: string) => Promise<Array<{ name: string; isDir: boolean }>>;
  /** Optional cleanup */
  remove: () => Promise<void>;
}

const renderTestsSchema: Record<string, unknown> = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  additionalProperties: false,
  required: ['tests'],
  properties: {
    tests: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        anyOf: [{ required: ['cr'] }, { required: ['claim'] }],
        properties: {
          name: { type: 'string', minLength: 1 },
          cr: { type: 'string', minLength: 1 },
          claim: { type: 'string', minLength: 1 },
          args: { type: 'object' },
        },
      },
    },
  },
} as const;

const YAML_FILE_REGEX = /\.[yY]a?ml$/;

/* ---------- Core helpers ---------- */

export function formatAjvErrors(
  errors: ErrorObject[] | null | undefined,
): string {
  if (!errors || errors.length === 0) return 'Unknown schema error';
  return errors
    .map((e) => {
      const where =
        e.instancePath && e.instancePath.length ? e.instancePath : '/';
      const msg = e.message ?? 'validation error';
      return `- ${where} ${msg}`;
    })
    .join('\n');
}

function ensureUniqueTestNames(doc: RenderTestsFile) {
  const seen = new Set<string>();
  for (const t of doc.tests) {
    if (seen.has(t.name)) {
      throw new Error(`Duplicate test name "${t.name}" in render_tests.yaml`);
    }
    seen.add(t.name);
  }
}

function loadAndValidateRenderTests(featurePath: string): RenderTestsFile {
  const file = path.join(featurePath, 'render_tests.yaml');
  if (!fs.existsSync(file)) {
    throw new Error(`render_tests.yaml is required but not found at ${file}`);
  }

  const raw = loadYaml<unknown>(file);

  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  const validate = ajv.compile(renderTestsSchema);
  const ok = validate(raw);
  if (!ok) {
    throw new Error(
      `render_tests.yaml schema validation failed:\n${formatAjvErrors(validate.errors ?? [])}`,
    );
  }

  const doc = raw as RenderTestsFile;
  ensureUniqueTestNames(doc);

  return doc;
}

function resolveCrPath(featurePath: string, crRelPath: string): string {
  if (path.isAbsolute(crRelPath)) {
    throw new Error(
      `CR path must be relative to the feature root, got absolute: ${crRelPath}`,
    );
  }

  const resolved = path.resolve(featurePath, crRelPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `CR file not found (resolved from "${crRelPath}"): ${resolved}`,
    );
  }

  return resolved;
}

function resolveClaimPath(featurePath: string, claimRelPath: string): string {
  return resolveCrPath(featurePath, claimRelPath);
}

export function listYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read directory "${dir}": ${msg}`);
  }

  return entries
    .filter((e) => e.isFile() && YAML_FILE_REGEX.test(e.name))
    .map((e) => path.join(dir, e.name));
}

function loadYaml<T = unknown>(file: string): T {
  try {
    const configDataRaw: string = slurpFile(path.join(file));
    return common.io.fromYaml(configDataRaw) as T;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse YAML "${file}": ${msg}`);
  }
}

function ensureSafeTmpNames(name: string): void {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Test "name" must be a non-empty string');
  }
  if (name.length > 128) {
    throw new Error('Test "name" is too long (max 128 characters)');
  }
  if (path.isAbsolute(name)) {
    throw new Error(`Test "name" must be relative, got absolute: "${name}"`);
  }
  if (name.includes('..')) {
    throw new Error('Test "name" must not contain ".."');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(
      'Test "name" may only contain letters, numbers, ".", "_", or "-"',
    );
  }
}

async function mkNamedTmp(...names: string[]): Promise<string> {
  for (const name of names) {
    ensureSafeTmpNames(name);
  }

  const dir = path.join(os.tmpdir(), ...names);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

export async function mkTmp(prefix = 'feature-render-'): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

function buildExpectedOutput(
  config: FeatureConfig,
  renderDir: string,
): ExpectedOutput {
  const files: ExpectedFile[] = (config.files || []).map((f) => ({
    localPath: path.join(renderDir, f.dest),
    repoPath: f.dest,
    userManaged: f.user_managed ?? f.upgradable ?? false,
    targetBranch: f.target_branch ?? '',
  }));
  return {
    files,
    claimPatches: config.claimPatches || [],
    traceability: {},
  };
}

/* ---------- Context-style API for a render temp dir ---------- */

export async function createRenderContext(
  prefix = 'feature-render-',
): Promise<RenderContext> {
  const dir = await mkTmp(prefix);
  const join = (...p: string[]) => path.join(dir, ...p);

  return {
    getContextPath: () => dir,

    join,

    getFile: async <T = unknown>(
      relPath: string,
      {
        yaml: asYaml = false,
        json: asJson = false,
      }: { yaml?: boolean; json?: boolean } = {},
    ): Promise<T | string> => {
      const data = await fsp.readFile(join(relPath), 'utf8');

      if (asYaml) return common.io.fromYaml(data) as T;
      if (asJson) return JSON.parse(data) as T;
      return data;
    },

    getFilePath: (relPath: string): string => join(relPath),

    setFile: async (
      relPath: string,
      contents: string | Buffer | NodeJS.ArrayBufferView,
    ): Promise<void> => {
      await fsp.mkdir(path.dirname(join(relPath)), { recursive: true });
      await fsp.writeFile(join(relPath), contents);
    },

    exists: async (relPath: string): Promise<boolean> => {
      try {
        await fsp.access(join(relPath));
        return true;
      } catch {
        return false;
      }
    },

    getOutputJson: async <T = unknown>(): Promise<T> => {
      const p = join('output.json');
      const raw = await fsp.readFile(p, 'utf8');
      return JSON.parse(raw) as T;
    },

    list: async (
      relPath = '.',
    ): Promise<Array<{ name: string; isDir: boolean }>> => {
      const entries = await fsp.readdir(join(relPath), {
        withFileTypes: true,
      });
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    },

    remove: async (): Promise<void> => {
      await fsp.rm(dir, { recursive: true, force: true });
    },
  };
}

export default {
  mkNamedTmp,
  loadYaml,
  buildExpectedOutput,
  loadAndValidateRenderTests,
  resolveCrPath,
  resolveClaimPath,
};
