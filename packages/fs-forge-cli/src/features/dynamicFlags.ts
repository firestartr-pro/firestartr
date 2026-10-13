import { Command } from '@oclif/core';

import { deriveFlags } from '../utils/deriveFlags.js';
import { resolveLatestFeatureSchema } from '../utils/featureSchema.js';
import { DEFAULT_FEATURE_SOURCE } from '../utils/featureSource.js';
import { runtimeFlags } from '../utils/runtimeFlags.js';

import type { FlagSpec } from '../utils/deriveFlags.js';

/** The fixed Feature-reference fields every Feature command accepts. */
export const FEATURE_REFERENCE_SPECS: FlagSpec[] = [
  { path: 'name', type: 'string', required: true, multiple: false },
  { path: 'version', type: 'string', required: false, multiple: false },
  { path: 'ref', type: 'string', required: false, multiple: false },
  { path: 'repo', type: 'string', required: false, multiple: false },
];

export interface ResolvedFeatureArgs {
  schema: Record<string, unknown>;
  specs: FlagSpec[];
}

function rawFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length) || undefined;
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value?.startsWith('-') ? undefined : value;
}

/** Resolves the schema-derived `args.*` flags for `--name <feature>`. */
export async function resolveFeatureArgs(
  argv: string[],
): Promise<ResolvedFeatureArgs | undefined> {
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

/**
 * Installs the static flags plus the schema-derived `args.*` flags on a
 * command class. Shared by `FeatureSchemaCommand.init` and the Help class so
 * `fs-forge help features:add --name x` shows the same flags as a real run.
 */
export function applyDynamicFeatureFlags(
  commandClass: typeof Command & { FLAG_SPECS?: FlagSpec[] },
  argv: string[],
  options: { applyDefaults: boolean; resolved: ResolvedFeatureArgs },
): void {
  const staticFlags = Object.fromEntries(
    Object.entries(commandClass.flags).filter(
      ([name]) => !name.startsWith('args.'),
    ),
  );
  commandClass.flags = {
    ...staticFlags,
    ...runtimeFlags(
      options.resolved.specs,
      options.applyDefaults &&
        !argv.some((value) => value.startsWith('--args.json')),
    ),
  };
  commandClass.FLAG_SPECS = [
    ...FEATURE_REFERENCE_SPECS,
    ...options.resolved.specs,
  ];
}
