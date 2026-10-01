import { Args, Command, Flags } from '@oclif/core';

import { ClaimsClient } from '../../claims/client.js';
import { resolveDefaultsFile } from '../../claims/defaults.js';
import { serializeClaim } from '../../claims/keyOrdering.js';
import { requireOrg } from '../../mutations/support.js';
import { CLAIM_KINDS } from '../kinds.js';

const KIND_BY_ID = new Map(CLAIM_KINDS.map(({ id, kind }) => [id, kind]));

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
    org: Flags.string({
      description: 'GitHub organization containing the claims repo',
      default: async () => process.env.FSCRT_ORG,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DefaultsShow);
    const org = requireOrg(flags.org);

    const kind = KIND_BY_ID.get(args.kind.toLowerCase());
    if (!kind) {
      this.error(
        `Unknown claim kind: ${args.kind}. Valid kinds: ${CLAIM_KINDS.map(
          (entry) => entry.id,
        ).join(', ')}`,
      );
    }

    const client = new ClaimsClient(org);
    const defaults = await resolveDefaultsFile(client);
    const entry = defaults?.[kind];

    writeLine(serializeClaim((entry ?? {}) as Record<string, unknown>));
  }
}
