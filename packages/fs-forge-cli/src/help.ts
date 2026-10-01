import { Command, Help } from '@oclif/core';

import {
  FEATURE_REFERENCE_SPECS,
  resolveFeatureFlagSpecs,
} from './utils/featureCommand.js';
import { runtimeFlags } from './utils/runtimeFlags.js';

import type { FlagSpec } from './utils/deriveFlags.js';

export default class CustomHelp extends Help {
  async showHelp(argv: string[]): Promise<void> {
    const found = await this.findCommand(argv);
    if (!found) return super.showHelp(argv);
    const command = await this.withDynamicFeatureFlags(found, argv);

    if (argv.includes('--json')) {
      await this.showCommandJSON(command);
      return;
    }
    return this.showCommandHelp(command);
  }

  private async findCommand(argv: string[]): Promise<Command.Loadable | null> {
    const flagIndex = argv.findIndex((value) => value.startsWith('-'));
    const values = argv.slice(0, flagIndex < 0 ? argv.length : flagIndex);
    const candidates = values.length === 0 ? argv : values;
    for (let length = candidates.length; length > 0; length--) {
      const command = await this.config.findCommand(
        candidates.slice(0, length).join(':'),
      );
      if (command) return command;
    }
    return null;
  }

  private async withDynamicFeatureFlags(
    command: Command.Loadable,
    argv: string[],
  ): Promise<Command.Loadable> {
    if (!['features:add', 'features:edit'].includes(command.id)) return command;
    const resolved = await resolveFeatureFlagSpecs(argv);
    if (!resolved) return command;

    const commandClass = (await command.load()) as typeof Command & {
      FLAG_SPECS?: FlagSpec[];
    };
    const staticFlags = Object.fromEntries(
      Object.entries(commandClass.flags).filter(
        ([name]) => !name.startsWith('args.'),
      ),
    );
    const applyDefaults =
      command.id === 'features:add' &&
      !argv.some((value) => value.startsWith('--args.json'));
    commandClass.flags = {
      ...staticFlags,
      ...runtimeFlags(resolved.specs, applyDefaults),
    };
    commandClass.FLAG_SPECS = [...FEATURE_REFERENCE_SPECS, ...resolved.specs];
    return {
      ...command,
      flags: commandClass.flags,
      load: async () => commandClass as Command.Class,
    };
  }

  private async showCommandJSON(command: Command.Loadable): Promise<void> {
    const cmdClass = (await command.load()) as typeof Command & {
      FLAG_SPECS?: FlagSpec[];
      helpRelationships?: unknown[];
      summary?: string;
    };
    const specs = new Map(
      (cmdClass.FLAG_SPECS ?? []).map((flag) => [flag.path, flag]),
    );
    const serializable = (value: unknown): Record<string, unknown> =>
      JSON.parse(
        JSON.stringify(value, (_key, item) =>
          typeof item === 'function' ? undefined : item,
        ),
      ) as Record<string, unknown>;

    const json = {
      id: command.id,
      aliases: command.aliases,
      description: cmdClass.description ?? '',
      summary: cmdClass.summary ?? '',
      usage: cmdClass.usage,
      examples: cmdClass.examples,
      args: Object.entries(command.args).map(([name, arg]) => ({
        name,
        ...serializable(arg),
        required: arg.required ?? false,
        multiple: arg.multiple ?? false,
      })),
      flags: Object.entries(command.flags).map(([path, flag]) => {
        const spec = specs.get(path);
        return {
          path,
          ...serializable(flag),
          type: spec?.type ?? (flag.type === 'boolean' ? 'boolean' : 'string'),
          required: spec?.required ?? flag.required ?? false,
          conditionalRequired: spec?.conditionalRequired ?? false,
          options:
            spec?.enumValues ?? ('options' in flag ? flag.options : undefined),
          default: spec?.defaultValue ?? flag.default,
          multiple:
            spec?.multiple ?? ('multiple' in flag ? flag.multiple : false),
        };
      }),
      relationships: cmdClass.helpRelationships ?? [],
    };

    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  }
}
