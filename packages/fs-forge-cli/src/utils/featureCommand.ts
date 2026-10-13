import { Args, Command, Flags } from '@oclif/core';

import {
  applyDynamicFeatureFlags,
  resolveFeatureArgs,
} from '../features/dynamicFlags.js';
import { ORG_FLAG } from '../mutations/support.js';
import { DEFAULT_FEATURE_SOURCE } from './featureSource.js';

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
  org: ORG_FLAG,
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

export abstract class FeatureSchemaCommand extends Command {
  /**
   * A static getter rather than a field: oclif's manifest builder copies
   * enumerable statics into the published oclif.manifest.json.
   */
  static get applyFeatureDefaults(): boolean {
    return true;
  }

  protected featureSchema: Record<string, unknown> | undefined;
  protected featureSpecs: FlagSpec[] = [];

  protected async init(): Promise<void> {
    await super.init();
    const resolved = await resolveFeatureArgs(this.argv);
    if (!resolved) return;
    this.featureSchema = resolved.schema;
    this.featureSpecs = resolved.specs;
    applyDynamicFeatureFlags(
      this.ctor as typeof Command & { FLAG_SPECS?: FlagSpec[] },
      this.argv,
      {
        applyDefaults: (this.ctor as typeof FeatureSchemaCommand)
          .applyFeatureDefaults,
        resolved,
      },
    );
  }
}
