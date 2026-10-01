import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from '@jest/globals';
import {Command, Config} from '@oclif/core';
import {captureOutput} from '@oclif/test';
import {tmpdir} from 'os';
import {join} from 'path';
import YAML from 'yaml';

import CreateComponent from '../src/commands/create/component';
import FeaturesAdd from '../src/commands/features/add';
import FeaturesEdit from '../src/commands/features/edit';
import FeaturesList from '../src/commands/features/list';
import FeaturesRemove from '../src/commands/features/remove';
import Validate from '../src/commands/validate';
import CustomHelp from '../src/help';

const ROOT = process.cwd();
const ORIGINAL_CACHE_DIR = process.env.FS_FORGE_FEATURE_CACHE_DIR;
const FEATURE_SOURCE = join(ROOT, '__tests__', 'fixtures', 'feature-sources');
const MALICIOUS_FEATURE_SOURCE = join(
  ROOT,
  '__tests__',
  'fixtures',
  'malicious-feature-source',
);
const INVALID_FEATURE_CACHE = join(
  ROOT,
  '__tests__',
  'fixtures',
  'invalid-feature-cache',
);
const FEATURE_SCHEMA_FLAGS = ['--source', FEATURE_SOURCE, '--refresh'];
const COMPONENT = join(ROOT, '__tests__', 'fixtures', 'valid', 'component.yaml');
const COMPONENT_WITH_FEATURES = join(
  ROOT,
  '__tests__',
  'fixtures',
  'valid',
  'component-with-features.yaml',
);

beforeAll(() => {
  process.env.FS_FORGE_FEATURE_CACHE_DIR = join(
    tmpdir(),
    `fs-forge-feature-cache-${process.pid}`,
  );
});

afterAll(() => {
  if (ORIGINAL_CACHE_DIR === undefined) {
    delete process.env.FS_FORGE_FEATURE_CACHE_DIR;
  } else {
    process.env.FS_FORGE_FEATURE_CACHE_DIR = ORIGINAL_CACHE_DIR;
  }
});

afterEach(() => {
  process.exitCode = 0;
});

async function run(command: Command.Class, argv: string[]) {
  return captureOutput(() => command.run(argv, {root: ROOT}));
}

