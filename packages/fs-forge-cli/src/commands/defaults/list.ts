import { Command, Flags } from '@oclif/core';

import { ClaimsClient } from '../../claims/client.js';
import { resolveDefaultsFile } from '../../claims/defaults.js';
import { requireOrg } from '../../mutations/support.js';

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class DefaultsList extends Command {
  static description =
    'List which claim kinds have defaults defined in the claims repo';

  static examples = [
    '<%= config.bin %> <%= command.id %> --org my-org',
    '<%= config.bin %> <%= command.id %> --org my-org --json',
  ];

  static flags = {
    org: Flags.string({
      description: 'GitHub organization containing the claims repo',
      default: async () => process.env.FSCRT_ORG,
    }),
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DefaultsList);
    const org = requireOrg(flags.org);

    const client = new ClaimsClient(org);
    const defaults = await resolveDefaultsFile(client);
    const kinds = (defaults ? Object.keys(defaults) : [])
      .filter(
        (kind) =>
          typeof defaults?.[kind] === 'object' && defaults[kind] !== null,
      )
      .sort();

    if (flags.json) {
      writeLine(JSON.stringify({ org, kinds }, null, 2));
      return;
    }

    if (kinds.length === 0) return;

    const kindW = Math.max(...kinds.map((kind) => kind.length), 4);
    writeLine('KIND'.padEnd(kindW));
    for (const kind of kinds) {
      writeLine(kind.padEnd(kindW));
    }
  }
}
