import { Command, Flags } from '@oclif/core';

import { SCHEMA_CONTRACTS } from '../../schema/contracts.js';

export default class SchemaList extends Command {
  static description = 'List machine-readable fs-forge output contracts';

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaList);

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(SCHEMA_CONTRACTS, null, 2)}\n`);
      return;
    }

    process.stdout.write('NAME\n');
    for (const name of SCHEMA_CONTRACTS) process.stdout.write(`${name}\n`);
  }
}
