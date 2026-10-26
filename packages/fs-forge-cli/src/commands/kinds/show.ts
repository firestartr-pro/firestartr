import { Args, Command, Flags } from '@oclif/core';

import {
  CLAIM_KIND_OPTIONS,
  KIND_REGISTRY,
  normalizeKind,
  toKindCapabilityJson,
} from '../../claims/kindRegistry.js';

import type { KindCapability } from '../../claims/kindRegistry.js';

function text(value: string | null): string {
  return value === null ? 'none' : value;
}

function hydrationText(capability: KindCapability): string {
  const hydration = capability.hydration;
  if (!hydration) return 'none';
  return `${hydration.workflow} (inputs ${hydration.inputs.join(', ')}; key ${hydration.key})`;
}

function rows(capability: KindCapability): Array<[string, string]> {
  return [
    ['claims directory', text(capability.claimsDirectory)],
    ['requires --path', capability.requiresPath ? 'yes' : 'no'],
    ['catalog only', capability.catalogOnly ? 'yes' : 'no'],
    ['org field', text(capability.orgField)],
    ['hydration', hydrationText(capability)],
    ['delete', text(capability.delete.workflow)],
    ['variants', capability.variants ? 'yes' : 'no'],
    ['preflight', text(capability.preflight)],
    ['state repo', text(capability.stateRepo)],
    [
      'references',
      capability.references.length === 0
        ? 'none'
        : capability.references.join(', '),
    ],
  ];
}

export default class KindsShow extends Command {
  static description = 'Show what one claim kind supports';

  static examples = [
    '<%= config.bin %> <%= command.id %> component',
    '<%= config.bin %> <%= command.id %> ComponentClaim --json',
  ];

  static args = {
    kind: Args.string({
      description: 'Claim kind (short ID; full *Claim names remain supported)',
      options: CLAIM_KIND_OPTIONS,
      required: true,
    }),
  };

  static flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(KindsShow);

    const kind = normalizeKind(args.kind);
    if (!kind) {
      this.error(
        `Unknown kind: ${args.kind}. Valid kinds: ${CLAIM_KIND_OPTIONS.join(', ')}`,
      );
    }
    const capability = KIND_REGISTRY[kind];

    if (flags.json) {
      process.stdout.write(
        `${JSON.stringify(toKindCapabilityJson(capability), null, 2)}\n`,
      );
      return;
    }

    const fields = rows(capability);
    const width = Math.max(...fields.map(([label]) => label.length));
    const lines = [
      `${capability.kind} (${capability.id})`,
      capability.summary,
      '',
      ...fields.map(([label, value]) => `${label.padEnd(width)}  ${value}`),
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}