describe('Feature CRUD', () => {
  it('adds a Feature using a native schema-derived arg flag', async () => {
    const {stdout, error} = await run(FeaturesAdd, [
      '-f',
      COMPONENT,
      '--name',
      'feature_a',
      '--version',
      '1.1.0',
      '--args.enabled',
      '--args.ratio',
      '1.5',
      ...FEATURE_SCHEMA_FLAGS,
    ]);

    expect(error).toBeUndefined();
    const claim = YAML.parse(stdout);
    expect(claim.providers.github.features).toEqual([
      {
        name: 'feature_a',
        version: '1.1.0',
        args: {
          enabled: true,
          ratio: 1.5,
          tags: ['stable'],
          weights: [1.5],
          retries: [3],
        },
      },
    ]);
  });

  it('edits one Feature without removing sibling references', async () => {
    const {stdout, error} = await run(FeaturesEdit, [
      '-f',
      COMPONENT_WITH_FEATURES,
      '--name',
      'feature_a',
      '--ref',
      'next',
      '--no-args.enabled',
      ...FEATURE_SCHEMA_FLAGS,
    ]);

    expect(error).toBeUndefined();
    const features = YAML.parse(stdout).providers.github.features;
    expect(features).toEqual([
      {name: 'feature_a', ref: 'next', args: {enabled: false}},
      {name: 'other', ref: 'main', args: {}},
    ]);
  });

  it('carries existing args instead of applying schema defaults on edit', async () => {
    const {stdout, error} = await run(FeaturesEdit, [
      '-f',
      COMPONENT_WITH_FEATURES,
      '--name',
      'feature_a',
      '--ref',
      'next',
      ...FEATURE_SCHEMA_FLAGS,
    ]);

    expect(error).toBeUndefined();
    expect(YAML.parse(stdout).providers.github.features[0].args).toEqual({
      enabled: true,
    });
  });

  it('removes one Feature and lists the remaining references without a source', async () => {
    const removed = await run(FeaturesRemove, [
      '-f',
      COMPONENT_WITH_FEATURES,
      '--name',
      'feature_a',
      '--json',
    ]);
    expect(removed.error).toBeUndefined();
    expect(JSON.parse(removed.stdout).providers.github.features).toEqual([
      {name: 'other', ref: 'main', args: {}},
    ]);

    const listed = await run(FeaturesList, [
      '-f',
      COMPONENT_WITH_FEATURES,
      '--json',
    ]);
    expect(listed.error).toBeUndefined();
    expect(JSON.parse(listed.stdout)).toHaveLength(2);
  });

  it('enforces Feature existence and ComponentClaim identity', async () => {
    const duplicate = await run(FeaturesAdd, [
      '-f',
      COMPONENT_WITH_FEATURES,
      '--name',
      'feature_a',
      '--version',
      '1.1.0',
      ...FEATURE_SCHEMA_FLAGS,
    ]);
    expect(duplicate.error?.message).toContain('Feature already exists');

    const missing = await run(FeaturesRemove, [
      '-f',
      COMPONENT,
      '--name',
      'feature_a',
    ]);
    expect(missing.error?.message).toContain('Feature not found');

    const group = join(ROOT, '__tests__', 'fixtures', 'valid', 'group.yaml');
    const wrongKind = await run(FeaturesRemove, [
      '-f',
      group,
      '--name',
      'feature_a',
    ]);
    expect(wrongKind.error?.message).toContain(
      'Feature operations require a ComponentClaim',
    );
  });

  it('refreshes and reuses the latest Feature schema cache', async () => {
    const previousCache = process.env.FS_FORGE_FEATURE_CACHE_DIR;
    process.env.FS_FORGE_FEATURE_CACHE_DIR = join(
      tmpdir(),
      `fs-forge-feature-cache-${process.pid}`,
    );
    const source = FEATURE_SOURCE;
    try {
      const refreshed = await run(FeaturesAdd, [
        '-f',
        COMPONENT,
        '--name',
        'feature_a',
        '--version',
        '1.1.0',
        '--args.enabled',
        '--source',
        source,
        '--refresh',
      ]);
      expect(refreshed.error).toBeUndefined();

      const cached = await run(FeaturesAdd, [
        '-f',
        COMPONENT,
        '--name',
        'feature_a',
        '--version',
        '1.1.0',
        '--args.enabled',
        '--source',
        join(source, 'missing'),
      ]);
      expect(cached.error).toBeUndefined();
    } finally {
      process.env.FS_FORGE_FEATURE_CACHE_DIR = previousCache;
    }
  });

  it('refetches a corrupted Feature schema cache entry', async () => {
    const previousCache = process.env.FS_FORGE_FEATURE_CACHE_DIR;
    process.env.FS_FORGE_FEATURE_CACHE_DIR = INVALID_FEATURE_CACHE;
    try {
      const {error} = await run(FeaturesAdd, [
        '-f',
        COMPONENT,
        '--name',
        'feature_a',
        '--version',
        '1.1.0',
        '--source',
        join(FEATURE_SOURCE, 'missing'),
      ]);

      expect(error?.message).toContain('Unable to read feature source');
      expect(error?.message).not.toContain('cached schema');
    } finally {
      process.env.FS_FORGE_FEATURE_CACHE_DIR = previousCache;
    }
  });

  it('reports a missing source value before resolving a schema', async () => {
    const {error} = await run(FeaturesAdd, [
      '-f',
      COMPONENT,
      '--name',
      'feature_a',
      '--version',
      '1.1.0',
      '--source',
      '--refresh',
    ]);

    expect(error?.message).toContain('Flag --source expects a value');
  });

  it('does not retain schema-derived flags between Feature runs', async () => {
    await run(FeaturesAdd, [
      '-f',
      COMPONENT,
      '--name',
      'feature_a',
      '--version',
      '1.1.0',
      ...FEATURE_SCHEMA_FLAGS,
    ]);
    const {error} = await run(FeaturesAdd, [
      '-f',
      COMPONENT,
      '--name',
      'malicious',
      '--version',
      '1.0.0',
      '--args.enabled',
      '--source',
      MALICIOUS_FEATURE_SOURCE,
      '--refresh',
    ]);

    expect(error?.message).toContain('Nonexistent flag: --args.enabled');
  });

  it('does not retain schema-derived flags between help runs', async () => {
    const config = await Config.load({root: ROOT});
    const command = config.findCommand('features:add', {must: true});
    command.flags = FeaturesAdd.flags;
    command.load = async () => FeaturesAdd;
    const help = new CustomHelp(config);

    await captureOutput(() =>
      help.showHelp([
        'features',
        'add',
        '--help',
        '--name',
        'feature_a',
        '--source',
        FEATURE_SOURCE,
        '--refresh',
      ]),
    );
    const {stdout} = await captureOutput(() =>
      help.showHelp([
        'features',
        'add',
        '--help',
        '--name',
        'malicious',
        '--source',
        MALICIOUS_FEATURE_SOURCE,
        '--refresh',
      ]),
    );

    expect(stdout).not.toContain('--args.enabled');
  });

  it('serializes the complete create command surface as JSON help', async () => {
    const config = await Config.load({root: ROOT});
    const command = config.findCommand('create:component', {must: true});
    command.flags = CreateComponent.flags;
    command.load = async () => CreateComponent;
    const {stdout} = await captureOutput(() =>
      new CustomHelp(config).showHelp([
        'create',
        'component',
        '--help',
        '--json',
      ]),
    );
    const help = JSON.parse(stdout);

    expect(help.flags.map(({path}: {path: string}) => path)).toEqual(
      expect.arrayContaining(['name', 'feature']),
    );
    expect(help.flags.map(({path}: {path: string}) => path)).not.toContain(
      'diff',
    );
    expect(help.flags.map(({path}: {path: string}) => path)).not.toContain(
      'ascii',
    );
    expect(help.flags.map(({path}: {path: string}) => path)).not.toContain(
      'kind',
    );
    expect(
      help.flags.find(
        ({path}: {path: string}) => path === 'providers.github.name',
      ),
    ).toMatchObject({required: false, conditionalRequired: true});
  });

  it('serializes Feature target and pin relationships as JSON help', async () => {
    const config = await Config.load({root: ROOT});
    const command = config.findCommand('features:add', {must: true});
    command.flags = FeaturesAdd.flags;
    command.load = async () => FeaturesAdd;
    const {stdout} = await captureOutput(() =>
      new CustomHelp(config).showHelp([
        'features',
        'add',
        '--help',
        '--json',
      ]),
    );
    const help = JSON.parse(stdout);

    expect(help.args).toEqual([
      expect.objectContaining({name: 'component', required: false}),
    ]);
    expect(help.relationships).toContainEqual({
      type: 'exactlyOne',
      args: ['component'],
      flags: ['file'],
    });
    expect(
      help.flags.find(({path}: {path: string}) => path === 'version'),
    ).toMatchObject({exactlyOne: ['version', 'ref']});
  });

  it('attaches an inline Feature while creating a ComponentClaim', async () => {
    const {stdout, error} = await run(CreateComponent, [
      '--name',
      'inline-component',
      '--owner',
      'group:platform',
      '--providers.github.name',
      'inline-component',
      '--providers.github.org',
      'my-org',
      '--providers.github.sync.enabled',
      '--providers.github.technology.stack',
      'node',
      '--providers.github.technology.version',
      '20',
      '--providers.github.branchStrategy.name',
      'gitflow',
      '--providers.github.visibility',
      'private',
      '--feature',
      'feature_a#main:{"enabled":true}',
    ]);

    expect(error).toBeUndefined();
    expect(stdout).toContain('name: feature_a');
    expect(stdout).toContain('ref: main');
    expect(stdout).toContain('enabled: true');
  });

  it('deep-validates attached Feature args', async () => {
    const invalid = join(
      ROOT,
      '__tests__',
      'fixtures',
      'invalid',
      'component-feature-args.yaml',
    );
    const {stdout, error} = await run(Validate, [
      '-f',
      invalid,
      ...FEATURE_SCHEMA_FLAGS,
    ]);

    expect(error).toBeDefined();
    expect(JSON.parse(stdout)[0]).toMatchObject({
      kind: 'ComponentClaim',
      valid: false,
    });
    expect(stdout).toContain('Feature feature_a');
  });

  it('preserves structural errors for malformed Feature references', async () => {
    const invalid = join(
      ROOT,
      '__tests__',
      'fixtures',
      'invalid',
      'component-malformed-features.yaml',
    );
    const {stdout, error} = await run(Validate, ['-f', invalid]);
    const result = JSON.parse(stdout)[0];

    expect(error).toBeDefined();
    expect(result).toMatchObject({kind: 'ComponentClaim', valid: false});
    expect(result.errors).toContain(
      '/providers/github/features must be array',
    );
    expect(result.errors).toContain(
      'providers.github.features must be an array',
    );
  });

  it('rejects prototype-polluting schema-derived paths', async () => {
    const {error} = await run(FeaturesAdd, [
      '-f',
      COMPONENT,
      '--name',
      'malicious',
      '--version',
      '1.0.0',
      '--args.__proto__.polluted',
      'yes',
      '--source',
      MALICIOUS_FEATURE_SOURCE,
      '--refresh',
    ]);

    expect(error?.message).toContain('Invalid flag path');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects args that do not match the latest Feature schema', async () => {
    const {error} = await run(FeaturesAdd, [
      '-f',
      COMPONENT,
      '--name',
      'feature_a',
      '--version',
      '1.1.0',
      '--args.json',
      '{"enabled":"yes"}',
      ...FEATURE_SCHEMA_FLAGS,
    ]);

    expect(error?.message).toContain('must be boolean');
  });
});
