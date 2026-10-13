import { Command, Flags } from '@oclif/core';

import { KIND_CAPABILITIES } from '../claims/kindRegistry.js';

function writeLine(value: string): void {
  process.stdout.write(value + '\n');
}

export default class Kinds extends Command {
  static description = 'List supported claim kinds';

  static flags = {
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Kinds);

    if (flags.json) {
      writeLine(
        JSON.stringify(
          KIND_CAPABILITIES.map(({ id, kind, summary }) => ({
            id,
            kind,
            description: summary,
          })),
          null,
          2,
        ),
      );
      return;
    }

    const idW = Math.max(...KIND_CAPABILITIES.map((k) => k.id.length), 2);
    const kindW = Math.max(...KIND_CAPABILITIES.map((k) => k.kind.length), 4);
    writeLine('ID'.padEnd(idW) + '  ' + 'KIND'.padEnd(kindW) + '  DESCRIPTION');
    for (const kind of KIND_CAPABILITIES) {
      writeLine(
        `${kind.id.padEnd(idW)}  ${kind.kind.padEnd(kindW)}  ${kind.summary}`,
      );
    }
  }
}
