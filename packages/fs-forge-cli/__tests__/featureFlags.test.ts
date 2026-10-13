import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Command, Config } from '@oclif/core';
import { captureOutput } from '@oclif/test';
import { tmpdir } from 'os';
import { join } from 'path';

import FeaturesAdd from '../src/commands/features/add';
import FeaturesEdit from '../src/commands/features/edit';
import FeaturesList from '../src/commands/features/list';
import CustomHelp from '../src/help';

import type { FlagSpec } from '../src/utils/deriveFlags.js';

const ROOT = process.cwd();
const ORIGINAL_CACHE_DIR = process.env.FS_FORGE_FEATURE_CACHE_DIR;
const FEATURE_SOURCE = join(ROOT, '__tests__', 'fixtures', 'feature-sources');

type FeatureCommand = typeof Command & {
  FLAG_SPECS?: FlagSpec[];
};

function dynamicFlagDefault(
  command: FeatureCommand,
  path: string,
): unknown {
  const flags = command.flags as Record<string, { default?: unknown }>;
  return flags[path]?.default;
}

interface HelpFlag {
  path: string;
  default?: unknown;
  type?: string;
}

async function showHelp(
  id: string,
  commandClass: FeatureCommand,
  argv: string[],
): Promise<{ flags: HelpFlag[] }> {
  const config = await Config.load({ root: ROOT });
  const command = config.findCommand(id, { must: true });
  command.flags = commandClass.flags;
  command.load = async () => commandClass as Command.Class;
  const outcome = await captureOutput(() =>
    new CustomHelp(config).showHelp([...argv, '--help', '--json']),
  );
  if (outcome.error) throw outcome.error;
  return JSON.parse(outcome.stdout) as { flags: HelpFlag[] };
}

beforeAll(() => {
  process.env.FS_FORGE_FEATURE_CACHE_DIR = join(
    tmpdir(),
    `fs-forge-feature-flags-${process.pid}`,
  );
});

afterAll(() => {
  if (ORIGINAL_CACHE_DIR === undefined) {
    delete process.env.FS_FORGE_FEATURE_CACHE_DIR;
  } else {
    process.env.FS_FORGE_FEATURE_CACHE_DIR = ORIGINAL_CACHE_DIR;
  }
});

describe('dynamic Feature flags in help', () => {
  const featureArgs = [
    '--name',
    'feature_a',
    '--source',
    FEATURE_SOURCE,
    '--refresh',
  ];

  it('lists the schema-derived args.* flags for features:add', async () => {
    const help = await showHelp('features:add', FeaturesAdd, [
      'features',
      'add',
      ...featureArgs,
    ]);

    const paths = help.flags.map((flag) => flag.path);
    expect(paths).toContain('args.json');
    expect(paths).toContain('args.enabled');
    expect(paths).toContain('args.ratio');

    const enabled = help.flags.find((flag) => flag.path === 'args.enabled');
    expect(enabled?.type).toBe('boolean');
    expect(enabled?.default).toBe(false);
    // The shared applier installs the defaults on the command class too.
    expect(dynamicFlagDefault(FeaturesAdd, 'args.enabled')).toBe(false);
  });

  it('applies no defaults to features:edit', async () => {
    const help = await showHelp('features:edit', FeaturesEdit, [
      'features',
      'edit',
      ...featureArgs,
    ]);

    const paths = help.flags.map((flag) => flag.path);
    expect(paths).toContain('args.enabled');

    expect(dynamicFlagDefault(FeaturesEdit, 'args.enabled')).toBeUndefined();
  });

  it('keeps only the static flags without --name', async () => {
    const help = await showHelp('features:list', FeaturesList, [
      'features',
      'list',
    ]);

    const paths = help.flags.map((flag) => flag.path);
    expect(paths).toContain('json');
    expect(paths.some((path) => path.startsWith('args.'))).toBe(false);
  });
});
