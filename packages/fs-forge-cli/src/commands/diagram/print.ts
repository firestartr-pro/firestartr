import { Command, Flags } from '@oclif/core';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { setSchemasDir, validateClaim } from '../../utils/ajvValidation.js';
import { renderRelationGraph } from '../../lib/relationMap.js';

import type { RelationGraph } from '../../lib/relationMap.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default class DiagramPrint extends Command {
  static description =
    'Render an arbitrary relation graph (nodes/edges JSON) as a tree, using the same graphics as `discovery map`';

  static examples = [
    '<%= config.bin %> <%= command.id %> --file graph.json',
    'cat graph.json | <%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --file graph.json --ascii',
  ];

  static flags = {
    file: Flags.string({
      char: 'f',
      description:
        'Path to a JSON file with a relation graph ({ nodes, edges }); reads stdin if omitted',
    }),
    ascii: Flags.boolean({ description: 'Use ASCII icons instead of emoji' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DiagramPrint);

    let raw: string;
    try {
      raw = flags.file ? await readFile(flags.file, 'utf8') : await readStdin();
    } catch (err) {
      this.error(`Unable to read input: ${(err as Error).message}`);
    }

    let graph: unknown;
    try {
      graph = JSON.parse(raw);
    } catch (err) {
      this.error(`Invalid JSON input: ${(err as Error).message}`);
    }

    setSchemasDir(join(this.config.root, 'schemas'));
    const result = await validateClaim(
      graph as Record<string, unknown>,
      'RelationGraph',
    );
    if (!result.valid) {
      this.error(`Invalid relation graph:\n${result.errors.join('\n')}`);
    }

    for (const line of renderRelationGraph(graph as RelationGraph, {
      ascii: flags.ascii,
    })) {
      process.stdout.write(`${line}\n`);
    }
  }
}
