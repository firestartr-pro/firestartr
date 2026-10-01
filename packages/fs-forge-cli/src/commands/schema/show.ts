import { Args, Command } from '@oclif/core';
import { readFile } from 'fs/promises';
import { join } from 'path';

import {
  isSchemaContractName,
  SCHEMA_CONTRACTS,
} from '../../schema/contracts.js';

export default class SchemaShow extends Command {
  static description = 'Print a machine-readable output contract verbatim';

  static examples = [
    '<%= config.bin %> <%= command.id %> CommandHelpJson',
    '<%= config.bin %> <%= command.id %> RelationGraph',
  ];

  static args = {
    name: Args.string({
      description: 'Contract name',
      required: true,
    }),
  };

  static flags = {};

  async run(): Promise<void> {
    const { args } = await this.parse(SchemaShow);
    if (!isSchemaContractName(args.name)) {
      this.error(
        `Unknown schema: ${args.name}. Valid schemas: ${SCHEMA_CONTRACTS.join(', ')}`,
      );
    }

    try {
      const contents = await readFile(
        join(this.config.root, 'schemas', `${args.name}.json`),
        'utf8',
      );
      process.stdout.write(contents);
    } catch (error) {
      this.error(
        `Unable to read schema ${args.name}: ${(error as Error).message}`,
      );
    }
  }
}
