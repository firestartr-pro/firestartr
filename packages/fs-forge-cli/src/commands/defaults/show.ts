import { Args, Command, Flags } from '@oclif/core';

import { KIND_CAPABILITIES, kindById } from '../../claims/kindRegistry.js';
import { claimsRepo } from '../../claims/claimsRepo.js';
import { createGitHubApi } from '../../github/index.js';
import { resolveDefaultsFile } from '../../claims/defaults.js';
import { serializeClaim } from '../../claims/keyOrdering.js';
import { ORG_FLAG, requireOrg } from '../../mutations/support.js';

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class DefaultsShow extends Command {
  static description =
    'Show the claim defaults for a kind from the claims repo';

  static examples = [
    '<%= config.bin %> <%= command.id %> component --org my-org',
  ];

  static args = {
    kind: Args.string({
      description: 'Claim kind id (e.g. component)',
      required: true,
    }),
  };

  static flags = {
    org: ORG_FLAG,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DefaultsShow);
    const org = requireOrg(flags.org);

    const capability = kindById(args.kind);
    if (!capability) {
      this.error(
        `Unknown claim kind: ${args.kind}. Valid kinds: ${KIND_CAPABILITIES.map(
          (entry) => entry.id,
        ).join(', ')}`,
      );
    }
    const kind = capability.kind;

    const repo = claimsRepo(createGitHubApi(), org);
    const defaults = await resolveDefaultsFile(repo);
    const entry = defaults?.[kind];

    writeLine(serializeClaim((entry ?? {}) as Record<string, unknown>));
  }
}
