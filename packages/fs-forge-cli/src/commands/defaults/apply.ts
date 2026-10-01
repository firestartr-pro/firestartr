import { Args, Command, Flags } from '@oclif/core';
import { readFile } from 'fs/promises';

import { ClaimsClient } from '../../claims/client.js';
import { loadClaimsMap, resolveClaim } from '../../claims/claimsMap.js';
import { applyDefaultsFromRepo } from '../../claims/defaults.js';
import { serializeClaim } from '../../claims/keyOrdering.js';
import { isClaimKind } from '../../mutations/definitions.js';
import { parseClaimYaml, requireOrg } from '../../mutations/support.js';

function claimKind(claim: Record<string, unknown>): string {
  const kind = claim.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new Error('The claim must define a "kind" field to apply defaults');
  }
  return kind;
}

function writeLine(value: string): void {
  process.stdout.write(`${value}\n`);
}

export default class DefaultsApply extends Command {
  static description =
    'Apply claim defaults from the claims repo to a claim and print the filled YAML';

  static examples = [
    '<%= config.bin %> <%= command.id %> ComponentClaim-my-service --org my-org',
    '<%= config.bin %> <%= command.id %> -f /tmp/claim.yaml --org my-org',
  ];

  static args = {
    reference: Args.string({
      description: 'Claim reference in <Kind>-<name> format',
      required: false,
    }),
  };

  static flags = {
    org: Flags.string({
      description: 'GitHub organization containing the claims repo',
      default: async () => process.env.FSCRT_ORG,
    }),
    file: Flags.string({
      char: 'f',
      description: 'Path to a local claim YAML file',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DefaultsApply);
    const org = requireOrg(flags.org);
    if (!args.reference && !flags.file) {
      this.error('Provide a claim reference or -f <file>');
    }
    if (args.reference && flags.file) {
      this.error('Provide either a claim reference or -f <file>, not both');
    }

    const client = new ClaimsClient(org);

    let claim: Record<string, unknown>;
    if (flags.file) {
      claim = parseClaimYaml(await readFile(flags.file, 'utf8'));
    } else {
      const reference = args.reference as string;
      const separator = reference.indexOf('-');
      const kind = reference.slice(0, separator);
      const name = reference.slice(separator + 1);
      if (separator < 1 || !name || !isClaimKind(kind)) {
        this.error(`Invalid claim reference: ${reference}`);
      }
      const map = await loadClaimsMap(client);
      const resolved = await resolveClaim(client, map, reference);
      claim = parseClaimYaml(resolved.content);
    }

    claimKind(claim);
    const filled = await applyDefaultsFromRepo(client, claim, 'strict');

    writeLine(serializeClaim(filled));
  }
}
