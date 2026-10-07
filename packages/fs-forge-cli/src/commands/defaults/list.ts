import { Command, Flags } from '@oclif/core';

import { claimsRepo } from '../../claims/claimsRepo.js';
import { createGitHubApi } from '../../github/index.js';
import { resolveDefaultsFile } from '../../claims/defaults.js';
import { ORG_FLAG, requireOrg } from '../../mutations/support.js';

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
    org: ORG_FLAG,
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(DefaultsList);
    const org = requireOrg(flags.org);

    const repo = claimsRepo(createGitHubApi(), org);
    const defaults = await resolveDefaultsFile(repo);
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
