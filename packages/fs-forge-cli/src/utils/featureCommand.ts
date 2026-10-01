import { Args, Command, Flags } from '@oclif/core';

import { deriveFlags } from './deriveFlags.js';
import { resolveLatestFeatureSchema } from './featureSchema.js';
import { DEFAULT_FEATURE_SOURCE } from './featureSource.js';
import { runtimeFlags } from './runtimeFlags.js';

import type { FlagSpec } from './deriveFlags.js';

export const COMPONENT_ARG = {
  component: Args.string({ description: 'ComponentClaim name' }),
};

export const FEATURE_TARGET_RELATIONSHIP = {
  type: 'exactlyOne',
  args: ['component'],
  flags: ['file'],
};

export const FEATURE_READ_FLAGS = {
  file: Flags.string({
    char: 'f',
    description: 'Local ComponentClaim YAML file',
  }),
  org: Flags.string({
    description: 'GitHub organization containing the claims repo',
    env: 'FSCRT_ORG',
  }),
  json: Flags.boolean({ description: 'Output as JSON' }),
};

export const FEATURE_TARGET_FLAGS = {
  ...FEATURE_READ_FLAGS,
  commit: Flags.boolean({
    description: 'Commit the claim and dispatch provisioning',
  }),
  'no-wait': Flags.boolean({
    description: 'Skip waiting for the provision workflow to complete',
  }),
};

export const FEATURE_SCHEMA_FLAGS = {
  name: Flags.string({ description: 'Feature name', required: true }),
  version: Flags.string({
    description: 'Feature version to pin',
    exclusive: ['ref'],
  }),
  ref: Flags.string({
    description: 'Feature git reference to pin',
    exclusive: ['version'],
  }),
  repo: Flags.string({ description: 'Feature repository metadata' }),
  source: Flags.string({
    description: 'Feature source URL or local path',
    default: DEFAULT_FEATURE_SOURCE,
  }),
  refresh: Flags.boolean({ description: 'Refresh the cached Feature schema' }),
};

export const FEATURE_REFERENCE_SPECS: FlagSpec[] = [
  { path: 'name', type: 'string', required: true, multiple: false },
  { path: 'version', type: 'string', required: false, multiple: false },
  { path: 'ref', type: 'string', required: false, multiple: false },
  { path: 'repo', type: 'string', required: false, multiple: false },
];

function rawFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length) || undefined;
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value?.startsWith('-') ? undefined : value;
}

export async function resolveFeatureFlagSpecs(argv: string[]): Promise<
  | {
      schema: Record<string, unknown>;
      specs: FlagSpec[];
    }
  | undefined
> {
  const name = rawFlag(argv, 'name');
  if (!name) return undefined;
  const sourceFlag = rawFlag(argv, 'source');
  if (
    !sourceFlag &&
    argv.some((value) => value === '--source' || value === '--source=')
  ) {
    return undefined;
  }
  const source = sourceFlag ?? DEFAULT_FEATURE_SOURCE;
  const schema = await resolveLatestFeatureSchema(
    source,
    name,
    argv.includes('--refresh'),
  );
  return {
    schema,
    specs: [
      {
        path: 'args.json',
        type: 'string',
        required: false,
        description: 'Raw JSON object for all Feature args',
        multiple: false,
      },
      ...deriveFlags(schema, 'args'),
    ],
  };
}

export abstract class FeatureSchemaCommand extends Command {
  protected applyFeatureDefaults = true;
  protected featureSchema: Record<string, unknown> | undefined;
  protected featureSpecs: FlagSpec[] = [];

  protected async init(): Promise<void> {
    await super.init();
    const resolved = await resolveFeatureFlagSpecs(this.argv);
    if (!resolved) return;
    this.featureSchema = resolved.schema;
    this.featureSpecs = resolved.specs;
    const staticFlags = Object.fromEntries(
      Object.entries(this.ctor.flags).filter(
        ([name]) => !name.startsWith('args.'),
      ),
    );
    this.ctor.flags = {
      ...staticFlags,
      ...runtimeFlags(
        this.featureSpecs,
        this.applyFeatureDefaults &&
          !this.argv.some((value) => value.startsWith('--args.json')),
      ),
    };
    const command = this.ctor as typeof FeatureSchemaCommand & {
      FLAG_SPECS?: FlagSpec[];
    };
    command.FLAG_SPECS = [...FEATURE_REFERENCE_SPECS, ...this.featureSpecs];
  }
}
